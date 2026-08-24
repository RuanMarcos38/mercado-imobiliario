import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTenantId } from "@/lib/tenant.server";

export type AttendanceState = "waiting" | "in_service" | "automatic";
export type AttendantPresenceStatus = "alert" | "in_service" | "free" | "paused" | "away";

export interface AttendanceConversation {
  id: string;
  phone_e164: string;
  phone_masked: boolean;
  contact_name: string | null;
  avatar_url: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  attendance_state: AttendanceState;
  assigned_user_id: string | null;
  waiting_since: string | null;
  accepted_at: string | null;
  first_response_at: string | null;
  closed_at: string | null;
  department_name: string | null;
  tags: string[];
}

export interface AttendanceAgent {
  userId: string;
  name: string;
  status: AttendantPresenceStatus;
  statusSince: string;
  activeConversations: number;
  canViewSensitiveData: boolean;
}

export interface AttendanceDashboard {
  waiting: number;
  attended: number;
  avgWaitSeconds: number;
  avgResponseSeconds: number;
  avgAttendanceSeconds: number;
  statuses: Record<AttendantPresenceStatus, number>;
  agents: AttendanceAgent[];
  canManageSensitiveVisibility: boolean;
}

const conversationSchema = z.object({ conversationId: z.string().uuid() });
const dashboardSchema = z.object({ startIso: z.string().datetime() });
const presenceSchema = z.object({
  status: z.enum(["alert", "in_service", "free", "paused", "away"]),
});
const tagsSchema = z.object({
  conversationId: z.string().uuid(),
  tags: z.array(z.string().trim().min(1).max(30)).max(8),
});
const permissionSchema = z.object({
  userId: z.string().uuid(),
  allowed: z.boolean(),
});

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 6) return "••••••";
  return `${digits.slice(0, 4)}•••••${digits.slice(-4)}`;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function secondsBetween(later?: string | null, earlier?: string | null) {
  if (!later || !earlier) return null;
  const diff = new Date(later).getTime() - new Date(earlier).getTime();
  if (!Number.isFinite(diff) || diff < 0) return null;
  return Math.round(diff / 1000);
}

async function membership(db: any, tenantId: string, userId: string) {
  const { data, error } = await db
    .from("tenant_members")
    .select("member_role,can_view_sensitive_data")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("TENANT_MEMBERSHIP_REQUIRED");
  const role = String(data.member_role ?? "").toLowerCase();
  return {
    role,
    canViewSensitiveData:
      Boolean(data.can_view_sensitive_data) || ["owner", "admin", "administrator"].includes(role),
    canManageSensitiveVisibility: ["owner", "admin", "administrator"].includes(role),
  };
}

async function ensureConversation(db: any, tenantId: string, conversationId: string) {
  const { data, error } = await db
    .from("whatsapp_conversations")
    .select(
      "id,assigned_user_id,attendance_state,waiting_since,accepted_at,first_response_at,closed_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Conversa não encontrada.");
  return data;
}

async function setOwnPresence(db: any, tenantId: string, userId: string, status: AttendantPresenceStatus) {
  const now = new Date().toISOString();
  const { error } = await db.from("whatsapp_attendant_presence").upsert(
    {
      tenant_id: tenantId,
      user_id: userId,
      status,
      status_since: now,
      updated_at: now,
    },
    { onConflict: "tenant_id,user_id" },
  );
  if (error) throw new Error(error.message);
  return now;
}

export const listAttendanceConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AttendanceConversation[]> => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const member = await membership(db, tenantId, context.userId);
    const { data, error } = await db
      .from("whatsapp_conversations")
      .select(
        "id,phone_e164,contact_name,avatar_url,last_message,last_message_at,unread_count,attendance_state,assigned_user_id,waiting_since,accepted_at,first_response_at,closed_at,department_name,tags",
      )
      .eq("tenant_id", tenantId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(300);
    if (error) throw new Error(error.message);

    return (data ?? []).map((row: any) => ({
      ...row,
      phone_e164: member.canViewSensitiveData
        ? String(row.phone_e164 ?? "")
        : maskPhone(String(row.phone_e164 ?? "")),
      phone_masked: !member.canViewSensitiveData,
      attendance_state: (row.attendance_state || "automatic") as AttendanceState,
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    })) as AttendanceConversation[];
  });

export const getAttendanceViewer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const member = await membership(db, tenantId, context.userId);
    const { data: presence } = await db
      .from("whatsapp_attendant_presence")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("user_id", context.userId)
      .maybeSingle();
    return {
      canViewSensitiveData: member.canViewSensitiveData,
      canManageSensitiveVisibility: member.canManageSensitiveVisibility,
      presence: (presence?.status || "free") as AttendantPresenceStatus,
    };
  });

export const queueAttendanceConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => conversationSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    await ensureConversation(db, tenantId, data.conversationId);
    const now = new Date().toISOString();
    const { error } = await db
      .from("whatsapp_conversations")
      .update({
        attendance_state: "waiting",
        assigned_user_id: null,
        waiting_since: now,
        accepted_at: null,
        first_response_at: null,
        closed_at: null,
        updated_at: now,
      })
      .eq("tenant_id", tenantId)
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    return { success: true, waitingSince: now };
  });

export const claimAttendanceConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => conversationSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const conversation = await ensureConversation(db, tenantId, data.conversationId);
    if (
      conversation.attendance_state === "in_service" &&
      conversation.assigned_user_id &&
      conversation.assigned_user_id !== context.userId
    ) {
      throw new Error("Esta conversa já está em atendimento por outro usuário.");
    }

    const now = new Date().toISOString();
    const queuedAt = conversation.waiting_since || now;
    const { error } = await db
      .from("whatsapp_conversations")
      .update({
        attendance_state: "in_service",
        assigned_user_id: context.userId,
        accepted_at: conversation.accepted_at || now,
        first_response_at: conversation.first_response_at || null,
        closed_at: null,
        updated_at: now,
      })
      .eq("tenant_id", tenantId)
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);

    const { data: openSession } = await db
      .from("whatsapp_attendance_sessions")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("conversation_id", data.conversationId)
      .is("closed_at", null)
      .limit(1)
      .maybeSingle();
    if (!openSession) {
      const { error: sessionError } = await db.from("whatsapp_attendance_sessions").insert({
        tenant_id: tenantId,
        conversation_id: data.conversationId,
        user_id: context.userId,
        queued_at: queuedAt,
        accepted_at: now,
      });
      if (sessionError) throw new Error(sessionError.message);
    }
    await setOwnPresence(db, tenantId, context.userId, "in_service");
    return { success: true, acceptedAt: now };
  });

export const endAttendanceConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => conversationSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const conversation = await ensureConversation(db, tenantId, data.conversationId);
    if (
      conversation.assigned_user_id &&
      conversation.assigned_user_id !== context.userId
    ) {
      throw new Error("Somente o atendente responsável pode encerrar este atendimento.");
    }
    const now = new Date().toISOString();
    const { error } = await db
      .from("whatsapp_conversations")
      .update({
        attendance_state: "automatic",
        assigned_user_id: null,
        closed_at: now,
        updated_at: now,
      })
      .eq("tenant_id", tenantId)
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);

    const { error: sessionError } = await db
      .from("whatsapp_attendance_sessions")
      .update({ closed_at: now })
      .eq("tenant_id", tenantId)
      .eq("conversation_id", data.conversationId)
      .is("closed_at", null);
    if (sessionError) throw new Error(sessionError.message);

    const { count } = await db
      .from("whatsapp_conversations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("attendance_state", "in_service")
      .eq("assigned_user_id", context.userId);
    if ((count ?? 0) === 0) await setOwnPresence(db, tenantId, context.userId, "free");
    return { success: true, closedAt: now };
  });

export const recordAttendanceFirstResponse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => conversationSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const conversation = await ensureConversation(db, tenantId, data.conversationId);
    if (conversation.attendance_state !== "in_service" || conversation.first_response_at) {
      return { success: true, recorded: false };
    }
    const now = new Date().toISOString();
    await db
      .from("whatsapp_conversations")
      .update({ first_response_at: now, updated_at: now })
      .eq("tenant_id", tenantId)
      .eq("id", data.conversationId);
    await db
      .from("whatsapp_attendance_sessions")
      .update({ first_response_at: now })
      .eq("tenant_id", tenantId)
      .eq("conversation_id", data.conversationId)
      .is("closed_at", null)
      .is("first_response_at", null);
    return { success: true, recorded: true, firstResponseAt: now };
  });

export const updateAttendancePresence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => presenceSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const statusSince = await setOwnPresence(db, tenantId, context.userId, data.status);
    return { success: true, status: data.status, statusSince };
  });

export const updateAttendanceTags = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => tagsSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const tags = [...new Set(data.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 8);
    const { error } = await db
      .from("whatsapp_conversations")
      .update({ tags, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    return { success: true, tags };
  });

export const revealAttendancePhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => conversationSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const member = await membership(db, tenantId, context.userId);
    if (!member.canViewSensitiveData) throw new Error("SENSITIVE_DATA_FORBIDDEN");
    const { data: conversation, error } = await db
      .from("whatsapp_conversations")
      .select("phone_e164")
      .eq("tenant_id", tenantId)
      .eq("id", data.conversationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!conversation) throw new Error("Conversa não encontrada.");
    await db.from("sensitive_data_access_audit").insert({
      tenant_id: tenantId,
      user_id: context.userId,
      conversation_id: data.conversationId,
      field_name: "phone",
    });
    return { phone: String(conversation.phone_e164 ?? "") };
  });

export const setSensitiveDataVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => permissionSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const requester = await membership(context.supabase as any, tenantId, context.userId);
    if (!requester.canManageSensitiveVisibility) throw new Error("FORBIDDEN_PERMISSION_CHANGE");
    const admin = supabaseAdmin as any;
    const { data: target, error: targetError } = await admin
      .from("tenant_members")
      .select("id,member_role")
      .eq("tenant_id", tenantId)
      .eq("user_id", data.userId)
      .maybeSingle();
    if (targetError) throw new Error(targetError.message);
    if (!target) throw new Error("Usuário não pertence a esta organização.");
    if (["owner", "admin", "administrator"].includes(String(target.member_role ?? "").toLowerCase()) && !data.allowed) {
      throw new Error("A visibilidade do proprietário/administrador não pode ser removida.");
    }
    const { error } = await admin
      .from("tenant_members")
      .update({ can_view_sensitive_data: data.allowed })
      .eq("id", target.id);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const getAttendanceDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => dashboardSchema.parse(data))
  .handler(async ({ data, context }): Promise<AttendanceDashboard> => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const requester = await membership(db, tenantId, context.userId);

    const [{ count: waiting }, { data: sessions, error: sessionError }, { data: members, error: membersError }, { data: presence, error: presenceError }, { data: active, error: activeError }] = await Promise.all([
      db
        .from("whatsapp_conversations")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("attendance_state", "waiting"),
      db
        .from("whatsapp_attendance_sessions")
        .select("user_id,queued_at,accepted_at,first_response_at,closed_at")
        .eq("tenant_id", tenantId)
        .gte("accepted_at", data.startIso)
        .order("accepted_at", { ascending: false })
        .limit(2000),
      db
        .from("tenant_members")
        .select("user_id,member_role,can_view_sensitive_data")
        .eq("tenant_id", tenantId),
      db
        .from("whatsapp_attendant_presence")
        .select("user_id,status,status_since")
        .eq("tenant_id", tenantId),
      db
        .from("whatsapp_conversations")
        .select("assigned_user_id")
        .eq("tenant_id", tenantId)
        .eq("attendance_state", "in_service"),
    ]);
    if (sessionError) throw new Error(sessionError.message);
    if (membersError) throw new Error(membersError.message);
    if (presenceError) throw new Error(presenceError.message);
    if (activeError) throw new Error(activeError.message);

    const userIds = (members ?? []).map((row: any) => String(row.user_id)).filter(Boolean);
    const { data: profiles } = userIds.length
      ? await db.from("profiles").select("id,full_name").in("id", userIds)
      : { data: [] };
    const names = new Map((profiles ?? []).map((row: any) => [String(row.id), String(row.full_name || "Atendente")]));
    const presenceByUser = new Map((presence ?? []).map((row: any) => [String(row.user_id), row]));
    const activeCounts = new Map<string, number>();
    for (const row of active ?? []) {
      const id = row.assigned_user_id ? String(row.assigned_user_id) : "";
      if (id) activeCounts.set(id, (activeCounts.get(id) ?? 0) + 1);
    }

    const agents: AttendanceAgent[] = (members ?? []).map((row: any) => {
      const userId = String(row.user_id);
      const live = presenceByUser.get(userId);
      const role = String(row.member_role ?? "").toLowerCase();
      return {
        userId,
        name: names.get(userId) || "Atendente",
        status: (live?.status || "away") as AttendantPresenceStatus,
        statusSince: String(live?.status_since || new Date(0).toISOString()),
        activeConversations: activeCounts.get(userId) ?? 0,
        canViewSensitiveData:
          Boolean(row.can_view_sensitive_data) || ["owner", "admin", "administrator"].includes(role),
      };
    });

    const statuses: Record<AttendantPresenceStatus, number> = {
      alert: 0,
      in_service: 0,
      free: 0,
      paused: 0,
      away: 0,
    };
    for (const agent of agents) statuses[agent.status] += 1;

    const closedSessions = (sessions ?? []).filter((session: any) => session.closed_at);
    const waitSeconds = (sessions ?? [])
      .map((session: any) => secondsBetween(session.accepted_at, session.queued_at))
      .filter((value: number | null): value is number => value !== null);
    const responseSeconds = (sessions ?? [])
      .map((session: any) => secondsBetween(session.first_response_at, session.accepted_at))
      .filter((value: number | null): value is number => value !== null);
    const attendanceSeconds = closedSessions
      .map((session: any) => secondsBetween(session.closed_at, session.accepted_at))
      .filter((value: number | null): value is number => value !== null);

    return {
      waiting: waiting ?? 0,
      attended: closedSessions.length,
      avgWaitSeconds: average(waitSeconds),
      avgResponseSeconds: average(responseSeconds),
      avgAttendanceSeconds: average(attendanceSeconds),
      statuses,
      agents,
      canManageSensitiveVisibility: requester.canManageSensitiveVisibility,
    };
  });
