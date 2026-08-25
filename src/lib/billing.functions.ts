import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { asaasConfigured, createAsaasSubscriptionCheckout } from "@/lib/asaas-billing.server";
import { externalServiceParameters, platformBaseUrl } from "@/lib/platform-parameters.server";

export interface BillingPlan {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  priceMonthly: number;
  onboardingFee: number;
  userLimit: number;
  whatsappConnections: number;
  aiInteractionsMonthly: number;
  storageGb: number;
  featureKeys: string[];
  highlights: string[];
  badge: string | null;
  recommended: boolean;
  selfService: boolean;
}

export interface BillingOverview {
  configured: boolean;
  provider: "asaas" | "stripe" | null;
  subscription: {
    status: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    trialEnd: string | null;
    billingProvider: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    asaasCustomerId: string | null;
    asaasSubscriptionId: string | null;
    planId: string | null;
    planSlug: string | null;
    planName: string | null;
  } | null;
  plans: BillingPlan[];
}

const checkoutSchema = z.object({ planId: z.string().uuid() });

function requestOrigin() {
  const request = getRequest();
  if (!request?.url) return platformBaseUrl();
  return new URL(request.url).origin;
}

async function stripePost(path: string, body: URLSearchParams) {
  const secret = process.env["STRIPE_SECRET_KEY"]?.trim();
  if (!secret) throw new Error("STRIPE_NOT_CONFIGURED");
  const timeoutMs = externalServiceParameters().stripeTimeoutMs;

  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = payload["error"] as Record<string, unknown> | undefined;
    throw new Error(String(error?.["message"] ?? "Falha ao comunicar com o gateway de pagamento."));
  }
  return payload;
}

function mapPlan(plan: any): BillingPlan {
  return {
    id: String(plan.id),
    slug: String(plan.slug),
    name: String(plan.name),
    tagline: String(plan.tagline ?? ""),
    description: String(plan.description ?? ""),
    priceMonthly: Number(plan.price_monthly ?? 0),
    onboardingFee: Number(plan.onboarding_fee ?? 0),
    userLimit: Number(plan.user_limit ?? 1),
    whatsappConnections: Number(plan.whatsapp_connections ?? 0),
    aiInteractionsMonthly: Number(plan.ai_interactions_monthly ?? 0),
    storageGb: Number(plan.storage_gb ?? 0),
    featureKeys: Array.isArray(plan.feature_keys) ? plan.feature_keys.map(String) : [],
    highlights: Array.isArray(plan.highlights) ? plan.highlights.map(String) : [],
    badge: plan.badge ? String(plan.badge) : null,
    recommended: Boolean(plan.is_recommended),
    selfService: Boolean(plan.is_self_service),
  };
}

export const getMyBillingOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BillingOverview> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const asaasReady = await asaasConfigured();
    const stripeReady = Boolean(process.env["STRIPE_SECRET_KEY"]?.trim());

    const [{ data: subscription }, { data: plans }] = await Promise.all([
      db
        .from("subscriptions")
        .select(
          "status,current_period_start,current_period_end,trial_end,billing_provider,stripe_customer_id,stripe_subscription_id,asaas_customer_id,asaas_subscription_id,plan_id,created_at",
        )
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("subscription_plans")
        .select(
          "id,slug,name,tagline,description,price_monthly,onboarding_fee,user_limit,whatsapp_connections,ai_interactions_monthly,storage_gb,feature_keys,highlights,badge,is_recommended,is_self_service,sort_order",
        )
        .eq("is_active", true)
        .eq("is_public", true)
        .order("sort_order", { ascending: true }),
    ]);

    let selectedPlan: any = null;
    if (subscription?.plan_id) {
      const { data } = await db
        .from("subscription_plans")
        .select("id,slug,name")
        .eq("id", subscription.plan_id)
        .maybeSingle();
      selectedPlan = data ?? null;
    }

    return {
      configured: asaasReady || stripeReady,
      provider: asaasReady ? "asaas" : stripeReady ? "stripe" : null,
      subscription: subscription
        ? {
            status: String(subscription.status),
            currentPeriodStart: subscription.current_period_start ?? null,
            currentPeriodEnd: subscription.current_period_end ?? null,
            trialEnd: subscription.trial_end ?? null,
            billingProvider: subscription.billing_provider ?? null,
            stripeCustomerId: subscription.stripe_customer_id ?? null,
            stripeSubscriptionId: subscription.stripe_subscription_id ?? null,
            asaasCustomerId: subscription.asaas_customer_id ?? null,
            asaasSubscriptionId: subscription.asaas_subscription_id ?? null,
            planId: subscription.plan_id ?? null,
            planSlug: selectedPlan?.slug ? String(selectedPlan.slug) : null,
            planName: selectedPlan?.name ? String(selectedPlan.name) : null,
          }
        : null,
      plans: (plans ?? []).map(mapPlan),
    };
  });

export const createSubscriptionCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => checkoutSchema.parse(data))
  .handler(async ({ data, context }) => {
    const asaasReady = await asaasConfigured();
    const stripeReady = Boolean(process.env["STRIPE_SECRET_KEY"]?.trim());
    if (!asaasReady && !stripeReady) throw new Error("PAYMENT_GATEWAY_NOT_CONFIGURED");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const [{ data: subscription }, { data: plan }, userResult] = await Promise.all([
      db
        .from("subscriptions")
        .select(
          "stripe_customer_id,stripe_subscription_id,asaas_customer_id,asaas_subscription_id,status,plan_id,billing_provider",
        )
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("subscription_plans")
        .select(
          "id,slug,name,description,price_monthly,onboarding_fee,is_active,is_public,is_self_service,stripe_price_id",
        )
        .eq("id", data.planId)
        .maybeSingle(),
      supabaseAdmin.auth.admin.getUserById(context.userId),
    ]);

    if (!plan || !plan.is_active || !plan.is_public) throw new Error("PLAN_NOT_AVAILABLE");
    if (!plan.is_self_service) throw new Error("PLAN_REQUIRES_COMMERCIAL");
    if (Number(plan.price_monthly ?? 0) <= 0) throw new Error("PLAN_PRICE_INVALID");
    if (userResult.error || !userResult.data.user) throw new Error("Conta não encontrada.");

    if (
      (subscription?.stripe_subscription_id || subscription?.asaas_subscription_id) &&
      subscription?.status === "active" &&
      subscription?.plan_id !== data.planId
    ) {
      throw new Error("ACTIVE_SUBSCRIPTION_USE_PORTAL");
    }

    const origin = requestOrigin();
    if (!origin) throw new Error("PUBLIC_URL_NOT_CONFIGURED");

    if (asaasReady) {
      const checkout = await createAsaasSubscriptionCheckout({
        origin,
        userId: context.userId,
        plan: {
          id: String(plan.id),
          slug: String(plan.slug),
          name: String(plan.name),
          description: plan.description ? String(plan.description) : null,
          price_monthly: Number(plan.price_monthly),
          onboarding_fee: Number(plan.onboarding_fee ?? 0),
        },
        customerEmail: userResult.data.user.email ?? null,
      });
      return {
        url: checkout.url,
        planId: String(plan.id),
        planSlug: String(plan.slug),
        provider: checkout.provider,
      };
    }

    const body = new URLSearchParams();
    body.set("mode", "subscription");
    body.set(
      "success_url",
      `${origin}/assinatura?checkout=success&plan=${encodeURIComponent(String(plan.slug))}`,
    );
    body.set("cancel_url", `${origin}/assinatura?checkout=cancel`);
    body.set("line_items[0][quantity]", "1");

    if (plan.stripe_price_id) {
      body.set("line_items[0][price]", String(plan.stripe_price_id));
    } else {
      body.set("line_items[0][price_data][currency]", "brl");
      body.set(
        "line_items[0][price_data][unit_amount]",
        String(Math.round(Number(plan.price_monthly) * 100)),
      );
      body.set("line_items[0][price_data][recurring][interval]", "month");
      body.set(
        "line_items[0][price_data][product_data][name]",
        `MercadoImobi — ${String(plan.name)}`,
      );
      body.set(
        "line_items[0][price_data][product_data][description]",
        String(plan.description ?? "Assinatura mensal MercadoImobi").slice(0, 500),
      );
      body.set("line_items[0][price_data][product_data][metadata][plan_id]", String(plan.id));
      body.set("line_items[0][price_data][product_data][metadata][plan_slug]", String(plan.slug));
    }

    if (Number(plan.onboarding_fee ?? 0) > 0) {
      body.set("line_items[1][quantity]", "1");
      body.set("line_items[1][price_data][currency]", "brl");
      body.set(
        "line_items[1][price_data][unit_amount]",
        String(Math.round(Number(plan.onboarding_fee) * 100)),
      );
      body.set(
        "line_items[1][price_data][product_data][name]",
        `Implantação MercadoImobi — ${String(plan.name)}`,
      );
      body.set(
        "line_items[1][price_data][product_data][description]",
        "Implantação, ativação e onboarding inicial do plano contratado.",
      );
    }

    body.set("client_reference_id", context.userId);
    body.set("metadata[user_id]", context.userId);
    body.set("metadata[plan_id]", String(plan.id));
    body.set("metadata[plan_slug]", String(plan.slug));
    body.set("subscription_data[metadata][user_id]", context.userId);
    body.set("subscription_data[metadata][plan_id]", String(plan.id));
    body.set("subscription_data[metadata][plan_slug]", String(plan.slug));
    body.set("allow_promotion_codes", "true");

    if (subscription?.stripe_customer_id) {
      body.set("customer", String(subscription.stripe_customer_id));
    } else if (userResult.data.user.email) {
      body.set("customer_email", userResult.data.user.email);
    }

    const payload = await stripePost("/checkout/sessions", body);
    const url = typeof payload["url"] === "string" ? payload["url"] : null;
    if (!url) throw new Error("Checkout não retornou uma URL válida.");
    return { url, planId: String(plan.id), planSlug: String(plan.slug), provider: "stripe" as const };
  });

export const createSubscriberPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: subscription } = await db
      .from("subscriptions")
      .select("stripe_customer_id,billing_provider")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subscription?.billing_provider === "asaas") throw new Error("ASAAS_PORTAL_NOT_AVAILABLE");
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
