type JsonObject = Record<string, unknown>;

export type AsaasBillingType = "UNDEFINED" | "PIX" | "BOLETO" | "CREDIT_CARD";

export type AsaasPlanInput = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  price_monthly: number | string;
  onboarding_fee?: number | string | null;
};

type AsaasConfig = {
  apiKey: string;
  walletId: string | null;
  apiUrl: string;
};

const ASAAS_API_SECRET = "mercadoimobi_asaas_api_key";
const ASAAS_WALLET_SECRET = "mercadoimobi_asaas_wallet_id";
const PAYMENT_EVENTS = [
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "PAYMENT_REFUNDED",
  "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_DELETED",
  "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
  "PAYMENT_CHARGEBACK_REQUESTED",
] as const;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

async function readPlatformSecret(name: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any).rpc("get_platform_secret", {
      p_name: name,
    });
    if (error || typeof data !== "string" || !data.trim()) return null;
    return data.trim();
  } catch {
    return null;
  }
}

export async function getAsaasConfig(): Promise<AsaasConfig | null> {
  const apiKey =
    process.env["ASAAS_API_KEY"]?.trim() || (await readPlatformSecret(ASAAS_API_SECRET));
  if (!apiKey) return null;
  const walletId =
    process.env["ASAAS_WALLET_ID"]?.trim() || (await readPlatformSecret(ASAAS_WALLET_SECRET));
  const apiUrl = (process.env["ASAAS_API_URL"]?.trim() || "https://api.asaas.com/v3").replace(
    /\/$/,
    "",
  );
  return { apiKey, walletId: walletId || null, apiUrl };
}

export async function asaasConfigured() {
  return Boolean(await getAsaasConfig());
}

async function asaasRequest(
  config: AsaasConfig,
  path: string,
  init: RequestInit = {},
): Promise<JsonObject> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        access_token: config.apiKey,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    const payload = object(await response.json().catch(() => ({})));
    if (!response.ok) {
      const errors = Array.isArray(payload["errors"]) ? payload["errors"] : [];
      const descriptions = errors
        .map((entry) => String(object(entry)["description"] ?? "").trim())
        .filter(Boolean);
      throw new Error(descriptions.join(" | ") || `ASAAS_HTTP_${response.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export function buildAsaasExternalReference(userId: string, planId: string) {
  return `mercadoimobi:${userId}:${planId}`;
}

export function parseAsaasExternalReference(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^mercadoimobi:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(value.trim());
  if (!match) return null;
  return { userId: match[1], planId: match[2] };
}

export function asaasFirstCycleValue(plan: AsaasPlanInput) {
  const monthly = Number(plan.price_monthly ?? 0);
  const onboarding = Number(plan.onboarding_fee ?? 0);
  return Math.round((monthly + Math.max(0, onboarding)) * 100) / 100;
}

export function normalizeAsaasBillingType(value: unknown): AsaasBillingType {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (
    normalized === "PIX" ||
    normalized === "BOLETO" ||
    normalized === "CREDIT_CARD" ||
    normalized === "UNDEFINED"
  ) {
    return normalized;
  }
  return "UNDEFINED";
}

function asaasSafeName(prefix: string, planName: string) {
  return `${prefix} ${planName}`.replace(/\s+/g, " ").trim().slice(0, 30);
}

function resourceId(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const id = (value as JsonObject)["id"];
    return typeof id === "string" && id.trim() ? id.trim() : null;
  }
  return null;
}

async function ensurePaymentWebhook(config: AsaasConfig, origin: string, email?: string | null) {
  const safeOrigin = origin
    .replace(/^http:\/\/([^/]*\.easypanel\.host)/i, "https://$1")
    .replace(/\/$/, "");
  const webhookUrl = `${safeOrigin}/api/public/hooks/asaas`;
  const list = await asaasRequest(config, "/webhooks?offset=0&limit=100", { method: "GET" });
  const data = Array.isArray(list["data"]) ? (list["data"] as JsonObject[]) : [];
  const existing =
    data.find((item) => String(item["url"] ?? "") === webhookUrl) ??
    data.find((item) => String(item["name"] ?? "") === "MercadoImobi - pagamentos");

  const body: JsonObject = {
    name: "MercadoImobi - pagamentos",
    url: webhookUrl,
    enabled: true,
    interrupted: false,
    sendType: "SEQUENTIALLY",
    events: [...PAYMENT_EVENTS],
  };
  const currentEmail = String(existing?.["email"] ?? "").trim();
  if (currentEmail.includes("@")) body["email"] = currentEmail;
  else if (email?.includes("@")) body["email"] = email;

  if (existing) {
    const existingId = resourceId(existing);
    const alreadyCorrect =
      String(existing["url"] ?? "") === webhookUrl &&
      existing["enabled"] === true &&
      existing["interrupted"] === false;
    if (alreadyCorrect) return;
    if (existingId) {
      await asaasRequest(config, `/webhooks/${encodeURIComponent(existingId)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      return;
    }
  }

  await asaasRequest(config, "/webhooks", { method: "POST", body: JSON.stringify(body) });
}

async function createAsaasRecurringPaymentLink(
  config: AsaasConfig,
  input: {
    origin: string;
    userId: string;
    plan: AsaasPlanInput;
    paymentMethod?: AsaasBillingType;
  },
  externalReference: string,
  monthly: number,
  onboarding: number,
) {
  const firstCycle = Math.round((monthly + onboarding) * 100) / 100;
  const description =
    onboarding > 0
      ? `Assinatura ${input.plan.name}. A primeira cobrança inclui a implantação. As próximas cobranças são somente da mensalidade do plano.`
      : `Assinatura mensal MercadoImobi — ${input.plan.name}.`;
  const billingType = normalizeAsaasBillingType(input.paymentMethod);
  const payload = await asaasRequest(config, "/paymentLinks", {
    method: "POST",
    body: JSON.stringify({
      name: asaasSafeName("Plano", input.plan.name),
      description: description.slice(0, 500),
      value: firstCycle,
      billingType,
      chargeType: "RECURRENT",
      subscriptionCycle: "MONTHLY",
      ...(billingType === "BOLETO" || billingType === "UNDEFINED" ? { dueDateLimitDays: 5 } : {}),
      externalReference,
      notificationEnabled: true,
      isAddressRequired: false,
    }),
  });

  const paymentLinkId = resourceId(payload);
  const url = typeof payload["url"] === "string" ? payload["url"] : null;
  if (!paymentLinkId || !url) throw new Error("ASAAS_PAYMENT_LINK_INVALID_RESPONSE");
  return {
    url,
    checkoutId: `paymentLink:${paymentLinkId}`,
    provider: "asaas" as const,
  };
}

export async function createAsaasSubscriptionCheckout(input: {
  origin: string;
  userId: string;
  plan: AsaasPlanInput;
  paymentMethod?: AsaasBillingType;
  customerEmail?: string | null;
}) {
  const config = await getAsaasConfig();
  if (!config) throw new Error("ASAAS_NOT_CONFIGURED");

  await ensurePaymentWebhook(config, input.origin, input.customerEmail);

  const monthly = Number(input.plan.price_monthly ?? 0);
  const onboarding = Math.max(0, Number(input.plan.onboarding_fee ?? 0));
  if (!Number.isFinite(monthly) || monthly <= 0) throw new Error("PLAN_PRICE_INVALID");

  const externalReference = buildAsaasExternalReference(input.userId, String(input.plan.id));
  return createAsaasRecurringPaymentLink(config, input, externalReference, monthly, onboarding);
}

export async function resolveAsaasExternalReference(payment: Record<string, unknown>) {
  const direct = parseAsaasExternalReference(payment["externalReference"]);
  if (direct) return direct;

  const config = await getAsaasConfig();
  if (!config) throw new Error("ASAAS_NOT_CONFIGURED");

  const paymentLinkId = resourceId(payment["paymentLink"]);
  if (paymentLinkId) {
    const paymentLink = await asaasRequest(
      config,
      `/paymentLinks/${encodeURIComponent(paymentLinkId)}`,
      { method: "GET" },
    );
    const fromPaymentLink = parseAsaasExternalReference(paymentLink["externalReference"]);
    if (fromPaymentLink) return fromPaymentLink;
  }

  const subscriptionId = resourceId(payment["subscription"]);
  if (subscriptionId) {
    const subscription = await asaasRequest(
      config,
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { method: "GET" },
    );
    const fromSubscription = parseAsaasExternalReference(subscription["externalReference"]);
    if (fromSubscription) return fromSubscription;
  }

  return null;
}

export async function getAuthoritativeAsaasPayment(paymentId: string) {
  const config = await getAsaasConfig();
  if (!config) throw new Error("ASAAS_NOT_CONFIGURED");
  return asaasRequest(config, `/payments/${encodeURIComponent(paymentId)}`, { method: "GET" });
}

export async function normalizeFutureAsaasSubscriptionValue(
  subscriptionId: string,
  monthlyValue: number,
  description: string,
) {
  const config = await getAsaasConfig();
  if (!config) throw new Error("ASAAS_NOT_CONFIGURED");
  if (!Number.isFinite(monthlyValue) || monthlyValue <= 0) return;
  await asaasRequest(config, `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "PUT",
    body: JSON.stringify({
      value: Math.round(monthlyValue * 100) / 100,
      description: description.slice(0, 500),
      updatePendingPayments: true,
    }),
  });
}

export const __asaasBillingTestUtils = {
  buildAsaasExternalReference,
  parseAsaasExternalReference,
  asaasFirstCycleValue,
  normalizeAsaasBillingType,
};
