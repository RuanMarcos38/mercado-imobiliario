import { supabaseAdmin } from "@/integrations/supabase/client.server";

function extractText(payload: any): string {
  return (payload?.output ?? [])
    .flatMap((item: any) => item?.content ?? [])
    .filter((content: any) => content?.type === "output_text" && typeof content?.text === "string")
    .map((content: any) => content.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function sendEvolutionText(phone: string, text: string) {
  const baseUrl = process.env["EVOLUTION_API_URL"]?.replace(/\/$/, "");
  const apiKey = process.env["EVOLUTION_API_KEY"];
  const instance = process.env["EVOLUTION_INSTANCE"];
  if (!baseUrl || !apiKey || !instance) return null;

  const endpoint = `${baseUrl}/message/sendText/${encodeURIComponent(instance)}`;
  let response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({ number: phone, text, options: { delay: 900, presence: "composing" } }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok && response.status === 400) {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({
        number: phone,
        options: { delay: 900, presence: "composing" },
        textMessage: { text },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  }

  if (!response.ok) return null;
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function maybeAutoReply(input: {
  tenantId: string;
  conversationId: string;
  phone: string;
  inboundText: string | null;
}) {
  if (!input.inboundText?.trim()) return { sent: false, reason: "empty" };
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return { sent: false, reason: "ai_not_configured" };

  const db = supabaseAdmin as any;
  const { data: settings } = await db
    .from("ai_agent_settings")
    .select("enabled,auto_reply,agent_name,system_prompt,handoff_keywords")
    .eq("tenant_id", input.tenantId)
    .maybeSingle();
  if (!settings?.enabled || !settings?.auto_reply) return { sent: false, reason: "disabled" };

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

  const evolutionPayload = await sendEvolutionText(input.phone, reply);
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
