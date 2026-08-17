import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface BillingOverview {
  configured: boolean;
  subscription: {
    status: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    trialEnd: string | null;
    stripeCustomerId: string | null;
  } | null;
  plans: Array<{
    id: string;
    name: string;
    priceMonthly: number;
    features: string[];
  }>;
}

function requestOrigin() {
  const request = getRequest();
  if (!request?.url) return process.env["MERCADOIMOBI_BASE_URL"]?.replace(/\/$/, "") ?? "";
  return new URL(request.url).origin;
}

async function stripePost(path: string, body: URLSearchParams) {
  const secret = process.env["STRIPE_SECRET_KEY"]?.trim();
  if (!secret) throw new Error("STRIPE_NOT_CONFIGURED");

  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = payload["error"] as Record<string, unknown> | undefined;
    throw new Error(String(error?.["message"] ?? "Falha ao comunicar com o gateway de pagamento."));
  }
  return payload;
}

export const getMyBillingOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BillingOverview> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const [{ data: subscription }, { data: plans }] = await Promise.all([
      db
        .from("subscriptions")
        .select(
          "status,current_period_start,current_period_end,trial_end,stripe_customer_id,created_at",
        )
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("subscription_plans")
        .select("id,name,price_monthly,features")
        .eq("is_active", true)
        .order("price_monthly", { ascending: true }),
    ]);

    return {
      configured: Boolean(process.env["STRIPE_SECRET_KEY"] && process.env["STRIPE_PRICE_ID"]),
      subscription: subscription
        ? {
            status: String(subscription.status),
            currentPeriodStart: subscription.current_period_start ?? null,
            currentPeriodEnd: subscription.current_period_end ?? null,
            trialEnd: subscription.trial_end ?? null,
            stripeCustomerId: subscription.stripe_customer_id ?? null,
          }
        : null,
      plans: (plans ?? []).map((plan: any) => ({
        id: String(plan.id),
        name: String(plan.name),
        priceMonthly: Number(plan.price_monthly ?? 0),
        features: Array.isArray(plan.features) ? plan.features.map(String) : [],
      })),
    };
  });

export const createSubscriptionCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const priceId = process.env["STRIPE_PRICE_ID"]?.trim();
    if (!priceId || !process.env["STRIPE_SECRET_KEY"]) throw new Error("STRIPE_NOT_CONFIGURED");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const [{ data: subscription }, userResult] = await Promise.all([
      db
        .from("subscriptions")
        .select("stripe_customer_id")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin.auth.admin.getUserById(context.userId),
    ]);

    if (userResult.error || !userResult.data.user) throw new Error("Conta não encontrada.");
    const origin = requestOrigin();
    if (!origin) throw new Error("PUBLIC_URL_NOT_CONFIGURED");

    const body = new URLSearchParams();
    body.set("mode", "subscription");
    body.set("success_url", `${origin}/assinatura?checkout=success`);
    body.set("cancel_url", `${origin}/assinatura?checkout=cancel`);
    body.set("line_items[0][price]", priceId);
    body.set("line_items[0][quantity]", "1");
    body.set("client_reference_id", context.userId);
    body.set("metadata[user_id]", context.userId);
    body.set("subscription_data[metadata][user_id]", context.userId);
    body.set("allow_promotion_codes", "true");

    if (subscription?.stripe_customer_id) {
      body.set("customer", String(subscription.stripe_customer_id));
    } else if (userResult.data.user.email) {
      body.set("customer_email", userResult.data.user.email);
    }

    const payload = await stripePost("/checkout/sessions", body);
    const url = typeof payload["url"] === "string" ? payload["url"] : null;
    if (!url) throw new Error("Checkout não retornou uma URL válida.");
    return { url };
  });

export const createSubscriberPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: subscription } = await db
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!subscription?.stripe_customer_id) throw new Error("STRIPE_CUSTOMER_NOT_FOUND");
    const origin = requestOrigin();
    if (!origin) throw new Error("PUBLIC_URL_NOT_CONFIGURED");

    const body = new URLSearchParams();
    body.set("customer", String(subscription.stripe_customer_id));
    body.set("return_url", `${origin}/assinatura`);
    const payload = await stripePost("/billing_portal/sessions", body);
    const url = typeof payload["url"] === "string" ? payload["url"] : null;
    if (!url) throw new Error("Portal de cobrança não retornou uma URL válida.");
    return { url };
  });
