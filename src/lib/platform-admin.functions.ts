import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  PUBLIC_SUPABASE_URL,
} from "@/integrations/supabase/public-config";

const userTypeSchema = z.enum([
  "cliente",
  "corretor",
  "imobiliaria",
  "proprietario",
  "construtora",
  "admin",
]);

const subscriptionStatusSchema = z.enum(["trialing", "active", "past_due", "canceled", "unpaid"]);

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  fullName: z.string().trim().min(3).max(120),
  userType: userTypeSchema.default("corretor"),
  companyName: z.string().trim().max(160).optional(),
  isActive: z.boolean().default(true),
  subscriptionStatus: subscriptionStatusSchema.default("trialing"),
  trialDays: z.number().int().min(0).max(90).default(7),
  planId: z.string().uuid().optional(),
});

const updateUserSchema = z.object({
  userId: z.string().uuid(),
  isActive: z.boolean().optional(),
  userType: userTypeSchema.optional(),
  subscriptionStatus: subscriptionStatusSchema.optional(),
  planId: z.string().uuid().optional(),
});

export interface PlatformPlanOption {
  id: string;
  slug: string;
  name: string;
  priceMonthly: number;
  userLimit: number;
  isSelfService: boolean;
}

export interface PlatformUser {
  id: string;
  email: string;
  fullName: string | null;
  companyName: string | null;
  userType: string | null;
  isActive: boolean;
  tenantId: string | null;
  tenantName: string | null;
  memberRole: string | null;
  roles: string[];
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  planId: string | null;
  planSlug: string | null;
  planName: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
}

export interface AccountAccessState {
  allowed: boolean;
  isPlatformAdmin: boolean;
  profileActive: boolean;
  subscriptionStatus: string | null;
  blockedReason: "inactive" | "billing" | null;
  billingConfigured: boolean;
}

type AdminContext = {
  supabase: any;
  userId: string;
  accessToken: string;
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

async function invokePlatformAdmin<T>(
  context: AdminContext,
  action: "list" | "create" | "update",
  data?: unknown,
): Promise<T> {
  const url = `${PUBLIC_SUPABASE_URL}/functions/v1/platform-admin`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${context.accessToken}`,
    },
    body: JSON.stringify({ action, data }),
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      String(payload?.error || `Falha na administração de usuários (${response.status}).`),
    );
  }

  if (payload?.error) throw new Error(String(payload.error));
  return payload as T;
}

async function assertPlan(db: any, planId: string) {
  const { data, error } = await db
    .from("subscription_plans")
    .select("id,slug,name")
    .eq("id", planId)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) throw new Error("PLAN_NOT_FOUND");
  return data;
}

async function assignPlan(db: any, userId: string, planId: string) {
  await assertPlan(db, planId);
  const { data: subscription, error: subscriptionError } = await db
    .from("subscriptions")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subscriptionError) throw new Error(subscriptionError.message);

  if (subscription?.id) {
    const { error } = await db
      .from("subscriptions")
      .update({ plan_id: planId, updated_at: new Date().toISOString() })
      .eq("id", subscription.id);
    if (error) throw new Error(error.message);
    return;
  }

  const now = new Date();
  const { error } = await db.from("subscriptions").insert({
    user_id: userId,
    plan_id: planId,
    status: "trialing",
    trial_start: now.toISOString(),
    trial_end: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
  });
  if (error) throw new Error(error.message);
}

export const getAccountAccessState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccountAccessState> => {
    const db = context.supabase as any;
    const [{ data: profile }, { data: role }, { data: subscription }] = await Promise.all([
      db.from("profiles").select("is_active").eq("id", context.userId).maybeSingle(),
      db
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .eq("role", "admin")
        .maybeSingle(),
      db
        .from("subscriptions")
        .select("status")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const isPlatformAdmin = Boolean(role);
    const profileActive = profile?.is_active !== false;
    const subscriptionStatus = subscription?.status ? String(subscription.status) : null;
    const billingBlocked = ["past_due", "canceled", "unpaid"].includes(subscriptionStatus ?? "");
    const blockedReason: AccountAccessState["blockedReason"] = !profileActive
      ? "inactive"
      : billingBlocked
        ? "billing"
        : null;

    return {
      allowed: isPlatformAdmin || blockedReason === null,
      isPlatformAdmin,
      profileActive,
      subscriptionStatus,
      blockedReason,
      billingConfigured: Boolean(process.env["STRIPE_SECRET_KEY"]),
    };
  });

export const listSubscriptionPlansAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformPlanOption[]> => {
    await requirePlatformAdmin(context as AdminContext);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
      .from("subscription_plans")
      .select("id,slug,name,price_monthly,user_limit,is_self_service,sort_order")
      .eq("is_active", true)
      .eq("is_public", true)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((plan: any) => ({
      id: String(plan.id),
      slug: String(plan.slug),
      name: String(plan.name),
      priceMonthly: Number(plan.price_monthly ?? 0),
      userLimit: Number(plan.user_limit ?? 1),
      isSelfService: Boolean(plan.is_self_service),
    }));
  });

export const listPlatformUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformUser[]> => {
    await requirePlatformAdmin(context as AdminContext);
    const result = await invokePlatformAdmin<{ users: PlatformUser[] }>(
      context as AdminContext,
      "list",
    );
    const users = result.users ?? [];
    if (!users.length) return [];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const userIds = users.map((user) => user.id);
    const { data: subscriptions } = await db
      .from("subscriptions")
      .select("user_id,plan_id,created_at")
      .in("user_id", userIds)
      .order("created_at", { ascending: false });

    const latestByUser = new Map<string, any>();
    for (const subscription of subscriptions ?? []) {
      if (!latestByUser.has(String(subscription.user_id))) {
        latestByUser.set(String(subscription.user_id), subscription);
      }
    }

    const planIds = Array.from(
      new Set(
        Array.from(latestByUser.values())
          .map((row) => row.plan_id)
          .filter(Boolean)
          .map(String),
      ),
    );
    const planMap = new Map<string, any>();
    if (planIds.length) {
      const { data: plans } = await db
        .from("subscription_plans")
        .select("id,slug,name")
        .in("id", planIds);
      for (const plan of plans ?? []) planMap.set(String(plan.id), plan);
    }

    return users.map((user) => {
      const subscription = latestByUser.get(user.id);
      const plan = subscription?.plan_id ? planMap.get(String(subscription.plan_id)) : null;
      return {
        ...user,
        planId: subscription?.plan_id ? String(subscription.plan_id) : null,
        planSlug: plan?.slug ? String(plan.slug) : null,
        planName: plan?.name ? String(plan.name) : null,
      };
    });
  });

export const createPlatformUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createUserSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context as AdminContext);
    const { planId, ...platformData } = data;
    const result = await invokePlatformAdmin<{ success: boolean; userId: string }>(
      context as AdminContext,
      "create",
      platformData,
    );
    if (planId && result.userId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await assignPlan(supabaseAdmin as any, result.userId, planId);
    }
    return result;
  });

export const updatePlatformUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateUserSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context as AdminContext);
    const { planId, ...platformData } = data;
    const hasPlatformUpdate =
      platformData.isActive !== undefined ||
      platformData.userType !== undefined ||
      platformData.subscriptionStatus !== undefined;

    let result: { success: boolean } = { success: true };
    if (hasPlatformUpdate) {
      result = await invokePlatformAdmin<{ success: boolean }>(
        context as AdminContext,
        "update",
        platformData,
      );
    }
    if (planId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await assignPlan(supabaseAdmin as any, data.userId, planId);
    }
    return result;
  });
