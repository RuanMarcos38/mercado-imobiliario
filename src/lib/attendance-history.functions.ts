import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTenantId } from "@/lib/tenant.server";

const reportSchema = z.object({ startIso: z.string().datetime() });

export interface AttendanceHistoryItem {
  conversationId: string;
  sessionId: string;
  protocolCode: string;
  contactName: string;
  attendantUserId: string | null;
  attendantName: string;
  closedAt: string;
  firstResponseSeconds: number | null;
  attendanceSeconds: number | null;
  rating: number | null;
  surveyStatus: string | null;
}

export interface AttendanceAgentReport {
  userId: string;
  name: string;
  closed: number;
  surveyResponses: number;
  averageRating: number | null;
  avgAttendanceSeconds: number;
}

export interface AttendanceHistoryReport {
  totalClosed: number;
  surveysSent: number;
  surveyResponses: number;
  surveyResponseRatePct: number;
  averageRating: number | null;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  avgFirstResponseSeconds: number;
  avgAttendanceSeconds: number;
  byAgent: AttendanceAgentReport[];
  closedConversations: AttendanceHistoryItem[];
}

type EventMetadata = Record<string, unknown>;
type EventRow = {
  event_type: string;
  metadata: EventMetadata | null;
  created_at: string | null;
};

type SessionAccumulator = {
  sessionId: string;
  conversationId: string | null;
  attendantUserId: string | null;
  queuedAt: string | null;
  acceptedAt: string | null;
  firstResponseAt: string | null;
  closedAt: string | null;
};

function db() {
  return supabaseAdmin as any;
}

function metadata(row: EventRow): EventMetadata {
  return row.metadata && typeof row.metadata === "object" ? row.metadata : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function secondsBetween(later?: string | null, earlier?: string | null) {
  if (!later || !earlier) return null;
  const diff = new Date(later).getTime() - new Date(earlier).getTime();
  if (!Number.isFinite(diff) || diff < 0) return null;
  return Math.round(diff / 1000);
}

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function averageRating(values: number[]) {
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function emptyReport(): AttendanceHistoryReport {
  return {
    totalClosed: 0,
    surveysSent: 0,
    surveyResponses: 0,
    surveyResponseRatePct: 0,
    averageRating: null,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    avgFirstResponseSeconds: 0,
    avgAttendanceSeconds: 0,
    byAgent: [],
    closedConversations: [],
  };
}

export const getAttendanceHistoryReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => reportSchema.parse(data))
  .handler(async ({ data, context }): Promise<AttendanceHistoryReport> => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const database = db();
    const startMs = new Date(data.startIso).getTime();
    const lookback = new Date(startMs - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: events, error: eventsError } = await database
      .from("system_events")
      .select("event_type,metadata,created_at")
      .eq("tenant_id", tenantId)
      .in("event_type", [
        "attendance_session_started",
        "attendance_first_response",
        "attendance_session_closed",
      ])
      .gte("created_at", lookback)
      .order("created_at", { ascending: true })
      .limit(10000);
    if (eventsError) throw new Error(eventsError.message);

    const sessions = new Map<string, SessionAccumulator>();
    for (const event of (events ?? []) as EventRow[]) {
      const eventMetadata = metadata(event);
      const sessionId = text(eventMetadata["sessionId"]);
      if (!sessionId) continue;
      const current = sessions.get(sessionId) ?? {
        sessionId,
        conversationId: null,
        attendantUserId: null,
        queuedAt: null,
        acceptedAt: null,
        firstResponseAt: null,
        closedAt: null,
      };
      current.conversationId = text(eventMetadata["conversationId"]) ?? current.conversationId;
      current.attendantUserId =
        text(eventMetadata["userId"]) ?? text(eventMetadata["assignedUserId"]) ?? current.attendantUserId;
      if (event.event_type === "attendance_session_started") {
        current.queuedAt = text(eventMetadata["queuedAt"]);
        current.acceptedAt = text(eventMetadata["acceptedAt"]) ?? event.created_at;
      } else if (event.event_type === "attendance_first_response") {
        current.firstResponseAt = text(eventMetadata["firstResponseAt"]) ?? event.created_at;
      } else if (event.event_type === "attendance_session_closed") {
        current.closedAt = text(eventMetadata["closedAt"]) ?? event.created_at;
      }
      sessions.set(sessionId, current);
    }

    const closedSessions = [...sessions.values()]
      .filter((session) => {
        if (!session.closedAt || !session.conversationId) return false;
        const closedMs = new Date(session.closedAt).getTime();
        return Number.isFinite(closedMs) && closedMs >= startMs;
      })
      .sort((a, b) => new Date(b.closedAt!).getTime() - new Date(a.closedAt!).getTime());

    if (!closedSessions.length) return emptyReport();

    const conversationIds = [...new Set(closedSessions.map((session) => session.conversationId!))];
    const userIds = [
      ...new Set(
        closedSessions
          .map((session) => session.attendantUserId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const sessionIds = closedSessions.map((session) => session.sessionId);

    const [conversationsResult, profilesResult] = await Promise.all([
      database
        .from("whatsapp_conversations")
        .select("id,protocol_code,contact_name")
        .eq("tenant_id", tenantId)
        .in("id", conversationIds),
      userIds.length
        ? database.from("profiles").select("id,full_name").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (conversationsResult.error) throw new Error(conversationsResult.error.message);
    if (profilesResult.error) throw new Error(profilesResult.error.message);

    let surveys: any[] = [];
    const surveyResult = await database
      .from("attendance_satisfaction_surveys")
      .select("session_id,rating,status,requested_at,responded_at")
      .eq("tenant_id", tenantId)
      .in("session_id", sessionIds);
    if (!surveyResult.error) {
      surveys = surveyResult.data ?? [];
    } else if (surveyResult.error.code !== "42P01") {
      throw new Error(surveyResult.error.message);
    }

    const conversations = new Map(
      (conversationsResult.data ?? []).map((row: any) => [
        String(row.id),
        {
          protocolCode: String(row.protocol_code ?? ""),
          contactName: String(row.contact_name ?? "Sem nome cadastrado"),
        },
      ]),
    );
    const names = new Map(
      (profilesResult.data ?? []).map((row: any) => [
        String(row.id),
        String(row.full_name || "Atendente"),
      ]),
    );
    const surveyBySession = new Map(surveys.map((row) => [String(row.session_id), row]));

    const closedConversations: AttendanceHistoryItem[] = closedSessions.slice(0, 300).map((session) => {
      const conversation = conversations.get(session.conversationId!) ?? {
        protocolCode: "",
        contactName: "Contato",
      };
      const survey = surveyBySession.get(session.sessionId);
      const rating = Number(survey?.rating);
      return {
        conversationId: session.conversationId!,
        sessionId: session.sessionId,
        protocolCode: conversation.protocolCode,
        contactName: conversation.contactName,
        attendantUserId: session.attendantUserId,
        attendantName: session.attendantUserId
          ? names.get(session.attendantUserId) || "Atendente"
          : "Atendente",
        closedAt: session.closedAt!,
        firstResponseSeconds: secondsBetween(session.firstResponseAt, session.acceptedAt),
        attendanceSeconds: secondsBetween(session.closedAt, session.acceptedAt),
        rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
        surveyStatus: survey?.status ? String(survey.status) : null,
      };
    });

    const sentSurveys = surveys.filter((row) => Boolean(row.requested_at) || row.status === "sent" || row.status === "answered");
    const answeredSurveys = surveys.filter((row) => {
      const rating = Number(row.rating);
      return Number.isInteger(rating) && rating >= 1 && rating <= 5;
    });
    const ratings = answeredSurveys.map((row) => Number(row.rating));
    const distribution: AttendanceHistoryReport["distribution"] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const rating of ratings) distribution[rating as 1 | 2 | 3 | 4 | 5] += 1;

    const responseSeconds = closedSessions
      .map((session) => secondsBetween(session.firstResponseAt, session.acceptedAt))
      .filter((value): value is number => value !== null);
    const attendanceSeconds = closedSessions
      .map((session) => secondsBetween(session.closedAt, session.acceptedAt))
      .filter((value): value is number => value !== null);

    const agentGroups = new Map<
      string,
      { name: string; closed: number; ratings: number[]; durations: number[] }
    >();
    for (const session of closedSessions) {
      if (!session.attendantUserId) continue;
      const group = agentGroups.get(session.attendantUserId) ?? {
        name: names.get(session.attendantUserId) || "Atendente",
        closed: 0,
        ratings: [],
        durations: [],
      };
      group.closed += 1;
      const duration = secondsBetween(session.closedAt, session.acceptedAt);
      if (duration !== null) group.durations.push(duration);
      const survey = surveyBySession.get(session.sessionId);
      const rating = Number(survey?.rating);
      if (Number.isInteger(rating) && rating >= 1 && rating <= 5) group.ratings.push(rating);
      agentGroups.set(session.attendantUserId, group);
    }

    const byAgent: AttendanceAgentReport[] = [...agentGroups.entries()]
      .map(([userId, group]) => ({
        userId,
        name: group.name,
        closed: group.closed,
        surveyResponses: group.ratings.length,
        averageRating: averageRating(group.ratings),
        avgAttendanceSeconds: average(group.durations),
      }))
      .sort((a, b) => b.closed - a.closed || a.name.localeCompare(b.name, "pt-BR"));

    return {
      totalClosed: closedSessions.length,
      surveysSent: sentSurveys.length,
      surveyResponses: answeredSurveys.length,
      surveyResponseRatePct: sentSurveys.length
        ? Math.round((answeredSurveys.length / sentSurveys.length) * 100)
        : 0,
      averageRating: averageRating(ratings),
      distribution,
      avgFirstResponseSeconds: average(responseSeconds),
      avgAttendanceSeconds: average(attendanceSeconds),
      byAgent,
      closedConversations,
    };
  });
