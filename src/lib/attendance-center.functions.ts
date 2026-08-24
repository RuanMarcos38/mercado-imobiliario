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

type EventMetadata = Record<string, unknown>;
type SystemEventRow = {
  event_type: string;
  metadata: EventMetadata | null;
  created_at: string | null;
};

type CurrentAttendanceState = {
  state: AttendanceState;
  waitingSince: string | null;
  acceptedAt: string | null;
  firstResponseAt: string | null;
  closedAt: string | null;
  departmentName: string | null;
  sessionId: string | null;
  assignedUserId: string | null;
};

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

const EVENT = {
  state: "attendance_state",
  tags: "attendance_tags",
  presence: "attendance_presence",
  sensitivePermission: "attendance_sensitive_permission",
  sessionStarted: "attendance_session_started",
  firstResponse: "attendance_first_response",
  sessionClosed: "attendance_session_closed",
  sensitiveAccess: "sensitive_data_access",
} as const;

function adminDb() {
  return supabaseAdmin as any;
}

function metadata(row: SystemEventRow | null | undefined): EventMetadata {
  return row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

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

function isAttendanceState(value: unknown): value is AttendanceState {
  return value === "waiting" || value === "in_service" || value === "automatic";
}

function isPresenceStatus(value: unknown): value is AttendantPresenceStatus {
  return (
    value === "alert" ||
    value === "in_service" ||
    value === "free" ||
    value === "paused" ||
    value === "away"
  );
}

async function membership(tenantId: string, userId: string) {
  const db = adminDb();
  const { data, error } = await db
    .from("tenant_members")
    .select("member_role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("TENANT_MEMBERSHIP_REQUIRED");
  const role = String(data.member_role ?? "").toLowerCase();
  return {
    role,
    canManageSensitiveVisibility: ["owner", "admin", "administrator"].includes(role),
  };
}

async function latestEvent(
  tenantId: string,
  eventType: string,
  predicate: (eventMetadata: EventMetadata) => boolean,
) {
  const db = adminDb();
  const { data, error } = await db
    .from("system_events")
    .select("event_type,metadata,created_at")
    .eq("tenant_id", tenantId)
    .eq("event_type", eventType)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as SystemEventRow[]).find((row) => predicate(metadata(row))) ?? null;
}

async function insertEvent(
  tenantId: string,
  eventType: string,
  eventMetadata: EventMetadata,
  message: string,
) {
  const db = adminDb();
  const { error } = await db.from("system_events").insert({
    tenant_id: tenantId,
    event_type: eventType,
    message,
    metadata: eventMetadata,
    severity: "info",
  });
  if (error) throw new Error(error.message);
}

async function canViewSensitiveData(tenantId: string, userId: string, role?: string) {
  const normalizedRole = (role ?? (await membership(tenantId, userId)).role).toLowerCase();
  if (["owner", "admin", "administrator"].includes(normalizedRole)) return true;
  const event = await latestEvent(
    tenantId,
    EVENT.sensitivePermission,
    (eventMetadata) => stringValue(eventMetadata["userId"]) === userId,
  );
  return metadata(event)["allowed"] === true;
}

async function ensureConversation(tenantId: string, conversationId: string) {
  const db = adminDb();
  const { data, error } = await db
    .from("whatsapp_conversations")
    .select("id,assigned_user_id,phone_e164")
    .eq("tenant_id", tenantId)
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Conversa não encontrada.");
  return data;
}

function stateFromEvent(
  event: SystemEventRow | null | undefined,
  fallbackAssignedUserId: string | null,
): CurrentAttendanceState {
  const eventMetadata = metadata(event);
  const state = isAttendanceState(eventMetadata["state"])
    ? eventMetadata["state"]
    : fallbackAssignedUserId
      ? "in_service"
      : "automatic";
  return {
    state,
    waitingSince: stringValue(eventMetadata["waitingSince"]),
    acceptedAt: stringValue(eventMetadata["acceptedAt"]),
    firstResponseAt: stringValue(eventMetadata["firstResponseAt"]),
    closedAt: stringValue(eventMetadata["closedAt"]),
    departmentName: stringValue(eventMetadata["departmentName"]),
    sessionId: stringValue(eventMetadata["sessionId"]),
    assignedUserId: stringValue(eventMetadata["assignedUserId"]) ?? fallbackAssignedUserId,
  };
}

async function currentState(
  tenantId: string,
  conversationId: string,
  fallbackAssignedUserId: string | null,
) {
  const event = await latestEvent(
    tenantId,
    EVENT.state,
    (eventMetadata) => stringValue(eventMetadata["conversationId"]) === conversationId,
  );
  return stateFromEvent(event, fallbackAssignedUserId);
}

async function setOwnPresence(tenantId: string, userId: string, status: AttendantPresenceStatus) {
  const now = new Date().toISOString();
  await insertEvent(
    tenantId,
    EVENT.presence,
    { userId, status, statusSince: now },
    `Status de atendimento: ${status}`,
  );
  return now;
}

async function loadOperationalEvents(tenantId: string) {
  const db = adminDb();
  const { data, error } = await db
    .from("system_events")
    .select("event_type,metadata,created_at")
    .eq("tenant_id", tenantId)
    .in("event_type", [EVENT.state, EVENT.tags, EVENT.sensitivePermission, EVENT.presence])
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(error.message);
  return (data ?? []) as SystemEventRow[];
}

export const listAttendanceConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AttendanceConversation[]> => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = adminDb();
    const member = await membership(tenantId, context.userId);
    const [events, conversationsResult] = await Promise.all([
      loadOperationalEvents(tenantId),
      db
        .from("whatsapp_conversations")
        .select(
          "id,phone_e164,contact_name,avatar_url,last_message,last_message_at,unread_count,assigned_user_id",
        )
        .eq("tenant_id", tenantId)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(300),
    ]);
    if (conversationsResult.error) throw new Error(conversationsResult.error.message);

    const latestState = new Map<string, SystemEventRow>();
    const latestTags = new Map<string, SystemEventRow>();
    const latestPermission = new Map<string, SystemEventRow>();
    for (const event of events) {
      const eventMetadata = metadata(event);
      if (event.event_type === EVENT.state) {
        const id = stringValue(eventMetadata["conversationId"]);
        if (id && !latestState.has(id)) latestState.set(id, event);
      } else if (event.event_type === EVENT.tags) {
        const id = stringValue(eventMetadata["conversationId"]);
        if (id && !latestTags.has(id)) latestTags.set(id, event);
      } else if (event.event_type === EVENT.sensitivePermission) {
        const id = stringValue(eventMetadata["userId"]);
        if (id && !latestPermission.has(id)) latestPermission.set(id, event);
      }
    }

    const permissionEvent = latestPermission.get(context.userId);
    const permissionMetadata = metadata(permissionEvent);
    const canView = member.canManageSensitiveVisibility || permissionMetadata["allowed"] === true;

    return (conversationsResult.data ?? []).map((row: any) => {
      const state = stateFromEvent(latestState.get(String(row.id)), row.assigned_user_id ?? null);
      const tagMetadata = metadata(latestTags.get(String(row.id)));
      const rawTags = Array.isArray(tagMetadata["tags"]) ? tagMetadata["tags"] : [];
      const rawPhone = String(row.phone_e164 ?? "");
      return {
        id: String(row.id),
        phone_e164: canView ? rawPhone : maskPhone(rawPhone),
        phone_masked: !canView,
        contact_name: row.contact_name ?? null,
        avatar_url: row.avatar_url ?? null,
        last_message: row.last_message ?? null,
        last_message_at: row.last_message_at ?? null,
        unread_count: Number(row.unread_count ?? 0),
        attendance_state: state.state,
        assigned_user_id: state.assignedUserId,
        waiting_since: state.waitingSince,
        accepted_at: state.acceptedAt,
        first_response_at: state.firstResponseAt,
        closed_at: state.closedAt,
        department_name: state.departmentName,
        tags: rawTags.map(String).slice(0, 8),
      } satisfies AttendanceConversation;
    });
  });

export const getAttendanceViewer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const member = await membership(tenantId, context.userId);
    const [canView, presenceEvent] = await Promise.all([
      canViewSensitiveData(tenantId, context.userId, member.role),
      latestEvent(
        tenantId,
        EVENT.presence,
        (eventMetadata) => stringValue(eventMetadata["userId"]) === context.userId,
      ),
    ]);
    const presenceMetadata = metadata(presenceEvent);
    return {
      canViewSensitiveData: canView,
      canManageSensitiveVisibility: member.canManageSensitiveVisibility,
      presence: isPresenceStatus(presenceMetadata["status"])
        ? presenceMetadata["status"]
        : ("free" as AttendantPresenceStatus),
    };
  });

export const queueAttendanceConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => conversationSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = adminDb();
    await ensureConversation(tenantId, data.conversationId);
    const now = new Date().toISOString();
    const { error } = await db
      .from("whatsapp_conversations")
      .update({ assigned_user_id: null, updated_at: now })
      .eq("tenant_id", tenantId)
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    await insertEvent(
      tenantId,
      EVENT.state,
      {
        conversationId: data.conversationId,
        state: "waiting",
        waitingSince: now,
        acceptedAt: null,
        firstResponseAt: null,
        closedAt: null,
        assignedUserId: null,
        departmentName: "Geral",
      },
      "Conversa enviada para fila humana",
    );
    return { success: true, waitingSince: now };
  });

export const claimAttendanceConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => conversationSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = adminDb();
    const conversation = await ensureConversation(tenantId, data.conversationId);
    const state = await currentState(
      tenantId,
      data.conversationId,
      conversation.assigned_user_id ?? null,
    );
    if (
      state.state === "in_service" &&
      state.assignedUserId &&
      state.assignedUserId !== context.userId
    ) {
      throw new Error("Esta conversa já está em atendimento por outro usuário.");
    }

    const now = new Date().toISOString();
    const sessionId = state.sessionId || crypto.randomUUID();
    const queuedAt = state.waitingSince || now;
    const { error } = await db
      .from("whatsapp_conversations")
      .update({ assigned_user_id: context.userId, updated_at: now })
      .eq("tenant_id", tenantId)
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);

    if (!state.sessionId || state.state !== "in_service") {
      await insertEvent(
        tenantId,
        EVENT.sessionStarted,
        {
          sessionId,
          conversationId: data.conversationId,
          userId: context.userId,
          queuedAt,
          acceptedAt: now,
        },
        "Sessão de atendimento iniciada",
      );
    }
    await insertEvent(
      tenantId,
      EVENT.state,
      {
        conversationId: data.conversationId,
        state: "in_service",
        waitingSince: queuedAt,
        acceptedAt: state.acceptedAt || now,
        firstResponseAt: state.firstResponseAt,
        closedAt: null,
        assignedUserId: context.userId,
        departmentName: state.departmentName || "Geral",
        sessionId,
      },
      "Atendimento assumido",
    );
    await setOwnPresence(tenantId, context.userId, "in_service");
    return { success: true, acceptedAt: now };
  });

export const endAttendanceConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => conversationSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = adminDb();
    const conversation = await ensureConversation(tenantId, data.conversationId);
    const state = await currentState(
      tenantId,
      data.conversationId,
      conversation.assigned_user_id ?? null,
    );
    if (state.assignedUserId && state.assignedUserId !== context.userId) {
      throw new Error("Somente o atendente responsável pode encerrar este atendimento.");
    }
    const now = new Date().toISOString();
    const { error } = await db
      .from("whatsapp_conversations")
      .update({ assigned_user_id: null, updated_at: now })
      .eq("tenant_id", tenantId)
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);

    if (state.sessionId) {
      await insertEvent(
        tenantId,
        EVENT.sessionClosed,
        {
          sessionId: state.sessionId,
          conversationId: data.conversationId,
          userId: context.userId,
          closedAt: now,
        },
        "Sessão de atendimento encerrada",
      );
    }
    await insertEvent(
      tenantId,
      EVENT.state,
      {
        conversationId: data.conversationId,
        state: "automatic",
        waitingSince: state.waitingSince,
        acceptedAt: state.acceptedAt,
        firstResponseAt: state.firstResponseAt,
        closedAt: now,
        assignedUserId: null,
        departmentName: state.departmentName || "Geral",
        sessionId: state.sessionId,
      },
      "Atendimento encerrado e devolvido ao automático",
    );

    const { count } = await db
      .from("whatsapp_conversations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("assigned_user_id", context.userId);
    if ((count ?? 0) === 0) await setOwnPresence(tenantId, context.userId, "free");
    return { success: true, closedAt: now };
  });

export const recordAttendanceFirstResponse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => conversationSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const conversation = await ensureConversation(tenantId, data.conversationId);
    const state = await currentState(
      tenantId,
      data.conversationId,
      conversation.assigned_user_id ?? null,
    );
    if (state.state !== "in_service" || state.firstResponseAt) {
      return { success: true, recorded: false };
    }
    const now = new Date().toISOString();
    const sessionId = state.sessionId || crypto.randomUUID();
    await insertEvent(
      tenantId,
      EVENT.firstResponse,
      {
        sessionId,
        conversationId: data.conversationId,
        userId: context.userId,
        firstResponseAt: now,
      },
      "Primeira resposta humana registrada",
    );
    await insertEvent(
      tenantId,
      EVENT.state,
      {
        conversationId: data.conversationId,
        state: "in_service",
        waitingSince: state.waitingSince,
        acceptedAt: state.acceptedAt || now,
        firstResponseAt: now,
        closedAt: null,
        assignedUserId: state.assignedUserId || context.userId,
        departmentName: state.departmentName || "Geral",
        sessionId,
      },
      "Tempo de primeira resposta atualizado",
    );
    return { success: true, recorded: true, firstResponseAt: now };
  });

export const updateAttendancePresence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => presenceSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const statusSince = await setOwnPresence(tenantId, context.userId, data.status);
    return { success: true, status: data.status, statusSince };
  });

export const updateAttendanceTags = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => tagsSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    await ensureConversation(tenantId, data.conversationId);
    const tags = [...new Set(data.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 8);
    await insertEvent(
      tenantId,
      EVENT.tags,
      { conversationId: data.conversationId, tags },
      "Tags de conversa atualizadas",
    );
    return { success: true, tags };
  });

export const revealAttendancePhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => conversationSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const member = await membership(tenantId, context.userId);
    const allowed = await canViewSensitiveData(tenantId, context.userId, member.role);
    if (!allowed) throw new Error("SENSITIVE_DATA_FORBIDDEN");
    const conversation = await ensureConversation(tenantId, data.conversationId);
    await insertEvent(
      tenantId,
      EVENT.sensitiveAccess,
      {
        conversationId: data.conversationId,
        userId: context.userId,
        fieldName: "phone",
      },
      "Acesso autorizado a dado sensível",
    );
    return { phone: String(conversation.phone_e164 ?? "") };
  });

export const setSensitiveDataVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => permissionSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const requester = await membership(tenantId, context.userId);
    if (!requester.canManageSensitiveVisibility) throw new Error("FORBIDDEN_PERMISSION_CHANGE");
    const target = await membership(tenantId, data.userId);
    if (["owner", "admin", "administrator"].includes(target.role) && !data.allowed) {
      throw new Error("A visibilidade do proprietário/administrador não pode ser removida.");
    }
    await insertEvent(
      tenantId,
      EVENT.sensitivePermission,
      { userId: data.userId, allowed: data.allowed, changedBy: context.userId },
      "Permissão de dados sensíveis atualizada",
    );
    return { success: true };
  });

export const getAttendanceDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => dashboardSchema.parse(data))
  .handler(async ({ data, context }): Promise<AttendanceDashboard> => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = adminDb();
    const requester = await membership(tenantId, context.userId);

    const [membersResult, conversationsResult, operationalEvents, sessionEventsResult] =
      await Promise.all([
        db.from("tenant_members").select("user_id,member_role").eq("tenant_id", tenantId),
        db.from("whatsapp_conversations").select("id,assigned_user_id").eq("tenant_id", tenantId),
        loadOperationalEvents(tenantId),
        db
          .from("system_events")
          .select("event_type,metadata,created_at")
          .eq("tenant_id", tenantId)
          .in("event_type", [EVENT.sessionStarted, EVENT.firstResponse, EVENT.sessionClosed])
          .gte("created_at", data.startIso)
          .order("created_at", { ascending: true })
          .limit(5000),
      ]);
    if (membersResult.error) throw new Error(membersResult.error.message);
    if (conversationsResult.error) throw new Error(conversationsResult.error.message);
    if (sessionEventsResult.error) throw new Error(sessionEventsResult.error.message);

    const latestState = new Map<string, SystemEventRow>();
    const latestPresence = new Map<string, SystemEventRow>();
    const latestPermission = new Map<string, SystemEventRow>();
    for (const event of operationalEvents) {
      const eventMetadata = metadata(event);
      if (event.event_type === EVENT.state) {
        const id = stringValue(eventMetadata["conversationId"]);
        if (id && !latestState.has(id)) latestState.set(id, event);
      } else if (event.event_type === EVENT.presence) {
        const id = stringValue(eventMetadata["userId"]);
        if (id && !latestPresence.has(id)) latestPresence.set(id, event);
      } else if (event.event_type === EVENT.sensitivePermission) {
        const id = stringValue(eventMetadata["userId"]);
        if (id && !latestPermission.has(id)) latestPermission.set(id, event);
      }
    }

    let waiting = 0;
    const activeCounts = new Map<string, number>();
    for (const row of conversationsResult.data ?? []) {
      const id = String(row.id);
      const state = stateFromEvent(latestState.get(id), row.assigned_user_id ?? null);
      if (state.state === "waiting") waiting += 1;
      if (state.state === "in_service" && state.assignedUserId) {
        activeCounts.set(state.assignedUserId, (activeCounts.get(state.assignedUserId) ?? 0) + 1);
      }
    }

    const userIds = (membersResult.data ?? [])
      .map((row: any) => String(row.user_id))
      .filter(Boolean);
    const { data: profiles, error: profilesError } = userIds.length
      ? await db.from("profiles").select("id,full_name").in("id", userIds)
      : { data: [], error: null };
    if (profilesError) throw new Error(profilesError.message);
    const names = new Map(
      (profiles ?? []).map((row: any) => [String(row.id), String(row.full_name || "Atendente")]),
    );

    const agents: AttendanceAgent[] = (membersResult.data ?? []).map((row: any) => {
      const userId = String(row.user_id);
      const role = String(row.member_role ?? "").toLowerCase();
      const presenceMetadata = metadata(latestPresence.get(userId));
      const permissionMetadata = metadata(latestPermission.get(userId));
      const status = isPresenceStatus(presenceMetadata["status"])
        ? presenceMetadata["status"]
        : "away";
      return {
        userId,
        name: names.get(userId) || "Atendente",
        status,
        statusSince: stringValue(presenceMetadata["statusSince"]) || new Date(0).toISOString(),
        activeConversations: activeCounts.get(userId) ?? 0,
        canViewSensitiveData:
          ["owner", "admin", "administrator"].includes(role) ||
          permissionMetadata["allowed"] === true,
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

    type Session = {
      queuedAt: string | null;
      acceptedAt: string | null;
      firstResponseAt: string | null;
      closedAt: string | null;
    };
    const sessions = new Map<string, Session>();
    for (const event of (sessionEventsResult.data ?? []) as SystemEventRow[]) {
      const eventMetadata = metadata(event);
      const sessionId = stringValue(eventMetadata["sessionId"]);
      if (!sessionId) continue;
      const current = sessions.get(sessionId) ?? {
        queuedAt: null,
        acceptedAt: null,
        firstResponseAt: null,
        closedAt: null,
      };
      if (event.event_type === EVENT.sessionStarted) {
        current.queuedAt = stringValue(eventMetadata["queuedAt"]);
        current.acceptedAt = stringValue(eventMetadata["acceptedAt"]) || event.created_at;
      } else if (event.event_type === EVENT.firstResponse) {
        current.firstResponseAt = stringValue(eventMetadata["firstResponseAt"]) || event.created_at;
      } else if (event.event_type === EVENT.sessionClosed) {
        current.closedAt = stringValue(eventMetadata["closedAt"]) || event.created_at;
      }
      sessions.set(sessionId, current);
    }

    const allSessions = [...sessions.values()];
    const closedSessions = allSessions.filter((session) => session.closedAt);
    const waitSeconds = allSessions
      .map((session) => secondsBetween(session.acceptedAt, session.queuedAt))
      .filter((value): value is number => value !== null);
    const responseSeconds = allSessions
      .map((session) => secondsBetween(session.firstResponseAt, session.acceptedAt))
      .filter((value): value is number => value !== null);
    const attendanceSeconds = closedSessions
      .map((session) => secondsBetween(session.closedAt, session.acceptedAt))
      .filter((value): value is number => value !== null);

    return {
      waiting,
      attended: closedSessions.length,
      avgWaitSeconds: average(waitSeconds),
      avgResponseSeconds: average(responseSeconds),
      avgAttendanceSeconds: average(attendanceSeconds),
      statuses,
      agents,
      canManageSensitiveVisibility: requester.canManageSensitiveVisibility,
    };
  });
