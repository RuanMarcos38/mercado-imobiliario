from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}")
    p.write_text(text.replace(old, new, 1))


# 1) Preserve all Asaas API validation messages for safe diagnosis/fallback decisions.
replace_once(
    "src/lib/asaas-billing.server.ts",
    '''    if (!response.ok) {\n      const errors = Array.isArray(payload["errors"]) ? payload["errors"] : [];\n      const first = object(errors[0]);\n      const description = String(first["description"] ?? "").trim();\n      throw new Error(description || `ASAAS_HTTP_${response.status}`);\n    }''',
    '''    if (!response.ok) {\n      const errors = Array.isArray(payload["errors"]) ? payload["errors"] : [];\n      const descriptions = errors\n        .map((entry) => String(object(entry)["description"] ?? "").trim())\n        .filter(Boolean);\n      throw new Error(descriptions.join(" | ") || `ASAAS_HTTP_${response.status}`);\n    }''',
)

p = Path("src/lib/asaas-billing.server.ts")
text = p.read_text()
start = text.index("async function ensurePaymentWebhook")
end = text.index("export async function getAuthoritativeAsaasPayment")
new_block = r'''function asaasSafeName(prefix: string, planName: string) {
  return `${prefix} ${planName}`.replace(/\s+/g, " ").trim().slice(0, 30);
}

function checkoutCreationDisabled(error: unknown) {
  const message = String((error as Error)?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("criação do checkout está desabilitada") ||
    message.includes("criacao do checkout esta desabilitada")
  );
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
  const payload = await asaasRequest(config, "/paymentLinks", {
    method: "POST",
    body: JSON.stringify({
      name: asaasSafeName("Plano", input.plan.name),
      description: description.slice(0, 500),
      value: firstCycle,
      billingType: "CREDIT_CARD",
      chargeType: "RECURRENT",
      subscriptionCycle: "MONTHLY",
      externalReference,
      notificationEnabled: true,
      isAddressRequired: false,
      callback: {
        successUrl: `${input.origin}/assinatura?checkout=success&gateway=asaas&plan=${encodeURIComponent(input.plan.slug)}`,
        autoRedirect: true,
      },
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
      name: asaasSafeName("Plano", input.plan.name),
      description: String(input.plan.description ?? "Assinatura mensal MercadoImobi").slice(0, 500),
      quantity: 1,
      value: monthly,
    },
  ];
  if (onboarding > 0) {
    items.push({
      name: asaasSafeName("Implantação", input.plan.name),
      description: "Implantação, ativação e onboarding inicial do plano contratado.",
      quantity: 1,
      value: onboarding,
    });
  }

  const externalReference = buildAsaasExternalReference(input.userId, String(input.plan.id));
  let payload: JsonObject;
  try {
    payload = await asaasRequest(config, "/checkouts", {
      method: "POST",
      body: JSON.stringify({
        billingTypes: ["CREDIT_CARD"],
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
  } catch (error) {
    if (checkoutCreationDisabled(error)) {
      return createAsaasRecurringPaymentLink(
        config,
        input,
        externalReference,
        monthly,
        onboarding,
      );
    }
    throw error;
  }

  const checkoutId = resourceId(payload);
  const directLink = typeof payload["link"] === "string" ? payload["link"] : null;
  const link =
    directLink || (checkoutId ? `https://asaas.com/checkoutSession/show?id=${checkoutId}` : null);
  if (!checkoutId || !link) throw new Error("ASAAS_CHECKOUT_INVALID_RESPONSE");
  return { url: link, checkoutId, provider: "asaas" as const };
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

'''
p.write_text(text[:start] + new_block + text[end:])

# 2) Reverse-proxy HTTPS origin used by EasyPanel callbacks/webhooks.
replace_once(
    "src/lib/billing.functions.ts",
    '''function requestOrigin() {\n  const request = getRequest();\n  if (!request?.url) return platformBaseUrl();\n  return new URL(request.url).origin;\n}''',
    '''function requestOrigin() {\n  const request = getRequest();\n  if (!request?.url) return platformBaseUrl();\n\n  const url = new URL(request.url);\n  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();\n  const forwardedHost =\n    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||\n    request.headers.get("host")?.trim();\n\n  if (forwardedHost) {\n    const easypanelHost = forwardedHost.toLowerCase().endsWith(".easypanel.host");\n    const protocol =\n      forwardedProto === "https" || easypanelHost ? "https" : url.protocol.replace(":", "");\n    return `${protocol}://${forwardedHost}`;\n  }\n\n  return url.origin.replace(/^http:\/\/([^/]*\.easypanel\.host)/i, "https://$1");\n}''',
)

# 3) Payment-link fallback remains traceable to the selected user/plan.
replace_once(
    "src/routes/api/public/hooks/asaas.tsx",
    '''import {\n  getAuthoritativeAsaasPayment,\n  normalizeFutureAsaasSubscriptionValue,\n  parseAsaasExternalReference,\n} from "@/lib/asaas-billing.server";''',
    '''import {\n  getAuthoritativeAsaasPayment,\n  normalizeFutureAsaasSubscriptionValue,\n  resolveAsaasExternalReference,\n} from "@/lib/asaas-billing.server";''',
)
replace_once(
    "src/routes/api/public/hooks/asaas.tsx",
    '''  const reference = parseAsaasExternalReference(payment["externalReference"]);\n  if (!reference) return Response.json({ ok: true, ignored: true, reason: "foreign_payment" });''',
    '''  const reference = await resolveAsaasExternalReference(payment);\n  if (!reference) return Response.json({ ok: true, ignored: true, reason: "foreign_payment" });''',
)

# 4) Google Places key can be kept in Supabase Vault, not source code/EasyPanel UI.
replace_once(
    "src/lib/partner-search.functions.ts",
    '''function googlePlacesApiKey() {\n  return (\n    process.env["GOOGLE_PLACES_API_KEY"]?.trim() || process.env["GOOGLE_MAPS_API_KEY"]?.trim() || ""\n  );\n}''',
    '''const GOOGLE_PLACES_VAULT_SECRET = "mercadoimobi_google_places_api_key";\n\nasync function googlePlacesApiKey() {\n  const environmentKey =\n    process.env["GOOGLE_PLACES_API_KEY"]?.trim() ||\n    process.env["GOOGLE_MAPS_API_KEY"]?.trim() ||\n    "";\n  if (environmentKey) return environmentKey;\n\n  try {\n    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");\n    const { data, error } = await (supabaseAdmin as any).rpc("get_platform_secret", {\n      p_name: GOOGLE_PLACES_VAULT_SECRET,\n    });\n    if (!error && typeof data === "string" && data.trim()) return data.trim();\n  } catch {\n    // Optional provider: OpenAI web search remains available without this secret.\n  }\n  return "";\n}''',
)
replace_once(
    "src/lib/partner-search.functions.ts",
    "  const apiKey = googlePlacesApiKey();",
    "  const apiKey = await googlePlacesApiKey();",
)
replace_once(
    "src/lib/partner-search.functions.ts",
    "      googlePlaces: Boolean(googlePlacesApiKey()),",
    "      googlePlaces: Boolean(await googlePlacesApiKey()),",
)
replace_once(
    "src/lib/partner-search.functions.ts",
    "    const [google, openai] = await Promise.all([searchGooglePlaces(data), searchOpenAiWeb(data)]);",
    '''    const [google, openai, googleKey] = await Promise.all([\n      searchGooglePlaces(data),\n      searchOpenAiWeb(data),\n      googlePlacesApiKey(),\n    ]);''',
)
replace_once(
    "src/lib/partner-search.functions.ts",
    "    if (!partners.length && !googlePlacesApiKey() && !openAiConfig()) {",
    "    if (!partners.length && !googleKey && !openAiConfig()) {",
)
replace_once(
    "src/lib/partner-search.functions.ts",
    "        googlePlaces: Boolean(googlePlacesApiKey()),",
    "        googlePlaces: Boolean(googleKey),",
)

# Remove one-shot helper files before the validated commit.
for helper in [
    ".github/workflows/patch-asaas-google-safe.yml",
    ".github/workflows/patch-asaas-google-safe-v2.yml",
    "scripts/patch-asaas-google-safe.py",
]:
    Path(helper).unlink(missing_ok=True)
