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
});

const updateUserSchema = z.object({
  userId: z.string().uuid(),
  isActive: z.boolean().optional(),
  userType: userTypeSchema.optional(),
  subscriptionStatus: subscriptionStatusSchema.optional(),
});

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

export const listPlatformUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformUser[]> => {
    await requirePlatformAdmin(context as AdminContext);
    const result = await invokePlatformAdmin<{ users: PlatformUser[] }>(
      context as AdminContext,
      "list",
    );
    return result.users ?? [];
  });

export const createPlatformUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createUserSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context as AdminContext);
    return invokePlatformAdmin<{ success: boolean; userId: string }>(
      context as AdminContext,
      "create",
      data,
    );
  });

export const updatePlatformUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateUserSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context as AdminContext);
    return invokePlatformAdmin<{ success: boolean }>(context as AdminContext, "update", data);
  });
