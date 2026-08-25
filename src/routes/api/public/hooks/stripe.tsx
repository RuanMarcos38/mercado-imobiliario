import { createHmac, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string) {
  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3))
    .filter(Boolean);
  if (!timestamp || !signatures.length) return false;

  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestampNumber) > 300) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return signatures.some((signature) => {
    try {
      const candidate = Buffer.from(signature, "hex");
      return (
        candidate.length === expectedBuffer.length && timingSafeEqual(candidate, expectedBuffer)
      );
    } catch {
      return false;
    }
  });
}

function mapSubscriptionStatus(value: unknown) {
  const status = String(value ?? "").toLowerCase();
  if (status === "trialing") return "trialing";
  if (status === "active") return "active";
  if (status === "past_due") return "past_due";
  if (status === "canceled") return "canceled";
  return "unpaid";
}

function unixDate(value: unknown): string | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return new Date(numeric * 1000).toISOString();
}

async function findUserId(db: any, objectData: JsonObject): Promise<string | null> {
  const metadata = object(objectData["metadata"]);
  const direct = metadata["user_id"] ?? objectData["client_reference_id"];
  if (typeof direct === "string" && direct) return direct;

  const subscriptionId = objectData["id"];
  if (typeof subscriptionId === "string") {
    const { data } = await db
      .from("subscriptions")
      .select("user_id")
      .eq("stripe_subscription_id", subscriptionId)
      .limit(1)
      .maybeSingle();
    if (data?.user_id) return String(data.user_id);
  }

  const customerId = objectData["customer"];
  if (typeof customerId === "string") {
    const { data } = await db
      .from("subscriptions")
      .select("user_id")
      .eq("stripe_customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.user_id) return String(data.user_id);
  }
  return null;
}

async function findPlanId(db: any, objectData: JsonObject): Promise<string | null> {
  const metadata = object(objectData["metadata"]);
  const directPlanId = metadata["plan_id"];
  if (typeof directPlanId === "string" && directPlanId) {
    const { data } = await db
      .from("subscription_plans")
      .select("id")
      .eq("id", directPlanId)
      .eq("is_active", true)
      .maybeSingle();
    if (data?.id) return String(data.id);
  }

  const planSlug = metadata["plan_slug"];
  if (typeof planSlug === "string" && planSlug) {
    const { data } = await db
      .from("subscription_plans")
      .select("id")
      .eq("slug", planSlug)
      .eq("is_active", true)
      .maybeSingle();
    if (data?.id) return String(data.id);
  }

  const customerId = objectData["customer"];
  if (typeof customerId === "string") {
    const { data } = await db
      .from("subscriptions")
      .select("plan_id")
      .eq("stripe_customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.plan_id) return String(data.plan_id);
  }
  return null;
}

async function persistSubscription(db: any, userId: string, patch: Record<string, unknown>) {
  const { data: existing } = await db
    .from("subscriptions")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const now = new Date();
  const fallbackTrialEnd = new Date(now.getTime() + 7 * 86_400_000);
  if (existing?.id) {
    const { error } = await db
      .from("subscriptions")
      .update({ ...patch, updated_at: now.toISOString() })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await db.from("subscriptions").insert({
    user_id: userId,
    status: "active",
    trial_start: now.toISOString(),
    trial_end: fallbackTrialEnd.toISOString(),
    ...patch,
  });
  if (error) throw new Error(error.message);
}

async function handleStripeWebhook(request: Request) {
  const secret = process.env["STRIPE_WEBHOOK_SECRET"]?.trim();
  if (!secret) {
    return Response.json({ ok: false, error: "stripe_webhook_not_configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  if (!verifyStripeSignature(rawBody, signature, secret)) {
    return Response.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  let event: JsonObject;
  try {
    event = object(JSON.parse(rawBody));
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const eventType = String(event["type"] ?? "");
  const data = object(event["data"]);
  const eventObject = object(data["object"]);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;

  if (eventType === "checkout.session.completed") {
    const userId = await findUserId(db, eventObject);
    if (!userId) return Response.json({ ok: true, ignored: true, reason: "user_not_found" });
    const planId = await findPlanId(db, eventObject);
    await persistSubscription(db, userId, {
      status: "active",
      ...(planId ? { plan_id: planId } : {}),
      stripe_customer_id:
        typeof eventObject["customer"] === "string" ? eventObject["customer"] : null,
      stripe_subscription_id:
        typeof eventObject["subscription"] === "string" ? eventObject["subscription"] : null,
      current_period_start: new Date().toISOString(),
    });
    await db
      .from("profiles")
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq("id", userId);
    return Response.json({ ok: true, planId });
  }

  if (
    eventType === "customer.subscription.created" ||
    eventType === "customer.subscription.updated" ||
    eventType === "customer.subscription.deleted"
  ) {
    const userId = await findUserId(db, eventObject);
    if (!userId) return Response.json({ ok: true, ignored: true, reason: "user_not_found" });
    const planId = await findPlanId(db, eventObject);
    const status =
      eventType === "customer.subscription.deleted"
        ? "canceled"
        : mapSubscriptionStatus(eventObject["status"]);
    await persistSubscription(db, userId, {
      status,
      ...(planId ? { plan_id: planId } : {}),
      stripe_customer_id:
        typeof eventObject["customer"] === "string" ? eventObject["customer"] : null,
      stripe_subscription_id: typeof eventObject["id"] === "string" ? eventObject["id"] : null,
      current_period_start: unixDate(eventObject["current_period_start"]),
      current_period_end: unixDate(eventObject["current_period_end"]),
      trial_end: unixDate(eventObject["trial_end"]),
    });
    return Response.json({ ok: true, planId });
  }

  if (eventType === "invoice.payment_failed" || eventType === "invoice.paid") {
    const customer = eventObject["customer"];
    if (typeof customer !== "string") return Response.json({ ok: true, ignored: true });
    const { data: subscription } = await db
      .from("subscriptions")
      .select("id,user_id,plan_id")
      .eq("stripe_customer_id", customer)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subscription?.id) {
      await db
        .from("subscriptions")
        .update({
          status: eventType === "invoice.paid" ? "active" : "past_due",
          updated_at: new Date().toISOString(),
        })
        .eq("id", subscription.id);

      if (eventType === "invoice.paid") {
        const paymentId = typeof eventObject["id"] === "string" ? eventObject["id"] : "";
        const amountPaidCents = Number(eventObject["amount_paid"] ?? 0);
        if (paymentId && Number.isFinite(amountPaidCents) && amountPaidCents > 0) {
          const statusTransitions = object(eventObject["status_transitions"]);
          const paidAt =
            unixDate(statusTransitions["paid_at"]) ??
            unixDate(eventObject["created"]) ??
            new Date().toISOString();
          const grossAmount = amountPaidCents / 100;
          const { error: paymentError } = await db.from("platform_payment_events").upsert(
            {
              user_id: subscription.user_id ? String(subscription.user_id) : null,
              provider: "stripe",
              payment_id: paymentId,
              gross_amount: grossAmount,
              paid_at: paidAt,
            },
            { onConflict: "provider,payment_id" },
          );
          if (paymentError) throw new Error(paymentError.message);

          if (subscription.user_id) {
            const { error: affiliateError } = await db.rpc("accrue_affiliate_commissions", {
              p_source_user_id: String(subscription.user_id),
              p_payment_id: paymentId,
              p_gross_amount: grossAmount,
            });
            if (affiliateError) throw new Error(affiliateError.message);
          }
        }
      }
    }
    return Response.json({ ok: true });
  }

  return Response.json({ ok: true, ignored: true, event: eventType });
}

export const Route = createFileRoute("/api/public/hooks/stripe")({
  server: {
    handlers: {
      POST: ({ request }) => handleStripeWebhook(request),
    },
  },
});
