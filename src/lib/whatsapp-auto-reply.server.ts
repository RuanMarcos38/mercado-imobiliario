import { supabaseAdmin } from "@/integrations/supabase/client.server";
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

async function sendEvolutionText(phone: string, text: string, instanceName: string) {
  const normalizedPhone = normalizeWhatsAppPhone(phone);
  if (!normalizedPhone) return null;

  try {
    return await sendEvolutionTextMessage({
      phone: normalizedPhone,
      text,
      delay: 900,
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

async function keepAutomatic(input: { tenantId: string; conversationId: string }) {
  const db = supabaseAdmin as any;
  const now = new Date().toISOString();
  await db
    .from("whatsapp_conversations")
    .update({ assigned_user_id: null, updated_at: now })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.conversationId);
  await recordAttendanceState(input.tenantId, input.conversationId, "automatic", {
    waitingSince: null,
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
}) {
  if (!input.inboundText?.trim()) return { sent: false, reason: "empty" };

  if (input.inboundSentAt) {
    const receivedAt = new Date(input.inboundSentAt).getTime();
    const ageMs = Date.now() - receivedAt;
    if (!Number.isFinite(receivedAt) || ageMs < -60_000 || ageMs > 3 * 60_000) {
      return { sent: false, reason: "stale_inbound" };
    }
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

  const normalizedInbound = input.inboundText.toLowerCase();
  const handoffKeywords = (settings.handoff_keywords ?? [])
    .map((value: unknown) => String(value).trim().toLowerCase())
    .filter(Boolean);
  if (handoffKeywords.some((keyword: string) => normalizedInbound.includes(keyword))) {
    await queueForHuman(input);
    return { sent: false, reason: "human_handoff" };
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

  const { data: messages } = await db
    .from("whatsapp_messages")
    .select("direction,body,sent_at")
    .eq("tenant_id", input.tenantId)
    .eq("conversation_id", input.conversationId)
    .order("sent_at", { ascending: false })
    .limit(16);

  const history = [...(messages ?? [])]
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
      instructions: [
        "Você é um assistente de atendimento imobiliário do MercadoImobi.",
        "Responda em português do Brasil, de forma humana e curta, em até 3 mensagens/frases.",
        "Faça no máximo uma pergunta por resposta.",
        "Nunca invente preço, disponibilidade, endereço, condições, contato ou dados de imóvel.",
        "Se faltar informação, diga que precisa consultar ou ofereça atendimento humano.",
        settings.system_prompt || "",
      ]
        .filter(Boolean)
        .join("\n"),
      input: history,
      store: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    await queueForHuman(input);
    return { sent: false, reason: "ai_request_failed" };
  }
  const reply = extractText(await response.json());
  if (!reply) {
    await queueForHuman(input);
    return { sent: false, reason: "ai_empty" };
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
    .update({ last_message: reply, last_message_at: now, updated_at: now })
    .eq("id", input.conversationId)
    .eq("tenant_id", input.tenantId);
  await keepAutomatic(input);

  return { sent: true, reason: "sent" };
}
