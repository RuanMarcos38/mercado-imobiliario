type JsonObject = Record<string, unknown>;

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
    const { data, error } = await (supabaseAdmin as any).rpc("get_platform_secret", { p_name: name });
    if (error || typeof data !== "string" || !data.trim()) return null;
    return data.trim();
  } catch {
    return null;
  }
}

export async function getAsaasConfig(): Promise<AsaasConfig | null> {
  const apiKey = process.env["ASAAS_API_KEY"]?.trim() || (await readPlatformSecret(ASAAS_API_SECRET));
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
      const first = object(errors[0]);
      const description = String(first["description"] ?? "").trim();
      throw new Error(description || `ASAAS_HTTP_${response.status}`);
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

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function asaasFirstCycleValue(plan: AsaasPlanInput) {
  const monthly = Number(plan.price_monthly ?? 0);
  const onboarding = Number(plan.onboarding_fee ?? 0);
  return Math.round((monthly + Math.max(0, onboarding)) * 100) / 100;
}

async function ensurePaymentWebhook(config: AsaasConfig, origin: string, email?: string | null) {
  const webhookUrl = `${origin.replace(/\/$/, "")}/api/public/hooks/asaas`;
  const list = await asaasRequest(config, "/webhooks?offset=0&limit=100", { method: "GET" });
  const data = Array.isArray(list["data"]) ? (list["data"] as JsonObject[]) : [];
  if (data.some((item) => String(item["url"] ?? "") === webhookUrl)) return;

  const body: JsonObject = {
    name: "MercadoImobi - pagamentos",
    url: webhookUrl,
    enabled: true,
    interrupted: false,
    sendType: "SEQUENTIALLY",
    events: [...PAYMENT_EVENTS],
  };
  if (email?.includes("@")) body["email"] = email;

  // Desde 2026 o Asaas cria um authToken seguro quando ele não é enviado.
  // O endpoint também confirma o pagamento consultando a API do Asaas antes de liberar acesso.
  await asaasRequest(config, "/webhooks", { method: "POST", body: JSON.stringify(body) });
}

export async function createAsaasSubscriptionCheckout(input: {
  origin: string;
  userId: string;
  plan: AsaasPlanInput;
  customerEmail?: string | null;
}) {
  const config = await getAsaasConfig();
  if (!config) throw new Error("ASAAS_NOT_CONFIGURED");

  await ensurePaymentWebhook(config, input.origin, input.customerEmail);

  const monthly = Number(input.plan.price_monthly ?? 0);
  const onboarding = Math.max(0, Number(input.plan.onboarding_fee ?? 0));
  if (!Number.isFinite(monthly) || monthly <= 0) throw new Error("PLAN_PRICE_INVALID");

  const items: JsonObject[] = [
    {
      name: `MercadoImobi — ${input.plan.name}`.slice(0, 100),
      description: String(input.plan.description ?? "Assinatura mensal MercadoImobi").slice(0, 500),
      quantity: 1,
      value: monthly,
    },
  ];
  if (onboarding > 0) {
    items.push({
      name: `Implantação MercadoImobi — ${input.plan.name}`.slice(0, 100),
      description: "Implantação, ativação e onboarding inicial do plano contratado.",
      quantity: 1,
      value: onboarding,
    });
  }

  const externalReference = buildAsaasExternalReference(input.userId, String(input.plan.id));
  const payload = await asaasRequest(config, "/checkouts", {
    method: "POST",
    body: JSON.stringify({
      billingTypes: ["PIX", "CREDIT_CARD"],
      chargeTypes: ["RECURRENT"],
      minutesToExpire: 60,
      externalReference,
      callback: {
        successUrl: `${input.origin}/assinatura?checkout=success&gateway=asaas&plan=${encodeURIComponent(input.plan.slug)}`,
        cancelUrl: `${input.origin}/assinatura?checkout=cancel&gateway=asaas`,
        expiredUrl: `${input.origin}/assinatura?checkout=expired&gateway=asaas`,
      },
      items,
      subscription: { cycle: "MONTHLY", nextDueDate: todayIsoDate() },
    }),
  });

  const checkoutId = typeof payload["id"] === "string" ? payload["id"] : null;
  const directLink = typeof payload["link"] === "string" ? payload["link"] : null;
  const link =
    directLink || (checkoutId ? `https://asaas.com/checkoutSession/show?id=${checkoutId}` : null);
  if (!checkoutId || !link) throw new Error("ASAAS_CHECKOUT_INVALID_RESPONSE");
  return { url: link, checkoutId, provider: "asaas" as const };
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
      updatePendingPayments: false,
    }),
  });
}

export const __asaasBillingTestUtils = {
  buildAsaasExternalReference,
  parseAsaasExternalReference,
  asaasFirstCycleValue,
};
