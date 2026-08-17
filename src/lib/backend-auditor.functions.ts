import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";
import {
  aiParameters,
  documentParameters,
  externalServiceParameters,
  platformBaseUrl,
} from "@/lib/platform-parameters.server";

export type BackendAuditStatus = "pass" | "warn" | "fail" | "not_configured";

export type BackendAuditCheck = {
  key: string;
  label: string;
  category: string;
  critical: boolean;
  configured: boolean;
  status: BackendAuditStatus;
  detail: string;
  durationMs: number;
};

export type BackendAuditResult = {
  checkedAt: string;
  durationMs: number;
  checks: BackendAuditCheck[];
  passed: number;
  warnings: number;
  failed: number;
  notConfigured: number;
  verificationPercent: number;
  coreReady: boolean;
  productionReady: boolean;
  backend100: boolean;
  assistantReport: string;
};

const chatSchema = z.object({
  question: z.string().trim().min(2).max(1200),
  checkedAt: z.string().max(80),
  checks: z
    .array(
      z.object({
        key: z.string().max(80),
        label: z.string().max(160),
        category: z.string().max(120),
        critical: z.boolean(),
        configured: z.boolean(),
        status: z.enum(["pass", "warn", "fail", "not_configured"]),
        detail: z.string().max(800),
        durationMs: z.number().nonnegative().max(300000),
      }),
    )
    .max(60),
});

async function requirePlatformAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("FORBIDDEN_ADMIN");
}

function check(
  input: Omit<BackendAuditCheck, "durationMs"> & { durationMs?: number },
): BackendAuditCheck {
  return { ...input, durationMs: Math.max(0, Math.round(input.durationMs ?? 0)) };
}

async function timed(
  factory: () => Promise<Omit<BackendAuditCheck, "durationMs">>,
): Promise<BackendAuditCheck> {
  const started = Date.now();
  try {
    return check({ ...(await factory()), durationMs: Date.now() - started });
  } catch (error) {
    return check({
      key: "unexpected",
      label: "Teste inesperado",
      category: "Backend",
      critical: true,
      configured: true,
      status: "fail",
      detail: error instanceof Error ? error.message : "Falha inesperada no autoteste.",
      durationMs: Date.now() - started,
    });
  }
}

function extractOpenAiText(payload: any) {
  return (payload?.output ?? [])
    .flatMap((item: any) => item?.content ?? [])
    .filter((item: any) => item?.type === "output_text" && typeof item?.text === "string")
    .map((item: any) => String(item.text).trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function openAiText(input: unknown, instructions: string) {
  const apiKey = process.env["OPENAI_API_KEY"]?.trim();
  if (!apiKey) return null;
  const parameters = aiParameters();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: parameters.model,
      instructions,
      input,
      store: false,
      max_output_tokens: 650,
    }),
    signal: AbortSignal.timeout(parameters.requestTimeoutMs),
  });
  if (!response.ok) return null;
  return extractOpenAiText(await response.json().catch(() => ({}))) || null;
}

function deterministicReport(checks: BackendAuditCheck[]) {
  const failed = checks.filter((item) => item.status === "fail");
  const warnings = checks.filter((item) => item.status === "warn");
  const missing = checks.filter((item) => item.status === "not_configured");
  const passed = checks.filter((item) => item.status === "pass");
  const total = checks.length || 1;
  const percent = Math.round((passed.length / total) * 100);
  if (!failed.length && !warnings.length && !missing.length) {
    return `Auditoria concluída: ${checks.length}/${checks.length} verificações aprovadas. Backend validado em 100% dos testes executados, sem pendências detectadas neste ciclo.`;
  }
  const blockers = failed
    .slice(0, 4)
    .map((item) => item.label)
    .join(", ");
  const pending = [...warnings, ...missing]
    .slice(0, 5)
    .map((item) => item.label)
    .join(", ");
  return [
    `Auditoria concluída com ${percent}% das verificações aprovadas (${passed.length}/${checks.length}).`,
    failed.length
      ? `Falhas que exigem correção: ${blockers}.`
      : "Nenhuma falha crítica foi detectada.",
    pending ? `Itens pendentes ou não totalmente verificáveis: ${pending}.` : "",
    "O sistema só deve ser considerado 100% quando todas as verificações estiverem aprovadas.",
  ]
    .filter(Boolean)
    .join(" ");
}

async function testDatabaseTable(db: any, table: string, label: string, critical = true) {
  return timed(async () => {
    const result = await db.from(table).select("*", { count: "exact", head: true });
    return {
      key: `db:${table}`,
      label,
      category: "Banco de dados",
      critical,
      configured: true,
      status: result.error ? ("fail" as const) : ("pass" as const),
      detail: result.error
        ? `Tabela indisponível: ${String(result.error.message ?? result.error)}`
        : `Tabela acessível${typeof result.count === "number" ? ` (${result.count} registros).` : "."}`,
    };
  });
}

async function testSearchHealth(db: any) {
  return timed(async () => {
    const result = await db.rpc("search_index_health");
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    const count = Number(row?.count ?? 0);
    const ok = !result.error && Number.isFinite(count) && count > 0;
    return {
      key: "search-index",
      label: "Índice de imóveis",
      category: "Busca imobiliária",
      critical: true,
      configured: true,
      status: ok ? ("pass" as const) : ("fail" as const),
      detail: result.error
        ? `Falha no search_index_health: ${result.error.message}`
        : ok
          ? `${count.toLocaleString("pt-BR")} imóveis indexados; índice consultável.`
          : "O índice respondeu, mas não possui imóveis disponíveis.",
    };
  });
}

async function testPublicApplication() {
  return timed(async () => {
    const baseUrl = platformBaseUrl();
    const statusUrl = new URL("/api/public/status", `${baseUrl}/`).toString();
    try {
      const response = await fetch(statusUrl, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": "MercadoImobi-Backend-Auditor/1.0" },
        signal: AbortSignal.timeout(externalServiceParameters().diagnosticTimeoutMs),
      });
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!response.ok || !contentType.includes("application/json")) {
        return {
          key: "public-app",
          label: "Aplicação pública / roteamento",
          category: "Infraestrutura",
          critical: true,
          configured: Boolean(baseUrl),
          status: "fail" as const,
          detail: `/api/public/status não entregou o backend MercadoImobi (HTTP ${response.status}, ${contentType || "sem content-type"}).`,
        };
      }
      const payload = await response.json().catch(() => null);
      const status =
        payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
      const indexed = Number(status?.["indexedProperties"] ?? 0);
      const states = Number(status?.["coveredStates"] ?? 0);
      const ok =
        status?.["status"] === "operational" &&
        status?.["search"] === "available" &&
        Number.isFinite(indexed) &&
        indexed >= 1000 &&
        Number.isFinite(states) &&
        states >= 27;
      return {
        key: "public-app",
        label: "Aplicação pública / roteamento",
        category: "Infraestrutura",
        critical: true,
        configured: Boolean(baseUrl),
        status: ok ? ("pass" as const) : ("fail" as const),
        detail: ok
          ? `Backend público operacional: ${indexed.toLocaleString("pt-BR")} imóveis em ${states} UFs.`
          : `O endpoint respondeu JSON, mas falhou no healthcheck (status=${String(status?.["status"] ?? "ausente")}, search=${String(status?.["search"] ?? "ausente")}, imóveis=${indexed}, UFs=${states}).`,
      };
    } catch {
      return {
        key: "public-app",
        label: "Aplicação pública / roteamento",
        category: "Infraestrutura",
        critical: true,
        configured: Boolean(baseUrl),
        status: "fail" as const,
        detail: "Não foi possível validar /api/public/status no endereço público configurado.",
      };
    }
  });
}

async function testAuthRuntime(db: any, userId: string) {
  return timed(async () => {
    const result = await db.auth.getUser();
    const resolvedUserId = result.data?.user?.id ?? null;
    const ok = !result.error && resolvedUserId === userId;
    return {
      key: "auth-runtime",
      label: "Autenticação Supabase",
      category: "Segurança",
      critical: true,
      configured: true,
      status: ok ? ("pass" as const) : ("fail" as const),
      detail: ok
        ? "Sessão autenticada validada pelo backend com RLS ativo."
        : `Falha de autenticação: ${result.error?.message ?? "sessão não corresponde ao usuário autenticado"}.`,
    };
  });
}

async function testJoinvilleSourceDiversity(db: any) {
  return timed(async () => {
    const result = await db.rpc("property_region_search_health", {
      p_city: "Joinville",
      p_state: "SC",
    });
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    const market = Number(row?.market ?? 0);
    const caixa = Number(row?.caixa ?? 0);
    const sources = Number(row?.sources ?? 0);
    const marketSources = Array.isArray(row?.market_sources)
      ? row.market_sources.filter(Boolean).map(String)
      : [];
    const ok = !result.error && market >= 3 && marketSources.length >= 2;
    return {
      key: "search-joinville-diversity",
      label: "Teste IA de pesquisa — Joinville",
      category: "Busca imobiliária",
      critical: true,
      configured: true,
      status: ok ? ("pass" as const) : ("fail" as const),
      detail: result.error
        ? `Falha no teste regional: ${result.error.message}`
        : ok
          ? `Joinville retornou ${market} imóveis de mercado em ${marketSources.length} fontes (${marketSources.join(", ")}) + ${caixa} CAIXA.`
          : `Joinville ainda não possui diversidade suficiente: mercado=${market}, fontes de mercado=${marketSources.length}, CAIXA=${caixa}, fontes totais=${sources}.`,
    };
  });
}

async function testStorage() {
  return timed(async () => {
    const bucket = documentParameters().ccaBucket;
    if (!process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim()) {
      return {
        key: "storage-cca",
        label: "Storage privado de documentos",
        category: "Documentos / CCA",
        critical: false,
        configured: false,
        status: "not_configured" as const,
        detail:
          "Verificação administrativa do Storage requer SUPABASE_SERVICE_ROLE_KEY no runtime do servidor; o backend principal continua usando a sessão autenticada com RLS.",
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await supabaseAdmin.storage.getBucket(bucket);
    if (result.data) {
      return {
        key: "storage-cca",
        label: "Storage privado de documentos",
        category: "Documentos / CCA",
        critical: false,
        configured: true,
        status: "pass" as const,
        detail: `Bucket privado ${bucket} disponível.`,
      };
    }
    if (
      result.error &&
      !String(result.error.message ?? "")
        .toLowerCase()
        .includes("not found")
    ) {
      return {
        key: "storage-cca",
        label: "Storage privado de documentos",
        category: "Documentos / CCA",
        critical: false,
        configured: true,
        status: "warn" as const,
        detail: `Storage respondeu com alerta: ${String(result.error.message ?? result.error)}.`,
      };
    }
    return {
      key: "storage-cca",
      label: "Storage privado de documentos",
      category: "Documentos / CCA",
      critical: false,
      configured: true,
      status: "warn" as const,
      detail:
        "Bucket ainda não existe. O backend o cria automaticamente no primeiro upload de documento.",
    };
  });
}

async function testOpenAi() {
  return timed(async () => {
    const apiKey = process.env["OPENAI_API_KEY"]?.trim();
    if (!apiKey) {
      return {
        key: "openai-live",
        label: "OpenAI / agente de IA",
        category: "Inteligência artificial",
        critical: false,
        configured: false,
        status: "not_configured" as const,
        detail: "OPENAI_API_KEY ausente no ambiente do servidor.",
      };
    }
    const text = await openAiText(
      [{ role: "user", content: "Teste técnico. Responda somente OK." }],
      "Você é um teste de saúde. Responda somente OK.",
    );
    const ok = Boolean(text);
    return {
      key: "openai-live",
      label: "OpenAI / agente de IA",
      category: "Inteligência artificial",
      critical: false,
      configured: true,
      status: ok ? ("pass" as const) : ("fail" as const),
      detail: ok
        ? `Resposta sintética recebida usando ${aiParameters().model}.`
        : "A OpenAI está configurada, mas o teste sintético não retornou resposta válida.",
    };
  });
}

async function testWhatsApp(db: any, tenantId: string) {
  return timed(async () => {
    const { evolutionGatewayConfig, evolutionRequest, getTenantEvolutionInstance } =
      await import("@/lib/evolution-instance.server");
    const gateway = evolutionGatewayConfig();
    const instance = await getTenantEvolutionInstance(db, tenantId);
    if (!gateway || !instance) {
      return {
        key: "whatsapp-live",
        label: "WhatsApp / Evolution",
        category: "Comunicação",
        critical: false,
        configured: false,
        status: "not_configured" as const,
        detail: "Gateway Evolution ou instância do tenant não configurados.",
      };
    }
    const response = await evolutionRequest(
      gateway,
      `/instance/connectionState/${encodeURIComponent(instance)}`,
      { method: "GET" },
    );
    const payload = await response.json().catch(() => ({}));
    const raw = String(
      payload?.instance?.state ?? payload?.state ?? payload?.status ?? "",
    ).toLowerCase();
    const ok = response.ok && ["open", "connected", "online"].includes(raw);
    return {
      key: "whatsapp-live",
      label: "WhatsApp / Evolution",
      category: "Comunicação",
      critical: false,
      configured: true,
      status: ok ? ("pass" as const) : ("fail" as const),
      detail: ok
        ? `Instância ${instance} online e autenticada.`
        : `Instância ${instance}: ${raw || `HTTP ${response.status}`}.`,
    };
  });
}

async function testMeta(tenantId: string, userId: string) {
  return timed(async () => {
    const { testMetaConnection } = await import("@/lib/meta-social.server");
    const result = await testMetaConnection(tenantId, userId);
    return {
      key: "meta-live",
      label: "Facebook / Instagram",
      category: "Comunicação",
      critical: false,
      configured: result.configured && result.connected !== false,
      status:
        !result.configured || !result.connected
          ? ("not_configured" as const)
          : result.ok
            ? ("pass" as const)
            : ("fail" as const),
      detail: result.ok
        ? "Token Meta da conta validado com sucesso."
        : result.connected
          ? String(result.error ?? "A conexão Meta falhou no teste.")
          : "Conta Meta ainda não conectada para este usuário.",
    };
  });
}

async function testEmail() {
  return timed(async () => {
    const { verifyEmailRuntime } = await import("@/lib/smtp-email.server");
    try {
      const result = await verifyEmailRuntime();
      if (!result.configured) {
        return {
          key: "email-live",
          label: "E-mail / SMTP",
          category: "Comunicação",
          critical: false,
          configured: false,
          status: "not_configured" as const,
          detail: "SMTP Hostinger ou Resend ainda não configurados.",
        };
      }
      const provider = result.provider === "smtp-hostinger" ? "SMTP Hostinger" : "Resend";
      return {
        key: "email-live",
        label: "E-mail / SMTP",
        category: "Comunicação",
        critical: false,
        configured: true,
        status: result.ok ? ("pass" as const) : ("fail" as const),
        detail: result.ok
          ? `${provider} autenticado para o remetente ${result.from}.`
          : `${provider} configurado, mas a autenticação falhou.`,
      };
    } catch (error) {
      return {
        key: "email-live",
        label: "E-mail / SMTP",
        category: "Comunicação",
        critical: false,
        configured: true,
        status: "fail" as const,
        detail:
          error instanceof Error
            ? `Falha de autenticação SMTP: ${error.message.slice(0, 180)}`
            : "Falha de autenticação do provedor de e-mail.",
      };
    }
  });
}

async function testTwilio() {
  return timed(async () => {
    const { testTwilioRuntime } = await import("@/lib/dialer.functions");
    const result = await testTwilioRuntime();
    return {
      key: "twilio-live",
      label: "Discador / Twilio",
      category: "Comunicação",
      critical: false,
      configured: result.configured,
      status: !result.configured
        ? ("not_configured" as const)
        : result.ok
          ? ("pass" as const)
          : ("fail" as const),
      detail: result.ok
        ? "Conta Twilio autenticada; discador apto para iniciar chamadas."
        : result.configured
          ? `Twilio HTTP ${result.status ?? "falhou"}.`
          : "Credenciais Twilio não configuradas.",
    };
  });
}

async function testStripe() {
  return timed(async () => {
    const secret = process.env["STRIPE_SECRET_KEY"]?.trim();
    const priceId = process.env["STRIPE_PRICE_ID"]?.trim();
    if (!secret || !priceId) {
      return {
        key: "stripe-live",
        label: "Assinaturas / Stripe",
        category: "Cobrança",
        critical: false,
        configured: false,
        status: "not_configured" as const,
        detail: "STRIPE_SECRET_KEY ou STRIPE_PRICE_ID ausentes.",
      };
    }
    const response = await fetch("https://api.stripe.com/v1/account", {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(externalServiceParameters().stripeTimeoutMs),
    });
    return {
      key: "stripe-live",
      label: "Assinaturas / Stripe",
      category: "Cobrança",
      critical: false,
      configured: true,
      status: response.ok ? ("pass" as const) : ("fail" as const),
      detail: response.ok
        ? "Conta Stripe autenticada e backend de cobrança acessível."
        : `Stripe HTTP ${response.status}.`,
    };
  });
}

async function testGoogleMaps() {
  return timed(async () => {
    const key = process.env["GOOGLE_MAPS_API_KEY"]?.trim();
    if (!key) {
      return {
        key: "google-maps-live",
        label: "Google Maps / Geocoding",
        category: "Análise de localização",
        critical: false,
        configured: false,
        status: "not_configured" as const,
        detail: "GOOGLE_MAPS_API_KEY ausente.",
      };
    }
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", "Brasília, DF, Brasil");
    url.searchParams.set("key", key);
    url.searchParams.set("language", "pt-BR");
    const response = await fetch(url, {
      signal: AbortSignal.timeout(externalServiceParameters().diagnosticTimeoutMs),
    });
    const payload = await response.json().catch(() => ({}));
    const ok =
      response.ok &&
      payload?.status === "OK" &&
      Array.isArray(payload?.results) &&
      payload.results.length > 0;
    return {
      key: "google-maps-live",
      label: "Google Maps / Geocoding",
      category: "Análise de localização",
      critical: false,
      configured: true,
      status: ok ? ("pass" as const) : ("fail" as const),
      detail: ok
        ? "Geocoding API respondeu com coordenadas válidas."
        : `Google Maps: ${String(payload?.status ?? `HTTP ${response.status}`)}${payload?.error_message ? ` — ${String(payload.error_message).slice(0, 160)}` : ""}.`,
    };
  });
}

async function testIbge() {
  return timed(async () => {
    const response = await fetch(
      "https://servicodados.ibge.gov.br/api/v1/localidades/estados/SC/municipios?orderBy=nome",
      { signal: AbortSignal.timeout(externalServiceParameters().diagnosticTimeoutMs) },
    );
    const payload = await response.json().catch(() => []);
    const ok = response.ok && Array.isArray(payload) && payload.length > 0;
    return {
      key: "ibge-live",
      label: "IBGE / dados públicos",
      category: "Análise de localização",
      critical: false,
      configured: true,
      status: ok ? ("pass" as const) : ("fail" as const),
      detail: ok
        ? `API do IBGE respondeu com ${payload.length} municípios de SC.`
        : `IBGE HTTP ${response.status}.`,
    };
  });
}

async function testLeadWebhook(tenantId: string) {
  return timed(async () => {
    try {
      const { createLeadWebhookSignature, createLeadWebhookUrl, verifyLeadWebhookSignature } =
        await import("@/lib/lead-operations.server");
      const signature = createLeadWebhookSignature(tenantId, "meta");
      const valid = verifyLeadWebhookSignature(tenantId, "meta", signature);
      const invalidCrossSource = verifyLeadWebhookSignature(tenantId, "google", signature);
      const url = createLeadWebhookUrl(tenantId, "meta");
      const ok = Boolean(signature && valid && !invalidCrossSource && url);
      return {
        key: "lead-webhook",
        label: "Captação assinada de leads",
        category: "Speed to Lead",
        critical: true,
        configured: ok,
        status: ok ? ("pass" as const) : ("fail" as const),
        detail: ok
          ? "Assinatura, isolamento por origem e URL de ingestão validados."
          : "A assinatura do webhook de leads não passou na validação interna.",
      };
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Falha no teste de assinatura do webhook.";
      const missingSecret = detail.includes("LEAD_WEBHOOK_SECRET_MISSING");
      return {
        key: "lead-webhook",
        label: "Captação assinada de leads",
        category: "Speed to Lead",
        critical: true,
        configured: false,
        status: missingSecret ? ("not_configured" as const) : ("fail" as const),
        detail: missingSecret
          ? "LEAD_WEBHOOK_SECRET ainda não está disponível neste runtime; a captação permanece bloqueada até o segredo seguro ser configurado."
          : detail,
      };
    }
  });
}

async function testCcaConnector() {
  return timed(async () => {
    const endpoint = process.env["CCA_INTEGRATION_URL"]?.trim();
    const healthUrl = process.env["CCA_HEALTHCHECK_URL"]?.trim();
    if (!endpoint) {
      return {
        key: "cca-connector",
        label: "Conector direto CCA",
        category: "Documentos / CCA",
        critical: false,
        configured: false,
        status: "not_configured" as const,
        detail:
          "CCA_INTEGRATION_URL não configurada; o dossiê continua disponível para envio por e-mail.",
      };
    }
    if (!healthUrl) {
      return {
        key: "cca-connector",
        label: "Conector direto CCA",
        category: "Documentos / CCA",
        critical: false,
        configured: true,
        status: "warn" as const,
        detail:
          "Endpoint CCA configurado, mas sem CCA_HEALTHCHECK_URL. Não é seguro disparar um dossiê real durante o autoteste.",
      };
    }
    const token = process.env["CCA_INTEGRATION_TOKEN"]?.trim();
    const response = await fetch(healthUrl, {
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(documentParameters().ccaRequestTimeoutMs),
    });
    return {
      key: "cca-connector",
      label: "Conector direto CCA",
      category: "Documentos / CCA",
      critical: false,
      configured: true,
      status: response.ok ? ("pass" as const) : ("fail" as const),
      detail: response.ok
        ? `Healthcheck CCA respondeu HTTP ${response.status}.`
        : `Healthcheck CCA respondeu HTTP ${response.status}.`,
    };
  });
}

export const runBackendAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BackendAuditResult> => {
    await requirePlatformAdmin(context);
    const started = Date.now();
    const tenantId = await requireTenantId(context.supabase, context.userId);
    // A auditoria já roda dentro de uma sessão autenticada. Usar esse cliente
    // preserva RLS/tenant e evita transformar a ausência de service role em
    // dezenas de falsos "Teste inesperado" no backend principal.
    const db = context.supabase as any;

    const tables: Array<[string, string, boolean?]> = [
      ["profiles", "Perfis de usuários"],
      ["user_roles", "Papéis e permissões"],
      ["tenants", "Organizações / tenants"],
      ["tenant_members", "Membros das organizações"],
      ["leads", "CRM / oportunidades"],
      ["whatsapp_connections", "Conexões WhatsApp"],
      ["whatsapp_conversations", "Conversas WhatsApp"],
      ["whatsapp_messages", "Mensagens WhatsApp"],
      ["ai_agent_settings", "Configuração do agente IA"],
      ["subscriptions", "Assinaturas"],
      ["subscription_plans", "Planos de assinatura"],
      ["property_search_index", "Índice de busca de imóveis"],
    ];

    const coreChecks = await Promise.all([
      testAuthRuntime(db, context.userId),
      timed(async () => ({
        key: "tenant-runtime",
        label: "Isolamento por tenant",
        category: "Segurança",
        critical: true,
        configured: true,
        status: tenantId ? ("pass" as const) : ("fail" as const),
        detail: tenantId ? "Tenant do usuário resolvido pelo backend." : "Tenant não resolvido.",
      })),
      ...tables.map(([table, label, critical]) =>
        testDatabaseTable(db, table, label, critical ?? true),
      ),
      testSearchHealth(db),
      testJoinvilleSourceDiversity(db),
      testStorage(),
      testLeadWebhook(tenantId),
      testPublicApplication(),
    ]);

    const integrationChecks = await Promise.all([
      testOpenAi(),
      testWhatsApp(db, tenantId),
      testMeta(tenantId, context.userId),
      testEmail(),
      testTwilio(),
      testStripe(),
      testGoogleMaps(),
      testIbge(),
      testCcaConnector(),
    ]);

    const checks = [...coreChecks, ...integrationChecks];
    const passed = checks.filter((item) => item.status === "pass").length;
    const warnings = checks.filter((item) => item.status === "warn").length;
    const failed = checks.filter((item) => item.status === "fail").length;
    const notConfigured = checks.filter((item) => item.status === "not_configured").length;
    const verificationPercent = checks.length ? Math.round((passed / checks.length) * 100) : 0;
    const coreReady = checks
      .filter((item) => item.critical)
      .every((item) => item.status === "pass");
    const productionReady = coreReady && failed === 0;
    const backend100 = checks.length > 0 && checks.every((item) => item.status === "pass");
    const fallback = deterministicReport(checks);

    let assistantReport = fallback;
    if (process.env["OPENAI_API_KEY"]?.trim()) {
      try {
        const ai = await openAiText(
          JSON.stringify({
            checkedAt: new Date().toISOString(),
            verificationPercent,
            coreReady,
            productionReady,
            backend100,
            checks: checks.map(
              ({ key, label, category, critical, configured, status, detail }) => ({
                key,
                label,
                category,
                critical,
                configured,
                status,
                detail,
              }),
            ),
          }),
          [
            "Você é o Auditor Técnico do backend do MercadoImobi.",
            "Analise somente os fatos do JSON recebido; nunca invente que algo está funcionando.",
            "Responda em português do Brasil, em até 8 frases curtas.",
            "Diga claramente se o backend chegou ou não a 100% das verificações.",
            "Priorize falhas críticas, depois integrações configuradas que falharam, depois itens não configurados.",
            "Não exponha nem peça chaves, tokens, senhas ou segredos.",
          ].join("\n"),
        );
        if (ai) assistantReport = ai;
      } catch {
        assistantReport = fallback;
      }
    }

    return {
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      checks,
      passed,
      warnings,
      failed,
      notConfigured,
      verificationPercent,
      coreReady,
      productionReady,
      backend100,
      assistantReport,
    };
  });

export const askBackendAuditAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => chatSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context);
    const fallback = deterministicReport(data.checks);
    if (!process.env["OPENAI_API_KEY"]?.trim()) {
      return {
        text: `${fallback} A IA do auditor não está configurada para responder perguntas adicionais.`,
      };
    }
    const text = await openAiText(
      JSON.stringify({ question: data.question, checkedAt: data.checkedAt, checks: data.checks }),
      [
        "Você é o Chatbot Auditor Técnico do MercadoImobi.",
        "Responda exclusivamente com base no relatório de testes fornecido.",
        "Não afirme que um item funciona se o status não for pass.",
        "Se perguntarem se está 100%, só responda sim quando todos os checks estiverem pass.",
        "Explique correções em ordem de prioridade e sem revelar segredos.",
        "Português do Brasil, objetivo, máximo 10 frases.",
      ].join("\n"),
    );
    return { text: text || fallback };
  });
