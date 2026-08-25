import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  AUTOMATIC_REPLY_DEBOUNCE_MS,
  PLATFORM_HANDOFF_KEYWORDS,
  buildAutomaticInstructions,
  isCourtesyOnlyMessage,
  normalizeAutomaticReply,
  normalizeComparableText,
} from "@/lib/ai-conversation-policy";
import { sendEvolutionTextMessage } from "@/lib/evolution-text.server";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";

function extractText(payload: any): string {
  return (payload?.output ?? [])
    .flatMap((item: any) => item?.content ?? [])
    .filter((content: any) => content?.type === "output_text" && typeof content?.text === "string")
    .map((content: any) => content.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sendEvolutionText(phone: string, text: string, instanceName: string) {
  const normalizedPhone = normalizeWhatsAppPhone(phone);
  if (!normalizedPhone) return null;

  try {
    const humanTypingDelay = Math.min(3_200, 1_200 + text.length * 8);
    return await sendEvolutionTextMessage({
      phone: normalizedPhone,
      text,
      delay: humanTypingDelay,
      instanceName,
    });
  } catch {
    return null;
  }
}

async function latestAttendanceState(tenantId: string, conversationId: string) {
  const db = supabaseAdmin as any;
  const { data } = await db
    .from("system_events")
    .select("metadata,created_at")
    .eq("tenant_id", tenantId)
    .eq("event_type", "attendance_state")
    .order("created_at", { ascending: false })
    .limit(500);
  return (data ?? []).find(
    (row: any) =>
      row?.metadata &&
      typeof row.metadata === "object" &&
      String(row.metadata.conversationId ?? "") === conversationId,
  );
}

function attendanceStateValue(event: any) {
  const metadata = event?.metadata && typeof event.metadata === "object" ? event.metadata : {};
  return String(metadata.state ?? "");
}

async function automationPausedForHuman(tenantId: string, conversationId: string) {
  const db = supabaseAdmin as any;
  const [{ data: conversation }, attendanceEvent] = await Promise.all([
    db
      .from("whatsapp_conversations")
      .select("assigned_user_id")
      .eq("tenant_id", tenantId)
      .eq("id", conversationId)
      .maybeSingle(),
    latestAttendanceState(tenantId, conversationId),
  ]);
  const state = attendanceStateValue(attendanceEvent);
  return Boolean(conversation?.assigned_user_id) || state === "waiting" || state === "in_service";
}

async function recentMessages(tenantId: string, conversationId: string, limit = 20) {
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("whatsapp_messages")
    .select("id,external_message_id,direction,body,sent_at")
    .eq("tenant_id", tenantId)
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

function currentInboundIsLatest(
  messages: any[],
  input: {
    inboundText: string | null;
    inboundExternalMessageId?: string | null;
    inboundSentAt?: string;
  },
) {
  const latest = messages[0];
  if (!latest) return { current: true, reason: "current" };
  if (latest.direction === "outbound") return { current: false, reason: "already_replied" };

  if (
    input.inboundExternalMessageId &&
    latest.external_message_id &&
    String(latest.external_message_id) !== input.inboundExternalMessageId
  ) {
    return { current: false, reason: "superseded_by_newer_inbound" };
  }

  if (!input.inboundExternalMessageId) {
    const latestBody = normalizeComparableText(String(latest.body ?? ""));
    const inboundBody = normalizeComparableText(input.inboundText ?? "");
    if (latestBody && inboundBody && latestBody !== inboundBody) {
      const latestAt = new Date(String(latest.sent_at ?? "")).getTime();
      const inboundAt = new Date(input.inboundSentAt ?? "").getTime();
      if (!Number.isFinite(inboundAt) || (Number.isFinite(latestAt) && latestAt >= inboundAt)) {
        return { current: false, reason: "superseded_by_newer_inbound" };
      }
    }
  }

  return { current: true, reason: "current" };
}

function looksLikeSelfEcho(messages: any[], inboundText: string) {
  const inbound = normalizeComparableText(inboundText);
  if (!inbound) return false;
  const cutoff = Date.now() - 3 * 60_000;
  return messages.some((message) => {
    if (message.direction !== "outbound") return false;
    const sentAt = new Date(String(message.sent_at ?? "")).getTime();
    if (!Number.isFinite(sentAt) || sentAt < cutoff) return false;
    return normalizeComparableText(String(message.body ?? "")) === inbound;
  });
}

function duplicatesRecentAssistantReply(messages: any[], reply: string) {
  const normalizedReply = normalizeComparableText(reply);
  if (!normalizedReply) return false;
  return messages
    .filter((message) => message.direction === "outbound")
    .slice(0, 3)
    .some((message) => normalizeComparableText(String(message.body ?? "")) === normalizedReply);
}

async function recordAttendanceState(
  tenantId: string,
  conversationId: string,
  state: "waiting" | "automatic",
  extra: Record<string, unknown> = {},
) {
  const db = supabaseAdmin as any;
  const events = db.from("system_events");
  if (!events || typeof events.insert !== "function") return;
  await events.insert({
    tenant_id: tenantId,
    event_type: "attendance_state",
    severity: "info",
    message:
      state === "waiting"
        ? "Conversa encaminhada automaticamente para atendimento humano"
        : "Conversa mantida no atendimento automático",
    metadata: {
      conversationId,
      state,
      assignedUserId: null,
      departmentName: "Geral",
      ...extra,
    },
  });
}

async function queueForHuman(input: { tenantId: string; conversationId: string }) {
  const db = supabaseAdmin as any;
  const { data: conversation } = await db
    .from("whatsapp_conversations")
    .select("assigned_user_id")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.conversationId)
    .maybeSingle();
  if (!conversation || conversation.assigned_user_id) return;

  const previous = await latestAttendanceState(input.tenantId, input.conversationId);
  const previousMetadata =
    previous?.metadata && typeof previous.metadata === "object" ? previous.metadata : {};
  if (previousMetadata.state === "in_service") return;
  const now = new Date().toISOString();
  await db
    .from("whatsapp_conversations")
    .update({ assigned_user_id: null, updated_at: now })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.conversationId);
  await recordAttendanceState(input.tenantId, input.conversationId, "waiting", {
    waitingSince:
      typeof previousMetadata.waitingSince === "string" && previousMetadata.waitingSince
        ? previousMetadata.waitingSince
        : now,
    acceptedAt: null,
    firstResponseAt: null,
    closedAt: null,
  });
}

export async function maybeAutoReply(input: {
  tenantId: string;
  conversationId: string;
  phone: string;
  inboundText: string | null;
  inboundSentAt?: string;
  inboundExternalMessageId?: string | null;
}) {
  if (!input.inboundText?.trim()) return { sent: false, reason: "empty" };

  if (input.inboundSentAt) {
    const receivedAt = new Date(input.inboundSentAt).getTime();
    const ageMs = Date.now() - receivedAt;
    if (!Number.isFinite(receivedAt) || ageMs < -60_000 || ageMs > 3 * 60_000) {
      return { sent: false, reason: "stale_inbound" };
    }
  }

  if (await automationPausedForHuman(input.tenantId, input.conversationId)) {
    return { sent: false, reason: "human_service_active" };
  }

  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    await queueForHuman(input);
    return { sent: false, reason: "ai_not_configured" };
  }

  const db = supabaseAdmin as any;
  const { data: settings } = await db
    .from("ai_agent_settings")
    .select("enabled,auto_reply,agent_name,system_prompt,handoff_keywords")
    .eq("tenant_id", input.tenantId)
    .maybeSingle();
  if (!settings?.enabled || !settings?.auto_reply) {
    await queueForHuman(input);
    return { sent: false, reason: "disabled" };
  }

  const normalizedInbound = normalizeComparableText(input.inboundText);
  const handoffKeywords = [...PLATFORM_HANDOFF_KEYWORDS, ...(settings.handoff_keywords ?? [])]
    .map((value: unknown) => normalizeComparableText(String(value)))
    .filter(Boolean);
  if (handoffKeywords.some((keyword: string) => normalizedInbound.includes(keyword))) {
    await queueForHuman(input);
    return { sent: false, reason: "human_handoff" };
  }

  if (isCourtesyOnlyMessage(input.inboundText)) {
    return { sent: false, reason: "courtesy_only" };
  }

  const { data: connection } = await db
    .from("whatsapp_connections")
    .select("instance_name,status")
    .eq("tenant_id", input.tenantId)
    .maybeSingle();
  const instanceName =
    (connection?.instance_name ? String(connection.instance_name) : "") ||
    process.env["EVOLUTION_INSTANCE"]?.trim() ||
    "";
  if (!instanceName) {
    await queueForHuman(input);
    return { sent: false, reason: "whatsapp_not_connected" };
  }

  // Humanized debounce: wait for the customer to finish a burst of short messages.
  // Only the newest inbound message in the conversation is allowed to trigger a reply.
  await sleep(AUTOMATIC_REPLY_DEBOUNCE_MS);

  const messages = await recentMessages(input.tenantId, input.conversationId, 20);
  const latestCheck = currentInboundIsLatest(messages, input);
  if (!latestCheck.current) return { sent: false, reason: latestCheck.reason };
  if (looksLikeSelfEcho(messages, input.inboundText)) {
    return { sent: false, reason: "self_echo" };
  }

  const history = [...messages]
    .reverse()
    .map((message: any) => ({
      role: message.direction === "outbound" ? "assistant" : "user",
      content: String(message.body ?? ""),
    }))
    .filter((message) => message.content.trim());

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env["OPENAI_MODEL"] || "gpt-5.6",
      instructions: buildAutomaticInstructions(settings.system_prompt),
      input: history,
      store: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    await queueForHuman(input);
    return { sent: false, reason: "ai_request_failed" };
  }

  const extractedReply = extractText(await response.json());
  if (!extractedReply) {
    await queueForHuman(input);
    return { sent: false, reason: "ai_empty" };
  }

  const reply = normalizeAutomaticReply(extractedReply);
  if (!reply) return { sent: false, reason: "no_reply_needed" };
  if (duplicatesRecentAssistantReply(messages, reply)) {
    return { sent: false, reason: "duplicate_reply" };
  }

  // Race guard: while the model was thinking, a customer may have sent another message
  // or a human attendant may have taken over. In either case, this generated reply is discarded.
  const beforeSendMessages = await recentMessages(input.tenantId, input.conversationId, 3);
  const beforeSendCheck = currentInboundIsLatest(beforeSendMessages, input);
  if (!beforeSendCheck.current) return { sent: false, reason: beforeSendCheck.reason };
  if (await automationPausedForHuman(input.tenantId, input.conversationId)) {
    return { sent: false, reason: "human_service_active" };
  }

  const evolutionPayload = await sendEvolutionText(input.phone, reply, instanceName);
  if (!evolutionPayload) {
    await queueForHuman(input);
    return { sent: false, reason: "whatsapp_send_failed" };
  }

  const key = evolutionPayload["key"] as Record<string, unknown> | undefined;
  const externalMessageId =
    (typeof key?.["id"] === "string" && key["id"]) ||
    (typeof evolutionPayload["id"] === "string" && evolutionPayload["id"]) ||
    null;
  const now = new Date().toISOString();

  await db.from("whatsapp_messages").insert({
    tenant_id: input.tenantId,
    conversation_id: input.conversationId,
    external_message_id: externalMessageId,
    direction: "outbound",
    message_type: "text",
    body: reply,
    status: "sent",
    sent_at: now,
    raw_payload: evolutionPayload,
  });
  await db
    .from("whatsapp_conversations")
    .update({
      assigned_user_id: null,
      last_message: reply,
      last_message_at: now,
      updated_at: now,
    })
    .eq("id", input.conversationId)
    .eq("tenant_id", input.tenantId);
  await recordAttendanceState(input.tenantId, input.conversationId, "automatic", {
    waitingSince: null,
    acceptedAt: null,
    firstResponseAt: null,
    closedAt: null,
  });

  return { sent: true, reason: "sent" };
}
