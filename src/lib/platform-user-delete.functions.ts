import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const deleteUserSchema = z.object({
  userId: z.string().uuid(),
});

type AdminContext = {
  supabase: any;
  userId: string;
};

async function requirePlatformAdmin(context: AdminContext) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();

  if (error || !data) throw new Error("FORBIDDEN_ADMIN");
}

async function cancelStripeSubscription(stripeSubscriptionId: string | null) {
  if (!stripeSubscriptionId) return;

  const secret = process.env["STRIPE_SECRET_KEY"]?.trim();
  if (!secret) throw new Error("BILLING_CANCEL_REQUIRED");

  const response = await fetch(
    `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (response.ok) return;

  const payload = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  };
  if (payload.error?.code === "resource_missing") return;
  throw new Error(payload.error?.message || "STRIPE_CANCEL_FAILED");
}

export const deletePlatformUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => deleteUserSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context as AdminContext);

    if (data.userId === context.userId) throw new Error("CANNOT_DELETE_SELF");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const [authResult, roleResult, profileResult, membershipResult, subscriptionResult] =
      await Promise.all([
        supabaseAdmin.auth.admin.getUserById(data.userId),
        db
          .from("user_roles")
          .select("role")
          .eq("user_id", data.userId)
          .eq("role", "admin")
          .maybeSingle(),
        db.from("profiles").select("tenant_id").eq("id", data.userId).maybeSingle(),
        db
          .from("tenant_members")
          .select("tenant_id,member_role")
          .eq("user_id", data.userId)
          .limit(1)
          .maybeSingle(),
        db
          .from("subscriptions")
          .select("stripe_subscription_id,status")
          .eq("user_id", data.userId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    if (authResult.error || !authResult.data.user) throw new Error("USER_NOT_FOUND");
    if (roleResult.data?.role === "admin") throw new Error("CANNOT_DELETE_ADMIN");

    const tenantId = membershipResult.data?.tenant_id ?? profileResult.data?.tenant_id ?? null;
    let ownerUserId: string | null = null;
    let memberCount = 0;

    if (tenantId) {
      const [tenantResult, memberCountResult] = await Promise.all([
        db.from("tenants").select("owner_user_id").eq("id", tenantId).maybeSingle(),
        db
          .from("tenant_members")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId),
      ]);
      ownerUserId = tenantResult.data?.owner_user_id ?? null;
      memberCount = Number(memberCountResult.count ?? 0);
    }

    if (ownerUserId === data.userId && memberCount > 1) {
      throw new Error(`OWNER_HAS_MEMBERS|${memberCount}`);
    }

    if (
      subscriptionResult.data?.stripe_subscription_id &&
      ["active", "trialing", "past_due"].includes(String(subscriptionResult.data.status ?? ""))
    ) {
      await cancelStripeSubscription(String(subscriptionResult.data.stripe_subscription_id));
    }

    // Para membros de equipe, preserva os agendamentos e transfere a autoria ao proprietário.
    if (ownerUserId && ownerUserId !== data.userId) {
      const { error: appointmentError } = await db
        .from("crm_appointments")
        .update({ created_by: ownerUserId })
        .eq("created_by", data.userId);
      if (appointmentError) throw new Error(appointmentError.message);
    }

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (deleteError) throw new Error(deleteError.message);

    return {
      success: true,
      deletedUserId: data.userId,
      deletedTenant: Boolean(ownerUserId === data.userId && memberCount <= 1),
    };
  });
