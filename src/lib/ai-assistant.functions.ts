import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";

const draftSchema = z.object({ conversationId: z.string().uuid() });
const testSchema = z.object({ message: z.string().trim().min(1).max(2000) });

type OpenAIResponse = {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

export function extractOpenAIText(payload: OpenAIResponse): string {
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function aiConfig() {
  const apiKey = process.env["OPENAI_API_KEY"];
  const model = process.env["OPENAI_MODEL"] || "gpt-5.6";
  return apiKey ? { apiKey, model } : null;
}

async function createResponse(input: unknown, instructions: string) {
  const config = aiConfig();
  if (!config) throw new Error("AI_NOT_CONFIGURED");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      instructions,
      input,
      store: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) throw new Error(`AI_REQUEST_FAILED_${response.status}`);
  const payload = (await response.json()) as OpenAIResponse;
  const text = extractOpenAIText(payload);
  if (!text) throw new Error("AI_EMPTY_RESPONSE");
  return { text, model: config.model };
}

export const getAiRuntimeStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const config = aiConfig();
    return {
      configured: Boolean(config),
      model: config?.model ?? null,
    };
  });

export const generateConversationDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => draftSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;

    const [{ data: settings }, { data: conversation }] = await Promise.all([
      db
        .from("ai_agent_settings")
        .select("enabled,agent_name,system_prompt,handoff_keywords")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      db
        .from("whatsapp_conversations")
        .select("id,contact_name,phone_e164")
        .eq("tenant_id", tenantId)
        .eq("id", data.conversationId)
        .maybeSingle(),
    ]);

    if (!conversation) throw new Error("Conversa não encontrada.");
    if (!settings?.enabled) throw new Error("AI_DISABLED");

    const { data: messages, error } = await db
      .from("whatsapp_messages")
      .select("direction,body,sender_name,sent_at")
      .eq("tenant_id", tenantId)
      .eq("conversation_id", data.conversationId)
      .order("sent_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);

    const history = [...(messages ?? [])]
      .reverse()
      .map((message: any) => ({
        role: message.direction === "outbound" ? "assistant" : "user",
        content: String(message.body ?? ""),
      }))
      .filter((message) => message.content.trim());

    const instructions = [
      "Você é um assistente de atendimento imobiliário brasileiro do MercadoImobi.",
      "Responda em português do Brasil, de forma humana, curta e consultiva.",
      "Nunca invente preço, disponibilidade, condição, telefone, endereço ou informação do imóvel.",
      "Faça no máximo uma pergunta por resposta e evite textos longos.",
      "Se o cliente pedir atendimento humano ou corretor, responda de forma breve informando que o atendimento será encaminhado.",
      settings.system_prompt || "",
      `Nome configurado do assistente: ${settings.agent_name || "Assistente MercadoImobi"}.`,
      `Palavras de transferência: ${(settings.handoff_keywords ?? []).join(", ")}.`,
    ]
      .filter(Boolean)
      .join("\n");

    return createResponse(history, instructions);
  });

export const testAiAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => testSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { data: settings } = await db
      .from("ai_agent_settings")
      .select("agent_name,system_prompt,handoff_keywords")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const instructions = [
      "Você está em um teste interno do chatbot MercadoImobi.",
      "Responda em português do Brasil em no máximo 3 frases.",
      "Não invente informações imobiliárias.",
      settings?.system_prompt || "",
    ]
      .filter(Boolean)
      .join("\n");

    return createResponse(
      [{ role: "user", content: data.message }],
      instructions,
    );
  });
