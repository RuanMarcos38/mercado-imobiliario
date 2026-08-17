export type PlatformParameterDefinition = {
  key: string;
  label: string;
  category: string;
  value: string | number | boolean;
  defaultValue: string | number | boolean;
  description: string;
  secret?: boolean;
};

function numberEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function integerEnv(name: string, fallback: number, min: number, max: number) {
  return Math.round(numberEnv(name, fallback, min, max));
}

function stringEnv(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback;
}

export function speedToLeadParameters() {
  return {
    slaSeconds: integerEnv("SPEED_TO_LEAD_SLA_SECONDS", 300, 30, 3600),
    metricsDays: integerEnv("SPEED_TO_LEAD_METRICS_DAYS", 7, 1, 90),
    historyDays: integerEnv("SPEED_TO_LEAD_HISTORY_DAYS", 30, 7, 365),
    distributionLookbackHours: integerEnv("LEAD_DISTRIBUTION_LOOKBACK_HOURS", 24, 1, 720),
    maxLeadsQuery: integerEnv("SPEED_TO_LEAD_MAX_LEADS_QUERY", 5000, 100, 20000),
    maxConversationsQuery: integerEnv("SPEED_TO_LEAD_MAX_CONVERSATIONS_QUERY", 3000, 100, 10000),
    maxMessagesQuery: integerEnv("SPEED_TO_LEAD_MAX_MESSAGES_QUERY", 10000, 500, 50000),
    maxDistributionSample: integerEnv("LEAD_DISTRIBUTION_MAX_SAMPLE", 5000, 100, 20000),
  };
}

export function aiParameters() {
  return {
    model: stringEnv("OPENAI_MODEL", "gpt-5.6"),
    requestTimeoutMs: integerEnv("AI_REQUEST_TIMEOUT_MS", 30000, 5000, 120000),
    historyMessages: integerEnv("AI_HISTORY_MESSAGES", 20, 4, 100),
    testMaxOutputTokens: integerEnv("AI_DIAGNOSTIC_MAX_OUTPUT_TOKENS", 8, 4, 64),
  };
}

export function whatsappParameters() {
  return {
    sendDelayMs: integerEnv("WHATSAPP_SEND_DELAY_MS", 800, 0, 10000),
    maxAttachmentMb: integerEnv("WHATSAPP_ATTACHMENT_MAX_MB", 8, 1, 32),
    evolutionTimeoutMs: integerEnv("EVOLUTION_REQUEST_TIMEOUT_MS", 25000, 5000, 120000),
  };
}

export function documentParameters() {
  return {
    ccaBucket: stringEnv("CCA_DOCUMENT_BUCKET", "cca-documents"),
    ccaDocumentMaxMb: integerEnv("CCA_DOCUMENT_MAX_MB", 12, 1, 50),
    ccaSignedUrlTtlSeconds: integerEnv("CCA_SIGNED_URL_TTL_SECONDS", 900, 60, 86400),
    ccaRequestTimeoutMs: integerEnv("CCA_REQUEST_TIMEOUT_MS", 30000, 5000, 120000),
    emailAttachmentMaxMb: integerEnv("CCA_EMAIL_ATTACHMENT_MAX_MB", 25, 1, 40),
    emailRequestTimeoutMs: integerEnv("EMAIL_REQUEST_TIMEOUT_MS", 45000, 5000, 120000),
  };
}

export function externalServiceParameters() {
  return {
    stripeTimeoutMs: integerEnv("STRIPE_REQUEST_TIMEOUT_MS", 20000, 5000, 120000),
    metaTimeoutMs: integerEnv("META_REQUEST_TIMEOUT_MS", 25000, 5000, 120000),
    twilioTimeoutMs: integerEnv("TWILIO_REQUEST_TIMEOUT_MS", 25000, 5000, 120000),
    diagnosticTimeoutMs: integerEnv("DIAGNOSTIC_REQUEST_TIMEOUT_MS", 15000, 3000, 60000),
    voiceBridgeTokenMinutes: integerEnv("VOICE_BRIDGE_TOKEN_MINUTES", 5, 1, 30),
  };
}

export function platformBaseUrl() {
  return stringEnv(
    "MERCADOIMOBI_BASE_URL",
    "https://mercadoimobi.rdmconsultoriaimobiliaria.com.br",
  ).replace(/\/$/, "");
}

export function platformParameterDefinitions(): PlatformParameterDefinition[] {
  const speed = speedToLeadParameters();
  const ai = aiParameters();
  const whatsapp = whatsappParameters();
  const docs = documentParameters();
  const services = externalServiceParameters();

  return [
    { key: "SPEED_TO_LEAD_SLA_SECONDS", label: "SLA de primeira resposta", category: "Speed to Lead", value: speed.slaSeconds, defaultValue: 300, description: "Tempo alvo em segundos para a primeira resposta ao lead." },
    { key: "SPEED_TO_LEAD_METRICS_DAYS", label: "Janela de métricas", category: "Speed to Lead", value: speed.metricsDays, defaultValue: 7, description: "Quantidade de dias exibidos nas métricas operacionais." },
    { key: "SPEED_TO_LEAD_HISTORY_DAYS", label: "Janela histórica", category: "Speed to Lead", value: speed.historyDays, defaultValue: 30, description: "Período máximo consultado para histórico de leads e mensagens." },
    { key: "LEAD_DISTRIBUTION_LOOKBACK_HOURS", label: "Janela da roleta", category: "Speed to Lead", value: speed.distributionLookbackHours, defaultValue: 24, description: "Horas consideradas para balancear a carga da roleta." },
    { key: "OPENAI_MODEL", label: "Modelo de IA", category: "Inteligência artificial", value: ai.model, defaultValue: "gpt-5.6", description: "Modelo usado nas respostas e sugestões do agente." },
    { key: "AI_REQUEST_TIMEOUT_MS", label: "Timeout da IA", category: "Inteligência artificial", value: ai.requestTimeoutMs, defaultValue: 30000, description: "Tempo máximo de espera por uma resposta da OpenAI." },
    { key: "AI_HISTORY_MESSAGES", label: "Memória curta da conversa", category: "Inteligência artificial", value: ai.historyMessages, defaultValue: 20, description: "Quantidade máxima de mensagens recentes usadas como contexto." },
    { key: "WHATSAPP_SEND_DELAY_MS", label: "Delay de envio WhatsApp", category: "WhatsApp", value: whatsapp.sendDelayMs, defaultValue: 800, description: "Delay técnico aplicado antes do envio de texto pela Evolution." },
    { key: "WHATSAPP_ATTACHMENT_MAX_MB", label: "Anexo máximo WhatsApp", category: "WhatsApp", value: whatsapp.maxAttachmentMb, defaultValue: 8, description: "Limite em MB para anexos enviados no Atendimento." },
    { key: "EVOLUTION_REQUEST_TIMEOUT_MS", label: "Timeout Evolution", category: "WhatsApp", value: whatsapp.evolutionTimeoutMs, defaultValue: 25000, description: "Tempo máximo para chamadas à Evolution API." },
    { key: "CCA_DOCUMENT_MAX_MB", label: "Documento máximo CCA", category: "Documentos / CCA", value: docs.ccaDocumentMaxMb, defaultValue: 12, description: "Tamanho máximo de cada documento do dossiê." },
    { key: "CCA_SIGNED_URL_TTL_SECONDS", label: "Validade de link CCA", category: "Documentos / CCA", value: docs.ccaSignedUrlTtlSeconds, defaultValue: 900, description: "Validade do link temporário usado no envio do dossiê." },
    { key: "CCA_EMAIL_ATTACHMENT_MAX_MB", label: "Dossiê máximo por e-mail", category: "Documentos / CCA", value: docs.emailAttachmentMaxMb, defaultValue: 25, description: "Limite total de anexos por envio de e-mail ao CCA." },
    { key: "CCA_REQUEST_TIMEOUT_MS", label: "Timeout conector CCA", category: "Documentos / CCA", value: docs.ccaRequestTimeoutMs, defaultValue: 30000, description: "Tempo máximo de resposta do conector contratado do CCA." },
    { key: "EMAIL_REQUEST_TIMEOUT_MS", label: "Timeout de e-mail", category: "Integrações", value: docs.emailRequestTimeoutMs, defaultValue: 45000, description: "Tempo máximo para envio do e-mail com documentação." },
    { key: "STRIPE_REQUEST_TIMEOUT_MS", label: "Timeout Stripe", category: "Integrações", value: services.stripeTimeoutMs, defaultValue: 20000, description: "Tempo máximo das operações de cobrança." },
    { key: "META_REQUEST_TIMEOUT_MS", label: "Timeout Meta", category: "Integrações", value: services.metaTimeoutMs, defaultValue: 25000, description: "Tempo máximo das chamadas Facebook/Instagram." },
    { key: "TWILIO_REQUEST_TIMEOUT_MS", label: "Timeout telefonia", category: "Integrações", value: services.twilioTimeoutMs, defaultValue: 25000, description: "Tempo máximo das chamadas à API de telefonia." },
    { key: "VOICE_BRIDGE_TOKEN_MINUTES", label: "Validade do token do discador", category: "Integrações", value: services.voiceBridgeTokenMinutes, defaultValue: 5, description: "Validade em minutos do token temporário usado para ligar corretor e cliente." },
  ];
}

export function integrationReadiness() {
  return [
    { key: "openai", label: "OpenAI", configured: Boolean(process.env["OPENAI_API_KEY"]?.trim()) },
    { key: "whatsapp", label: "Evolution / WhatsApp", configured: Boolean(process.env["EVOLUTION_API_URL"]?.trim() && process.env["EVOLUTION_API_KEY"]?.trim()) },
    { key: "meta", label: "Facebook / Instagram", configured: Boolean(process.env["META_APP_ID"]?.trim() && process.env["META_APP_SECRET"]?.trim()) },
    { key: "google", label: "Google Maps / Places", configured: Boolean(process.env["GOOGLE_MAPS_API_KEY"]?.trim()) },
    { key: "email", label: "E-mail / Resend", configured: Boolean(process.env["RESEND_API_KEY"]?.trim() && process.env["EMAIL_FROM"]?.trim()) },
    { key: "stripe", label: "Stripe", configured: Boolean(process.env["STRIPE_SECRET_KEY"]?.trim() && process.env["STRIPE_PRICE_ID"]?.trim()) },
    { key: "twilio", label: "Discador / Twilio", configured: Boolean(process.env["TWILIO_ACCOUNT_SID"]?.trim() && process.env["TWILIO_AUTH_TOKEN"]?.trim() && process.env["TWILIO_PHONE_NUMBER"]?.trim()) },
    { key: "cca", label: "Conector CCA", configured: Boolean(process.env["CCA_INTEGRATION_URL"]?.trim()) },
    { key: "lead-webhook", label: "Captação de leads", configured: Boolean(process.env["LEAD_WEBHOOK_SECRET"]?.trim() || process.env["INTEGRATIONS_ENCRYPTION_KEY"]?.trim() || process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim()) },
  ];
}

export const __parameterTestUtils = { numberEnv, integerEnv, stringEnv };
