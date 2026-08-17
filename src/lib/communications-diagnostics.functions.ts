import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";
import {
  aiParameters,
  integrationReadiness,
  platformParameterDefinitions,
} from "@/lib/platform-parameters.server";

export type DiagnosticItem = {
  key: string;
  label: string;
  configured: boolean;
  ok: boolean;
  detail: string;
};

async function testOpenAi(): Promise<DiagnosticItem> {
  const apiKey = process.env["OPENAI_API_KEY"]?.trim();
  if (!apiKey)
    return {
      key: "openai",
      label: "Chatbot / OpenAI",
      configured: false,
      ok: false,
      detail: "OPENAI_API_KEY não configurada.",
    };
  const parameters = aiParameters();
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: parameters.model,
        input: "Teste técnico do MercadoImobi. Responda somente OK.",
        max_output_tokens: parameters.testMaxOutputTokens,
        store: false,
      }),
      signal: AbortSignal.timeout(parameters.requestTimeoutMs),
    });
    return {
      key: "openai",
      label: "Chatbot / OpenAI",
      configured: true,
      ok: response.ok,
      detail: response.ok
        ? `Resposta sintética executada com sucesso (${parameters.model}).`
        : `OpenAI HTTP ${response.status}.`,
    };
  } catch {
    return {
      key: "openai",
      label: "Chatbot / OpenAI",
      configured: true,
      ok: false,
      detail: "Falha de conexão com a OpenAI.",
    };
  }
}

async function testWhatsApp(db: any, tenantId: string): Promise<DiagnosticItem> {
  try {
    const { evolutionGatewayConfig, evolutionRequest, getTenantEvolutionInstance } =
      await import("@/lib/evolution-instance.server");
    const gateway = evolutionGatewayConfig();
    const instance = await getTenantEvolutionInstance(db, tenantId);
    if (!gateway || !instance)
      return {
        key: "whatsapp",
        label: "WhatsApp / Evolution",
        configured: false,
        ok: false,
        detail: "Gateway ou instância ainda não configurados.",
      };
    const response = await evolutionRequest(
      gateway,
      `/instance/connectionState/${encodeURIComponent(instance)}`,
      { method: "GET" },
    );
    const payload = await response.json().catch(() => ({}));
    const raw = String(
      payload?.instance?.state ?? payload?.state ?? payload?.status ?? "",
    ).toLowerCase();
    const online = response.ok && ["open", "connected", "online"].includes(raw);
    return {
      key: "whatsapp",
      label: "WhatsApp / Evolution",
      configured: true,
      ok: online,
      detail: online
        ? `Instância ${instance} online.`
        : `Instância ${instance}: ${raw || `HTTP ${response.status}`}.`,
    };
  } catch {
    return {
      key: "whatsapp",
      label: "WhatsApp / Evolution",
      configured: true,
      ok: false,
      detail: "Falha ao consultar a Evolution API.",
    };
  }
}

async function testEmail(): Promise<DiagnosticItem> {
  try {
    const { verifyEmailRuntime } = await import("@/lib/smtp-email.server");
    const result = await verifyEmailRuntime();
    return {
      key: "email",
      label: "E-mail / CCA",
      configured: result.configured,
      ok: result.ok,
      detail: !result.configured
        ? "SMTP Hostinger ou Resend ainda não configurados."
        : result.ok
          ? `Provedor ${result.provider === "smtp-hostinger" ? "SMTP Hostinger" : "Resend"} autenticado. Remetente: ${result.from}`
          : `O provedor de e-mail está configurado, mas a autenticação falhou.`,
    };
  } catch (error) {
    return {
      key: "email",
      label: "E-mail / CCA",
      configured: true,
      ok: false,
      detail:
        error instanceof Error
          ? `Falha no provedor de e-mail: ${error.message.slice(0, 180)}`
          : "Falha ao consultar o provedor de e-mail.",
    };
  }
}

export const runCommunicationDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { testMetaConnection } = await import("@/lib/meta-social.server");
    const { testTwilioRuntime } = await import("@/lib/dialer.functions");

    const [openai, whatsapp, metaResult, email, twilioResult] = await Promise.all([
      testOpenAi(),
      testWhatsApp(db, tenantId),
      testMetaConnection(tenantId, context.userId),
      testEmail(),
      testTwilioRuntime(),
    ]);

    const meta: DiagnosticItem = {
      key: "meta",
      label: "Facebook / Instagram",
      configured: metaResult.configured,
      ok: metaResult.ok,
      detail: metaResult.ok
        ? "Token de página Meta validado com sucesso."
        : metaResult.connected
          ? String(metaResult.error ?? "A conexão Meta precisa de atenção.")
          : "Conta Meta ainda não conectada.",
    };
    const twilio: DiagnosticItem = {
      key: "twilio",
      label: "Discador / Twilio",
      configured: twilioResult.configured,
      ok: twilioResult.ok,
      detail: twilioResult.ok
        ? "Conta de telefonia autenticada com sucesso."
        : twilioResult.configured
          ? `Twilio HTTP ${twilioResult.status ?? "falhou"}.`
          : "Credenciais Twilio ainda não configuradas.",
    };
    const supabase: DiagnosticItem = {
      key: "database",
      label: "Banco / isolamento",
      configured: true,
      ok: Boolean(tenantId),
      detail: tenantId
        ? "Tenant autenticado e isolamento de conta ativo."
        : "Tenant não resolvido.",
    };
    const parameterDefinitions = platformParameterDefinitions();
    const readiness = integrationReadiness();
    const parameters: DiagnosticItem = {
      key: "parameters",
      label: "Parâmetros operacionais",
      configured: true,
      ok: parameterDefinitions.length > 0,
      detail: `${parameterDefinitions.length} parâmetros centralizados; ${readiness.filter((item) => item.configured).length}/${readiness.length} integrações com configuração presente.`,
    };
    const items = [supabase, parameters, openai, whatsapp, meta, email, twilio];
    return {
      checkedAt: new Date().toISOString(),
      items,
      healthy: items.filter((item) => item.configured).every((item) => item.ok),
      configuredCount: items.filter((item) => item.configured).length,
      okCount: items.filter((item) => item.ok).length,
    };
  });
