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

export async function maybeAutoReply(input: {
  tenantId: string;
  conversationId: string;
  phone: string;
  inboundText: string | null;
  inboundSentAt?: string;
}) {
  if (!input.inboundText?.trim()) return { sent: false, reason: "empty" };
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return { sent: false, reason: "ai_not_configured" };

  if (input.inboundSentAt) {
    const receivedAt = new Date(input.inboundSentAt).getTime();
    const ageMs = Date.now() - receivedAt;
    if (!Number.isFinite(receivedAt) || ageMs < -60_000 || ageMs > 3 * 60_000) {
      return { sent: false, reason: "stale_inbound" };
    }
  }

  const db = supabaseAdmin as any;
  const [{ data: settings }, { data: connection }] = await Promise.all([
    db
      .from("ai_agent_settings")
      .select("enabled,auto_reply,agent_name,system_prompt,handoff_keywords")
      .eq("tenant_id", input.tenantId)
      .maybeSingle(),
    db
      .from("whatsapp_connections")
      .select("instance_name,status")
      .eq("tenant_id", input.tenantId)
      .maybeSingle(),
  ]);
  if (!settings?.enabled || !settings?.auto_reply) return { sent: false, reason: "disabled" };
  if (!connection?.instance_name) return { sent: false, reason: "whatsapp_not_connected" };

  const normalizedInbound = input.inboundText.toLowerCase();
  const handoffKeywords = (settings.handoff_keywords ?? [])
    .map((value: unknown) => String(value).trim().toLowerCase())
    .filter(Boolean);
  if (handoffKeywords.some((keyword: string) => normalizedInbound.includes(keyword))) {
    return { sent: false, reason: "human_handoff" };
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
  if (!response.ok) return { sent: false, reason: "ai_request_failed" };
  const reply = extractText(await response.json());
  if (!reply) return { sent: false, reason: "ai_empty" };

  const evolutionPayload = await sendEvolutionText(input.phone, reply, String(connection.instance_name));
  if (!evolutionPayload) return { sent: false, reason: "whatsapp_send_failed" };

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

  return { sent: true, reason: "sent" };
}
