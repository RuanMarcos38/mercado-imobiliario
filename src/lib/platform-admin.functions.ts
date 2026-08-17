import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
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

const subscriptionStatusSchema = z.enum([
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
]);

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

async function requirePlatformAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();

  if (error || !data) throw new Error("FORBIDDEN_ADMIN");
}

function hasServiceRoleConfig() {
  return Boolean(process.env["SUPABASE_SERVICE_ROLE_KEY"]);
}

function trialWindow(days: number) {
  const start = new Date();
  const end = new Date(start.getTime() + days * 86_400_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function upsertSubscription(
  db: any,
  userId: string,
  status: z.infer<typeof subscriptionStatusSchema>,
  trialDays = 7,
) {
  const { data: existing } = await db
    .from("subscriptions")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const window = trialWindow(trialDays);
  const payload = {
    status,
    updated_at: new Date().toISOString(),
    ...(status === "trialing"
      ? { trial_start: window.start, trial_end: window.end }
      : { current_period_start: window.start }),
  };

  if (existing?.id) {
    const { error } = await db.from("subscriptions").update(payload).eq("id", existing.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await db.from("subscriptions").insert({
    user_id: userId,
    status,
    trial_start: window.start,
    trial_end: window.end,
    current_period_start: status === "active" ? window.start : null,
    current_period_end: null,
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
      billingConfigured: Boolean(process.env["STRIPE_SECRET_KEY"] && process.env["STRIPE_PRICE_ID"]),
    };
  });

export const listPlatformUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformUser[]> => {
    await requirePlatformAdmin(context);

    if (!hasServiceRoleConfig()) {
      const db = context.supabase as any;
      const { data: profiles, error } = await db
        .from("profiles")
        .select("id,full_name,company_name,user_type,is_active,tenant_id,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      const ids = (profiles ?? []).map((row: any) => row.id);
      if (!ids.length) return [];

      const [membershipsResult, rolesResult, subscriptionsResult] = await Promise.all([
        db.from("tenant_members").select("user_id,tenant_id,member_role,tenants(name)").in("user_id", ids),
        db.from("user_roles").select("user_id,role").in("user_id", ids),
        db
          .from("subscriptions")
          .select("user_id,status,current_period_end,created_at")
          .in("user_id", ids)
          .order("created_at", { ascending: false }),
      ]);

      const memberships = new Map((membershipsResult.data ?? []).map((row: any) => [row.user_id, row]));
      const roles = new Map<string, string[]>();
      for (const row of rolesResult.data ?? []) {
        const current = roles.get(row.user_id) ?? [];
        current.push(String(row.role));
        roles.set(row.user_id, current);
      }
      const subscriptions = new Map<string, any>();
      for (const row of subscriptionsResult.data ?? []) {
        if (!subscriptions.has(row.user_id)) subscriptions.set(row.user_id, row);
      }

      return (profiles ?? []).map((profile: any) => {
        const membership: any = memberships.get(profile.id);
        const subscription: any = subscriptions.get(profile.id);
        return {
          id: profile.id,
          email: "",
          fullName: profile.full_name ?? null,
          companyName: profile.company_name ?? null,
          userType: profile.user_type ?? null,
          isActive: profile.is_active !== false,
          tenantId: membership?.tenant_id ?? profile.tenant_id ?? null,
          tenantName: membership?.tenants?.name ?? null,
          memberRole: membership?.member_role ?? null,
          roles: roles.get(profile.id) ?? [],
          subscriptionStatus: subscription?.status ?? null,
          currentPeriodEnd: subscription?.current_period_end ?? null,
          createdAt: profile.created_at ?? null,
          lastSignInAt: null,
        } satisfies PlatformUser;
      });
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const authResult = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (authResult.error) throw new Error(authResult.error.message);
    const users = authResult.data.users ?? [];
    const ids = users.map((user) => user.id);
    if (!ids.length) return [];

    const [profilesResult, membershipsResult, rolesResult, subscriptionsResult] = await Promise.all([
      db
        .from("profiles")
        .select("id,full_name,company_name,user_type,is_active,tenant_id")
        .in("id", ids),
      db.from("tenant_members").select("user_id,tenant_id,member_role,tenants(name)").in("user_id", ids),
      db.from("user_roles").select("user_id,role").in("user_id", ids),
      db
        .from("subscriptions")
        .select("user_id,status,current_period_end,created_at")
        .in("user_id", ids)
        .order("created_at", { ascending: false }),
    ]);

    const profiles = new Map((profilesResult.data ?? []).map((row: any) => [row.id, row]));
    const memberships = new Map((membershipsResult.data ?? []).map((row: any) => [row.user_id, row]));
    const roles = new Map<string, string[]>();
    for (const row of rolesResult.data ?? []) {
      const current = roles.get(row.user_id) ?? [];
      current.push(String(row.role));
      roles.set(row.user_id, current);
    }
    const subscriptions = new Map<string, any>();
    for (const row of subscriptionsResult.data ?? []) {
      if (!subscriptions.has(row.user_id)) subscriptions.set(row.user_id, row);
    }

    return users
      .map((user) => {
        const profile: any = profiles.get(user.id);
        const membership: any = memberships.get(user.id);
        const subscription: any = subscriptions.get(user.id);
        const tenant = membership?.tenants;
        return {
          id: user.id,
          email: user.email ?? "",
          fullName: profile?.full_name ?? null,
          companyName: profile?.company_name ?? null,
          userType: profile?.user_type ?? null,
          isActive: profile?.is_active !== false,
          tenantId: membership?.tenant_id ?? profile?.tenant_id ?? null,
          tenantName: tenant?.name ?? null,
          memberRole: membership?.member_role ?? null,
          roles: roles.get(user.id) ?? [],
          subscriptionStatus: subscription?.status ?? null,
          currentPeriodEnd: subscription?.current_period_end ?? null,
          createdAt: user.created_at ?? null,
          lastSignInAt: user.last_sign_in_at ?? null,
        } satisfies PlatformUser;
      })
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  });

export const createPlatformUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createUserSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context);

    if (!hasServiceRoleConfig()) {
      const signupClient = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const created = await signupClient.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            full_name: data.fullName,
            user_type: data.userType,
            company_name: data.companyName || null,
          },
        },
      });
      if (created.error || !created.data.user) {
        throw new Error(created.error?.message ?? "Não foi possível criar o usuário.");
      }

      const userId = created.data.user.id;
      const db = context.supabase as any;
      await db
        .from("profiles")
        .update({
          full_name: data.fullName,
          company_name: data.companyName || null,
          user_type: data.userType,
          is_active: data.isActive,
          trial_ends_at: trialWindow(data.trialDays).end,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      try {
        await upsertSubscription(db, userId, data.subscriptionStatus, data.trialDays);
      } catch {
        // The signup trigger may already own subscription initialization; user creation remains valid.
      }

      return { success: true, userId, fallback: true };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName, user_type: data.userType },
    });
    if (created.error || !created.data.user) {
      throw new Error(created.error?.message ?? "Não foi possível criar o usuário.");
    }

    const userId = created.data.user.id;
    const { error: profileError } = await db
      .from("profiles")
      .update({
        full_name: data.fullName,
        company_name: data.companyName || null,
        user_type: data.userType,
        is_active: data.isActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
    if (profileError) throw new Error(profileError.message);

    const { data: existingRole } = await db
      .from("user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", data.userType === "admin" ? "admin" : "user")
      .maybeSingle();
    if (!existingRole) {
      const { error: roleError } = await db.from("user_roles").insert({
        user_id: userId,
        role: data.userType === "admin" ? "admin" : "user",
      });
      if (roleError) throw new Error(roleError.message);
    }

    await upsertSubscription(db, userId, data.subscriptionStatus, data.trialDays);
    return { success: true, userId };
  });

export const updatePlatformUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateUserSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context);
    const db = hasServiceRoleConfig()
      ? ((await import("@/integrations/supabase/client.server")).supabaseAdmin as any)
      : (context.supabase as any);

    const profilePatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof data.isActive === "boolean") profilePatch.is_active = data.isActive;
    if (data.userType) profilePatch.user_type = data.userType;
    if (Object.keys(profilePatch).length > 1) {
      const { error } = await db.from("profiles").update(profilePatch).eq("id", data.userId);
      if (error) throw new Error(error.message);
    }

    if (data.subscriptionStatus) {
      await upsertSubscription(db, data.userId, data.subscriptionStatus, 7);
    }

    return { success: true };
  });
