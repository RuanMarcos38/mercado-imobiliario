import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildAutomaticInstructions,
  normalizeAutomaticReply,
  normalizeComparableText,
} from "@/lib/ai-conversation-policy";
import { createOpenAIText } from "@/lib/openai-text.server";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";
import { sendTenantWhatsAppText } from "@/lib/whatsapp-provider.server";

type JsonObject = Record<string, unknown>;

type NativeFlowRow = {
  id: string;
  name: string;
  trigger_type: string;
  trigger_value: string | null;
  created_at?: string | null;
};

type NativeFlowStep = {
  position: number;
  step_type: "message" | "wait" | "ai" | "handoff" | "webhook" | "tag";
  config: JsonObject | null;
};

export type NativeFlowRunResult = {
  handled: boolean;
  sent: boolean;
  reason: string;
  flowId?: string;
  flowName?: string;
};

const FLOW_EVENT = "whatsapp_flow_execution";
const TAG_EVENT = "attendance_tags";
const STATE_EVENT = "attendance_state";
const MAX_WAIT_PER_STEP_MS = 3_000;
const MAX_TOTAL_WAIT_MS = 6_000;
const WEBHOOK_TIMEOUT_MS = 5_000;

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function configText(config: JsonObject, keys: string[]) {
  for (const key of keys) {
    const value = stringValue(config[key]);
    if (value) return value;
  }
  return "";
}

function metadata(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

export function matchesNativeFlowTrigger(
  flow: Pick<NativeFlowRow, "trigger_type" | "trigger_value">,
  inboundText: string,
  alreadyCompleted: boolean,
) {
  if (flow.trigger_type === "new_conversation") return !alreadyCompleted;
  if (flow.trigger_type !== "keyword") return false;
  const keyword = normalizeComparableText(flow.trigger_value ?? "");
  const inbound = normalizeComparableText(inboundText);
  return Boolean(keyword && inbound && inbound.includes(keyword));
}

function privateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  if (parts[0] === 10 || parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 0) return true;
  return false;
}

function privateIpv6(address: string) {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

async function safeWebhookUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("FLOW_WEBHOOK_URL_INVALID");
  }
  if (url.protocol !== "https:") throw new Error("FLOW_WEBHOOK_HTTPS_REQUIRED");
  if (url.username || url.password) throw new Error("FLOW_WEBHOOK_CREDENTIALS_FORBIDDEN");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new Error("FLOW_WEBHOOK_PRIVATE_HOST_FORBIDDEN");
  }

  const directIp = isIP(hostname);
  const addresses = directIp
    ? [{ address: hostname, family: directIp }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.some((entry) =>
      entry.family === 4 ? privateIpv4(entry.address) : privateIpv6(entry.address),
    )
  ) {
    throw new Error("FLOW_WEBHOOK_PRIVATE_HOST_FORBIDDEN");
  }
  return url.toString();
}

async function insertSystemEvent(
  tenantId: string,
  eventType: string,
  message: string,
  eventMetadata: JsonObject,
  severity: "info" | "warning" | "error" = "info",
) {
  const db = supabaseAdmin as any;
  const { error } = await db.from("system_events").insert({
    tenant_id: tenantId,
    event_type: eventType,
    message,
    metadata: eventMetadata,
    severity,
  });
  if (error) throw new Error(error.message);
}

async function recentExecutionEvents(tenantId: string) {
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("system_events")
    .select("metadata,created_at")
    .eq("tenant_id", tenantId)
    .eq("event_type", FLOW_EVENT)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return data ?? [];
}

function flowAlreadyCompleted(
  events: Array<{ metadata?: unknown }>,
  flowId: string,
  conversationId: string,
) {
  return events.some((event) => {
    const eventMetadata = metadata(event.metadata);
    return (
      String(eventMetadata["flowId"] ?? "") === flowId &&
      String(eventMetadata["conversationId"] ?? "") === conversationId &&
      ["completed", "handoff"].includes(String(eventMetadata["status"] ?? ""))
    );
  });
}

function inboundAlreadyProcessed(
  events: Array<{ metadata?: unknown }>,
  flowId: string,
  inboundExternalMessageId?: string | null,
) {
  if (!inboundExternalMessageId) return false;
  return events.some((event) => {
    const eventMetadata = metadata(event.metadata);
    return (
      String(eventMetadata["flowId"] ?? "") === flowId &&
      String(eventMetadata["inboundExternalMessageId"] ?? "") === inboundExternalMessageId
    );
  });
}

function latestPendingExecution(events: Array<{ metadata?: unknown }>, conversationId: string) {
  for (const event of events) {
    const eventMetadata = metadata(event.metadata);
    if (String(eventMetadata["conversationId"] ?? "") !== conversationId) continue;
    const status = String(eventMetadata["status"] ?? "");
    if (status === "awaiting_inbound") {
      const flowId = String(eventMetadata["flowId"] ?? "");
      const nextPosition = Number(eventMetadata["nextPosition"] ?? 1);
      if (flowId && Number.isFinite(nextPosition) && nextPosition >= 1) {
        return {
          flowId,
          nextPosition,
          inboundExternalMessageId: String(eventMetadata["inboundExternalMessageId"] ?? "") || null,
        };
      }
    }
    if (["completed", "handoff", "failed"].includes(status)) {
      return null;
    }
  }
  return null;
}

async function activeFlows(tenantId: string) {
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("whatsapp_flows")
    .select("id,name,trigger_type,trigger_value,created_at")
    .eq("tenant_id", tenantId)
    .eq("enabled", true)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as NativeFlowRow[];
}

async function flowSteps(flowId: string) {
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("whatsapp_flow_steps")
    .select("position,step_type,config")
    .eq("flow_id", flowId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as NativeFlowStep[];
}

async function conversationInfo(tenantId: string, conversationId: string) {
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("whatsapp_conversations")
    .select("id,contact_name,phone_e164,assigned_user_id")
    .eq("tenant_id", tenantId)
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as {
    id: string;
    contact_name: string | null;
    phone_e164: string;
    assigned_user_id: string | null;
  } | null;
}

function renderTemplate(
  value: string,
  input: {
    name: string;
    phone: string;
    inboundText: string;
    flowName: string;
  },
) {
  const replacements: Record<string, string> = {
    nome: input.name,
    name: input.name,
    telefone: input.phone,
    phone: input.phone,
    mensagem: input.inboundText,
    message: input.inboundText,
    fluxo: input.flowName,
    flow: input.flowName,
  };
  return value.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_, key: string) => {
    return replacements[key.toLowerCase()] ?? "";
  });
}

async function persistOutboundText(input: {
  tenantId: string;
  conversationId: string;
  phone: string;
  text: string;
}) {
  const db = supabaseAdmin as any;
  const phone = normalizeWhatsAppPhone(input.phone);
  if (!phone) throw new Error("FLOW_PHONE_INVALID");

  const sent = await sendTenantWhatsAppText({
    db,
    tenantId: input.tenantId,
    phone,
    text: input.text,
    delay: 800,
  });
  const now = new Date().toISOString();
  const { error: insertError } = await db.from("whatsapp_messages").insert({
    tenant_id: input.tenantId,
    conversation_id: input.conversationId,
    external_message_id: sent.externalMessageId,
    direction: "outbound",
    message_type: "text",
    body: input.text,
    status: "sent",
    sent_at: now,
    raw_payload: { ...sent.payload, mercadoimobi_provider: sent.provider, native_flow: true },
  });
  if (insertError && insertError.code !== "23505") throw new Error(insertError.message);

  const { error: updateError } = await db
    .from("whatsapp_conversations")
    .update({
      last_message: input.text,
      last_message_at: now,
      updated_at: now,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.conversationId);
  if (updateError) throw new Error(updateError.message);
  return sent;
}

async function recentMessages(tenantId: string, conversationId: string, limit = 20) {
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("whatsapp_messages")
    .select("direction,body,sent_at")
    .eq("tenant_id", tenantId)
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).reverse();
}

async function queueForHuman(tenantId: string, conversationId: string, reason: string) {
  const db = supabaseAdmin as any;
  const now = new Date().toISOString();
  await db
    .from("whatsapp_conversations")
    .update({ assigned_user_id: null, updated_at: now })
    .eq("tenant_id", tenantId)
    .eq("id", conversationId);

  await insertSystemEvent(
    tenantId,
    STATE_EVENT,
    "Fluxo encaminhou a conversa para atendimento humano",
    {
      conversationId,
      state: "waiting",
      waitingSince: now,
      acceptedAt: null,
      firstResponseAt: null,
      closedAt: null,
      assignedUserId: null,
      departmentName: "Geral",
      flowReason: reason,
    },
  );

  try {
    await db.rpc("attendance_distribute_conversation", {
      p_tenant_id: tenantId,
      p_conversation_id: conversationId,
    });
  } catch {
    // A fila continua válida mesmo quando a distribuição automática não estiver disponível.
  }
}

async function applyTag(tenantId: string, conversationId: string, config: JsonObject) {
  const db = supabaseAdmin as any;
  const { data } = await db
    .from("system_events")
    .select("metadata,created_at")
    .eq("tenant_id", tenantId)
    .eq("event_type", TAG_EVENT)
    .order("created_at", { ascending: false })
    .limit(500);

  const current = (data ?? []).find(
    (row: any) => String(metadata(row.metadata)["conversationId"] ?? "") === conversationId,
  );
  const currentMetadata = metadata(current?.metadata);
  const currentTags = Array.isArray(currentMetadata["tags"])
    ? currentMetadata["tags"].map(String)
    : [];
  const configured = [
    ...(Array.isArray(config["tags"]) ? config["tags"].map(String) : []),
    stringValue(config["tag"]),
  ]
    .map((tag) => tag.trim())
    .filter(Boolean);
  const tags = [...new Set([...currentTags, ...configured])].slice(0, 8);
  if (!tags.length) return;

  await insertSystemEvent(tenantId, TAG_EVENT, "Tags de conversa atualizadas pelo fluxo nativo", {
    conversationId,
    tags,
  });
}

async function executeWebhookStep(input: {
  tenantId: string;
  conversationId: string;
  phone: string;
  inboundText: string;
  flowId: string;
  flowName: string;
  config: JsonObject;
}) {
  const rawUrl = configText(input.config, ["url", "endpoint", "endpointUrl"]);
  if (!rawUrl) return;
  const url = await safeWebhookUrl(rawUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "mercadoimobi.flow",
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      phone: input.phone,
      inboundText: input.inboundText,
      flowId: input.flowId,
      flowName: input.flowName,
      payload:
        input.config["payload"] && typeof input.config["payload"] === "object"
          ? input.config["payload"]
          : {},
    }),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`FLOW_WEBHOOK_HTTP_${response.status}`);
}

async function aiReply(input: {
  tenantId: string;
  conversationId: string;
  inboundText: string;
  config: JsonObject;
}) {
  const history = (await recentMessages(input.tenantId, input.conversationId, 20))
    .map((message: any) => ({
      role: message.direction === "outbound" ? ("assistant" as const) : ("user" as const),
      content: String(message.body ?? "").trim(),
    }))
    .filter((message) => message.content);
  const instruction =
    configText(input.config, ["instruction", "instructions", "prompt", "systemPrompt"]) ||
    "Continue o atendimento conforme o contexto e faça uma pergunta por vez.";
  const response = await createOpenAIText(history, buildAutomaticInstructions(instruction), {
    timeoutMs: 30_000,
  });
  return normalizeAutomaticReply(response.text);
}

function chooseMatchingFlow(
  flows: NativeFlowRow[],
  events: Array<{ metadata?: unknown }>,
  input: {
    conversationId: string;
    inboundText: string;
    inboundExternalMessageId?: string | null;
  },
) {
  const candidates = flows.filter((flow) => {
    if (inboundAlreadyProcessed(events, flow.id, input.inboundExternalMessageId)) return false;
    const completed = flowAlreadyCompleted(events, flow.id, input.conversationId);
    return matchesNativeFlowTrigger(flow, input.inboundText, completed);
  });

  return candidates.sort((a, b) => {
    const aKeyword = a.trigger_type === "keyword" ? 1 : 0;
    const bKeyword = b.trigger_type === "keyword" ? 1 : 0;
    if (aKeyword !== bKeyword) return bKeyword - aKeyword;
    if (aKeyword && bKeyword) {
      return String(b.trigger_value ?? "").length - String(a.trigger_value ?? "").length;
    }
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  })[0];
}

export async function maybeRunNativeWhatsAppFlow(input: {
  tenantId: string;
  conversationId: string;
  phone: string;
  inboundText: string;
  inboundSentAt?: string;
  inboundExternalMessageId?: string | null;
}): Promise<NativeFlowRunResult> {
  if (!input.inboundText.trim()) return { handled: false, sent: false, reason: "empty" };

  const [flows, events, conversation] = await Promise.all([
    activeFlows(input.tenantId),
    recentExecutionEvents(input.tenantId),
    conversationInfo(input.tenantId, input.conversationId),
  ]);
  if (!conversation || flows.length === 0) {
    return { handled: false, sent: false, reason: "no_active_native_flow" };
  }

  const pending = latestPendingExecution(events, input.conversationId);
  if (
    pending?.inboundExternalMessageId &&
    input.inboundExternalMessageId &&
    pending.inboundExternalMessageId === input.inboundExternalMessageId
  ) {
    return {
      handled: true,
      sent: false,
      reason: "native_flow_duplicate_inbound",
      flowId: pending.flowId,
    };
  }

  let flow = pending ? flows.find((candidate) => candidate.id === pending.flowId) : undefined;
  let startPosition = pending?.nextPosition ?? 1;

  if (!flow) {
    flow = chooseMatchingFlow(flows, events, input);
    startPosition = 1;
  }
  if (!flow) return { handled: false, sent: false, reason: "no_matching_native_flow" };

  const steps = (await flowSteps(flow.id)).filter((step) => step.position >= startPosition);
  if (!steps.length) return { handled: false, sent: false, reason: "native_flow_without_steps" };

  const phone = normalizeWhatsAppPhone(conversation.phone_e164 || input.phone) || input.phone;
  const contactName = stringValue(conversation.contact_name);
  const eventBase: JsonObject = {
    flowId: flow.id,
    flowName: flow.name,
    conversationId: input.conversationId,
    inboundExternalMessageId: input.inboundExternalMessageId ?? null,
    inboundSentAt: input.inboundSentAt ?? null,
  };
  await insertSystemEvent(
    input.tenantId,
    FLOW_EVENT,
    pending ? `Fluxo nativo retomado: ${flow.name}` : `Fluxo nativo iniciado: ${flow.name}`,
    {
      ...eventBase,
      status: "started",
      startPosition,
      resumed: Boolean(pending),
    },
  );

  let sentCount = 0;
  let totalWait = 0;
  let outboundSentThisTurn = false;
  try {
    for (const step of steps) {
      const config = metadata(step.config);
      if (step.step_type === "message") {
        if (outboundSentThisTurn) {
          await insertSystemEvent(
            input.tenantId,
            FLOW_EVENT,
            `Fluxo aguardando nova mensagem: ${flow.name}`,
            {
              ...eventBase,
              status: "awaiting_inbound",
              nextPosition: step.position,
              sentCount,
            },
          );
          return {
            handled: true,
            sent: sentCount > 0,
            reason: "native_flow_awaiting_inbound",
            flowId: flow.id,
            flowName: flow.name,
          };
        }
        const rawText = configText(config, ["text", "message", "body"]);
        if (!rawText) continue;
        const text = renderTemplate(rawText, {
          name: contactName,
          phone,
          inboundText: input.inboundText,
          flowName: flow.name,
        })
          .trim()
          .slice(0, 4096);
        if (!text) continue;
        await persistOutboundText({
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          phone,
          text,
        });
        sentCount += 1;
        outboundSentThisTurn = true;
        continue;
      }

      if (step.step_type === "wait") {
        const requestedMs =
          numberValue(config["milliseconds"]) ||
          numberValue(config["ms"]) ||
          numberValue(config["seconds"]) * 1000;
        const remaining = Math.max(0, MAX_TOTAL_WAIT_MS - totalWait);
        const waitMs = Math.min(Math.max(0, requestedMs), MAX_WAIT_PER_STEP_MS, remaining);
        if (waitMs > 0) {
          await sleep(waitMs);
          totalWait += waitMs;
        }
        continue;
      }

      if (step.step_type === "ai") {
        if (outboundSentThisTurn) {
          await insertSystemEvent(
            input.tenantId,
            FLOW_EVENT,
            `Fluxo aguardando nova mensagem: ${flow.name}`,
            {
              ...eventBase,
              status: "awaiting_inbound",
              nextPosition: step.position,
              sentCount,
            },
          );
          return {
            handled: true,
            sent: sentCount > 0,
            reason: "native_flow_awaiting_inbound",
            flowId: flow.id,
            flowName: flow.name,
          };
        }
        const reply = await aiReply({
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          inboundText: input.inboundText,
          config,
        });
        if (!reply) continue;
        await persistOutboundText({
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          phone,
          text: reply,
        });
        sentCount += 1;
        outboundSentThisTurn = true;
        continue;
      }

      if (step.step_type === "tag") {
        await applyTag(input.tenantId, input.conversationId, config);
        continue;
      }

      if (step.step_type === "webhook") {
        await executeWebhookStep({
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          phone,
          inboundText: input.inboundText,
          flowId: flow.id,
          flowName: flow.name,
          config,
        });
        continue;
      }

      if (step.step_type === "handoff") {
        const reason =
          configText(config, ["reason", "message"]) || "Fluxo solicitou atendimento humano";
        await queueForHuman(input.tenantId, input.conversationId, reason);
        await insertSystemEvent(input.tenantId, FLOW_EVENT, `Fluxo encaminhado: ${flow.name}`, {
          ...eventBase,
          status: "handoff",
          sentCount,
        });
        return {
          handled: true,
          sent: sentCount > 0,
          reason: "native_flow_handoff",
          flowId: flow.id,
          flowName: flow.name,
        };
      }
    }

    await insertSystemEvent(input.tenantId, FLOW_EVENT, `Fluxo nativo concluído: ${flow.name}`, {
      ...eventBase,
      status: "completed",
      sentCount,
    });
    return {
      handled: true,
      sent: sentCount > 0,
      reason: "native_flow_completed",
      flowId: flow.id,
      flowName: flow.name,
    };
  } catch (error) {
    await insertSystemEvent(
      input.tenantId,
      FLOW_EVENT,
      `Falha no fluxo nativo: ${flow.name}`,
      {
        ...eventBase,
        status: "failed",
        sentCount,
        error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
      },
      "error",
    ).catch(() => undefined);

    return {
      handled: sentCount > 0,
      sent: sentCount > 0,
      reason: sentCount > 0 ? "native_flow_partial_failure" : "native_flow_failed",
      flowId: flow.id,
      flowName: flow.name,
    };
  }
}
