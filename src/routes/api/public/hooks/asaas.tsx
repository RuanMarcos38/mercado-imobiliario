import { createFileRoute } from "@tanstack/react-router";
import {
  getAuthoritativeAsaasPayment,
  normalizeFutureAsaasSubscriptionValue,
  resolveAsaasExternalReference,
} from "@/lib/asaas-billing.server";

type JsonObject = Record<string, unknown>;

const HANDLED_EVENTS = new Set([
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "PAYMENT_REFUNDED",
  "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_DELETED",
  "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
  "PAYMENT_CHARGEBACK_REQUESTED",
]);

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function mapPaymentStatus(value: unknown) {
  const status = String(value ?? "").toUpperCase();
  if (["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"].includes(status)) return "active";
  if (status === "OVERDUE") return "past_due";
  if (
    [
      "REFUNDED",
      "PARTIALLY_REFUNDED",
      "CHARGEBACK_REQUESTED",
      "CHARGEBACK_DISPUTE",
      "AWAITING_RISK_ANALYSIS",
    ].includes(status)
  ) {
    return "unpaid";
  }
  return null;
}

function addOneMonth(value = new Date()) {
  const next = new Date(value);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next.toISOString();
}

function authoritativePaidAt(payment: JsonObject) {
  for (const key of ["confirmedDate", "paymentDate", "clientPaymentDate", "dateCreated"] as const) {
    const value = payment[key];
    if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

async function persistSubscription(
  db: any,
  input: {
    userId: string;
    planId: string;
    status: string;
    customerId: string | null;
    subscriptionId: string | null;
    paidAt: string;
  },
) {
  const { data: existing } = await db
    .from("subscriptions")
    .select("id,asaas_subscription_id,billing_provider")
    .eq("user_id", input.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (
    input.status !== "active" &&
    existing?.asaas_subscription_id &&
    input.subscriptionId &&
    String(existing.asaas_subscription_id) !== input.subscriptionId
  ) {
    return false;
  }

  const patch = {
    status: input.status,
    plan_id: input.planId,
    billing_provider: "asaas",
    asaas_customer_id: input.customerId,
    asaas_subscription_id: input.subscriptionId,
    current_period_start: input.status === "active" ? input.paidAt : undefined,
    current_period_end: input.status === "active" ? addOneMonth(new Date(input.paidAt)) : undefined,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const cleanPatch = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    const { error } = await db.from("subscriptions").update(cleanPatch).eq("id", existing.id);
    if (error) throw new Error(error.message);
    return true;
  }

  const now = new Date().toISOString();
  const { error } = await db.from("subscriptions").insert({
    user_id: input.userId,
    trial_start: now,
    trial_end: now,
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
  });
  if (error) throw new Error(error.message);
  return true;
}

async function recordPaidEvent(
  db: any,
  input: { userId: string; paymentId: string; grossAmount: number; paidAt: string },
) {
  const { error } = await db.from("platform_payment_events").insert({
    user_id: input.userId,
    provider: "asaas",
    payment_id: input.paymentId,
    gross_amount: input.grossAmount,
    paid_at: input.paidAt,
  });

  if (error) {
    if (String(error.code ?? "") === "23505") return;
    throw new Error(error.message);
  }

  const { error: affiliateError } = await db.rpc("accrue_affiliate_commissions", {
    p_source_user_id: input.userId,
    p_payment_id: input.paymentId,
    p_gross_amount: input.grossAmount,
  });
  if (affiliateError) throw new Error(affiliateError.message);
}

async function handleAsaasWebhook(request: Request) {
  let event: JsonObject;
  try {
    event = object(await request.json());
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const eventType = String(event["event"] ?? "");
  if (!HANDLED_EVENTS.has(eventType)) {
    return Response.json({ ok: true, ignored: true, event: eventType });
  }

  const receivedPayment = object(event["payment"]);
  const paymentId = typeof receivedPayment["id"] === "string" ? receivedPayment["id"] : "";
  if (!paymentId) return Response.json({ ok: true, ignored: true, reason: "payment_id_missing" });

  let payment: JsonObject;
  try {
    // Não confia apenas no payload recebido: confirma a cobrança diretamente na API autenticada do Asaas.
    payment = await getAuthoritativeAsaasPayment(paymentId);
  } catch {
    return Response.json(
      { ok: false, error: "asaas_payment_verification_failed" },
      { status: 503 },
    );
  }

  if (String(payment["id"] ?? "") !== paymentId) {
    return Response.json({ ok: false, error: "payment_verification_mismatch" }, { status: 401 });
  }

  const reference = await resolveAsaasExternalReference(payment);
  if (!reference) return Response.json({ ok: true, ignored: true, reason: "foreign_payment" });

  const status = mapPaymentStatus(payment["status"]);
  if (!status) return Response.json({ ok: true, ignored: true, reason: "status_not_actionable" });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: plan } = await db
    .from("subscription_plans")
    .select("id,name,price_monthly,onboarding_fee,is_active")
    .eq("id", reference.planId)
    .maybeSingle();
  if (!plan?.id || !plan.is_active) {
    return Response.json({ ok: true, ignored: true, reason: "plan_not_found" });
  }

  const customerId = typeof payment["customer"] === "string" ? payment["customer"] : null;
  const subscriptionId =
    typeof payment["subscription"] === "string" ? payment["subscription"] : null;
  const paidAt = authoritativePaidAt(payment);
  const value = Number(payment["value"] ?? 0);
  const monthlyValue = Number(plan.price_monthly ?? 0);
  const onboardingValue = Math.max(0, Number(plan.onboarding_fee ?? 0));

  if (
    status === "active" &&
    subscriptionId &&
    onboardingValue > 0 &&
    Number.isFinite(value) &&
    value > monthlyValue + 0.009
  ) {
    // O primeiro ciclo inclui implantação. Depois da confirmação, somente as próximas cobranças
    // passam a usar a mensalidade do plano, sem alterar a cobrança já paga.
    await normalizeFutureAsaasSubscriptionValue(
      subscriptionId,
      monthlyValue,
      `MercadoImobi — ${String(plan.name)}`,
    );
  }

  const updated = await persistSubscription(db, {
    userId: reference.userId,
    planId: reference.planId,
    status,
    customerId,
    subscriptionId,
    paidAt,
  });
  if (!updated) return Response.json({ ok: true, ignored: true, reason: "older_subscription" });

  if (status === "active") {
    await db
      .from("profiles")
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq("id", reference.userId);

    if (Number.isFinite(value) && value > 0) {
      await recordPaidEvent(db, {
        userId: reference.userId,
        paymentId,
        grossAmount: value,
        paidAt,
      });
    }
  }

  return Response.json({ ok: true, provider: "asaas", status });
}

export const Route = createFileRoute("/api/public/hooks/asaas")({
  server: {
    handlers: {
      POST: ({ request }) => handleAsaasWebhook(request),
    },
  },
});
