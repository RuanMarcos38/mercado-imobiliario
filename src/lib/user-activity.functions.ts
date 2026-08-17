import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";

const activitySchema = z.object({
  sessionId: z.string().trim().min(8).max(160),
  eventType: z.enum(["session_start", "route_view", "sign_out", "search", "admin_action"]),
  path: z.string().trim().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const presenceSchema = z.object({
  sessionId: z.string().trim().min(8).max(160),
  path: z.string().trim().max(500).optional(),
  userAgent: z.string().trim().max(800).optional(),
});

async function requirePlatformAdmin(db: any, userId: string) {
  const { data, error } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("FORBIDDEN_ADMIN");
}

export const touchUserPresence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => presenceSchema.parse(data))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const tenantId = await requireTenantId(db, context.userId);
    const now = new Date().toISOString();
    const { error } = await db.from("user_presence").upsert(
      {
        user_id: context.userId,
        session_id: data.sessionId,
        tenant_id: tenantId,
        current_path: data.path ?? null,
        user_agent: data.userAgent ?? null,
        last_seen_at: now,
      },
      { onConflict: "user_id,session_id" },
    );
    if (error) throw new Error(error.message);
    return { success: true, lastSeenAt: now };
  });

export const recordUserActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => activitySchema.parse(data))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const tenantId = await requireTenantId(db, context.userId);
    const { error } = await db.from("user_activity_logs").insert({
      user_id: context.userId,
      tenant_id: tenantId,
      session_id: data.sessionId,
      event_type: data.eventType,
      path: data.path ?? null,
      metadata: data.metadata ?? {},
    });
    if (error) throw new Error(error.message);
    return { success: true };
  });

export type AdminPresenceRow = {
  userId: string;
  sessionId: string;
  tenantId: string | null;
  currentPath: string | null;
  userAgent: string | null;
  signedInAt: string;
  lastSeenAt: string;
};

export type AdminActivityRow = {
  id: string;
  userId: string;
  tenantId: string | null;
  sessionId: string | null;
  eventType: string;
  path: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export const getAdminRealtimeUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    await requirePlatformAdmin(db, context.userId);
    const cutoff = new Date(Date.now() - 90_000).toISOString();
    const { data, error } = await db
      .from("user_presence")
      .select("user_id,session_id,tenant_id,current_path,user_agent,signed_in_at,last_seen_at")
      .gte("last_seen_at", cutoff)
      .order("last_seen_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    const sessions: AdminPresenceRow[] = (data ?? []).map((row: any) => ({
      userId: String(row.user_id),
      sessionId: String(row.session_id),
      tenantId: row.tenant_id ? String(row.tenant_id) : null,
      currentPath: row.current_path ? String(row.current_path) : null,
      userAgent: row.user_agent ? String(row.user_agent) : null,
      signedInAt: String(row.signed_in_at),
      lastSeenAt: String(row.last_seen_at),
    }));
    return {
      onlineUsers: new Set(sessions.map((row) => row.userId)).size,
      onlineSessions: sessions.length,
      sessions,
      checkedAt: new Date().toISOString(),
    };
  });

export const listAdminActivityLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminActivityRow[]> => {
    const db = context.supabase as any;
    await requirePlatformAdmin(db, context.userId);
    const { data, error } = await db
      .from("user_activity_logs")
      .select("id,user_id,tenant_id,session_id,event_type,path,metadata,created_at")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: any) => ({
      id: String(row.id),
      userId: String(row.user_id),
      tenantId: row.tenant_id ? String(row.tenant_id) : null,
      sessionId: row.session_id ? String(row.session_id) : null,
      eventType: String(row.event_type),
      path: row.path ? String(row.path) : null,
      metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
      createdAt: String(row.created_at),
    }));
  });
