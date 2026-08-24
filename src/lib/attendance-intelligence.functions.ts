import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTenantId } from "@/lib/tenant.server";

export type AttendanceOperationalState = "waiting" | "in_service" | "automatic";

export type CriticalAttendanceConversation = {
  conversationId: string;
  contactLabel: string;
  phoneMasked: string;
  state: AttendanceOperationalState;
  reason: string;
  urgency: "breached" | "risk" | "unanswered";
  ageSeconds: number;
  slaPct: number;
  lastMessageAt: string | null;
};

export type AttendanceIntelligence = {
  generatedAt: string;
  totalAttendances: number;
  inboundMessages: number;
  outboundMessages: number;
  unansweredNow: number;
  unreadMessages: number;
  slaBreachedNow: number;
  slaAtRiskNow: number;
  slaCompliancePct: number;
  slaMeasured: number;
  answerRatePct: number;
  healthScore: number;
  healthLabel: "Saudável" | "Atenção" | "Crítico";
  backlogNow: number;
  oldestPendingSeconds: number;
  peakInboundHour: string | null;
  current: {
    waiting: number;
    inService: number;
    automatic: number;
  };
  aging: {
    under5m: number;
    from5to15m: number;
    from15to30m: number;
    over30m: number;
  };
  sla: {
    waitingTargetSeconds: number;
    firstResponseTargetSeconds: number;
    riskThresholdPct: number;
  };
  criticalConversations: CriticalAttendanceConversation[];
  insights: string[];
};

type JsonObject = Record<string, unknown>;
type EventRow = { event_type: string; metadata: JsonObject | null; created_at: string | null };
type CurrentState = {
  state: AttendanceOperationalState;
  waitingSince: string | null;
  acceptedAt: string | null;
  firstResponseAt: string | null;
  assignedUserId: string | null;
};

const dashboardSchema = z.object({ startIso: z.string().datetime() });
const WAITING_SLA_SECONDS = 5 * 60;
const FIRST_RESPONSE_SLA_SECONDS = 5 * 60;
const SLA_RISK_THRESHOLD_PCT = 80;

function db() {
  return supabaseAdmin as any;
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isState(value: unknown): value is AttendanceOperationalState {
  return value === "waiting" || value === "in_service" || value === "automatic";
}

function stateFromEvent(
  event: EventRow | undefined,
  fallbackAssignedUserId: string | null,
): CurrentState {
  const metadata = object(event?.metadata);
  return {
    state: isState(metadata["state"])
      ? metadata["state"]
      : fallbackAssignedUserId
        ? "in_service"
        : "automatic",
    waitingSince: stringValue(metadata["waitingSince"]),
    acceptedAt: stringValue(metadata["acceptedAt"]),
    firstResponseAt: stringValue(metadata["firstResponseAt"]),
    assignedUserId: stringValue(metadata["assignedUserId"]) ?? fallbackAssignedUserId,
  };
}

function ageSeconds(iso: string | null | undefined, nowMs: number) {
  if (!iso) return 0;
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.round((nowMs - timestamp) / 1000));
}

function secondsBetween(later: string | null, earlier: string | null) {
  if (!later || !earlier) return null;
  const diff = new Date(later).getTime() - new Date(earlier).getTime();
  if (!Number.isFinite(diff) || diff < 0) return null;
  return Math.round(diff / 1000);
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 6) return "••••••";
  return `${digits.slice(0, 4)}••••${digits.slice(-4)}`;
}

function localHour(iso: string) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo",
  }).formatToParts(new Date(iso));
  const raw = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  return raw === 24 ? 0 : raw;
}

function peakHourLabel(hour: number) {
  const next = (hour + 1) % 24;
  return `${String(hour).padStart(2, "0")}:00–${String(next).padStart(2, "0")}:00`;
}

export const getAttendanceIntelligence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => dashboardSchema.parse(data))
  .handler(async ({ data, context }): Promise<AttendanceIntelligence> => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const database = db();
    const now = new Date();
    const nowMs = now.getTime();

    const [
      conversationsResult,
      stateEventsResult,
      periodMessagesResult,
      latestMessagesResult,
      sessionEventsResult,
    ] = await Promise.all([
      database
        .from("whatsapp_conversations")
        .select("id,contact_name,phone_e164,last_message_at,unread_count,assigned_user_id")
        .eq("tenant_id", tenantId)
        .limit(1000),
      database
        .from("system_events")
        .select("event_type,metadata,created_at")
        .eq("tenant_id", tenantId)
        .eq("event_type", "attendance_state")
        .order("created_at", { ascending: false })
        .limit(5000),
      database
        .from("whatsapp_messages")
        .select("conversation_id,direction,sent_at")
        .eq("tenant_id", tenantId)
        .gte("sent_at", data.startIso)
        .order("sent_at", { ascending: true })
        .limit(10000),
      database
        .from("whatsapp_messages")
        .select("conversation_id,direction,sent_at")
        .eq("tenant_id", tenantId)
        .order("sent_at", { ascending: false })
        .limit(10000),
      database
        .from("system_events")
        .select("event_type,metadata,created_at")
        .eq("tenant_id", tenantId)
        .in("event_type", [
          "attendance_session_started",
          "attendance_first_response",
          "attendance_session_closed",
        ])
        .gte("created_at", data.startIso)
        .order("created_at", { ascending: true })
        .limit(5000),
    ]);

    for (const result of [
      conversationsResult,
      stateEventsResult,
      periodMessagesResult,
      latestMessagesResult,
      sessionEventsResult,
    ]) {
      if (result.error) throw new Error(result.error.message);
    }

    const latestState = new Map<string, EventRow>();
    for (const event of (stateEventsResult.data ?? []) as EventRow[]) {
      const conversationId = stringValue(object(event.metadata)["conversationId"]);
      if (conversationId && !latestState.has(conversationId))
        latestState.set(conversationId, event);
    }

    const latestMessage = new Map<string, any>();
    for (const message of latestMessagesResult.data ?? []) {
      const conversationId = String(message.conversation_id ?? "");
      if (conversationId && !latestMessage.has(conversationId))
        latestMessage.set(conversationId, message);
    }

    const activeConversationIds = new Set<string>();
    const inboundConversationIds = new Set<string>();
    const answeredConversationIds = new Set<string>();
    const firstInboundAt = new Map<string, number>();
    const hourCounts = new Map<number, number>();
    let inboundMessages = 0;
    let outboundMessages = 0;

    for (const message of periodMessagesResult.data ?? []) {
      const conversationId = String(message.conversation_id ?? "");
      if (!conversationId) continue;
      activeConversationIds.add(conversationId);
      const sentAtMs = new Date(String(message.sent_at ?? "")).getTime();
      if (message.direction === "inbound") {
        inboundMessages += 1;
        inboundConversationIds.add(conversationId);
        if (Number.isFinite(sentAtMs) && !firstInboundAt.has(conversationId)) {
          firstInboundAt.set(conversationId, sentAtMs);
        }
        if (message.sent_at) {
          const hour = localHour(String(message.sent_at));
          hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
        }
      } else if (message.direction === "outbound") {
        outboundMessages += 1;
        const inboundAt = firstInboundAt.get(conversationId);
        if (inboundAt !== undefined && Number.isFinite(sentAtMs) && sentAtMs >= inboundAt) {
          answeredConversationIds.add(conversationId);
        }
      }
    }

    const sessions = new Map<
      string,
      {
        conversationId: string | null;
        queuedAt: string | null;
        acceptedAt: string | null;
        firstResponseAt: string | null;
        closedAt: string | null;
      }
    >();
    for (const event of (sessionEventsResult.data ?? []) as EventRow[]) {
      const metadata = object(event.metadata);
      const sessionId = stringValue(metadata["sessionId"]);
      if (!sessionId) continue;
      const current = sessions.get(sessionId) ?? {
        conversationId: null,
        queuedAt: null,
        acceptedAt: null,
        firstResponseAt: null,
        closedAt: null,
      };
      current.conversationId = stringValue(metadata["conversationId"]) ?? current.conversationId;
      if (event.event_type === "attendance_session_started") {
        current.queuedAt = stringValue(metadata["queuedAt"]);
        current.acceptedAt = stringValue(metadata["acceptedAt"]) ?? event.created_at;
      } else if (event.event_type === "attendance_first_response") {
        current.firstResponseAt = stringValue(metadata["firstResponseAt"]) ?? event.created_at;
      } else if (event.event_type === "attendance_session_closed") {
        current.closedAt = stringValue(metadata["closedAt"]) ?? event.created_at;
      }
      sessions.set(sessionId, current);
    }
    for (const session of sessions.values()) {
      if (session.conversationId) activeConversationIds.add(session.conversationId);
    }

    const measuredSessions = [...sessions.values()].filter(
      (session) => session.acceptedAt && session.firstResponseAt,
    );
    const slaMet = measuredSessions.filter((session) => {
      const wait = secondsBetween(session.acceptedAt, session.queuedAt);
      const response = secondsBetween(session.firstResponseAt, session.acceptedAt);
      const waitOk = wait === null || wait <= WAITING_SLA_SECONDS;
      const responseOk = response !== null && response <= FIRST_RESPONSE_SLA_SECONDS;
      return waitOk && responseOk;
    }).length;
    const slaCompliancePct = measuredSessions.length
      ? Math.round((slaMet / measuredSessions.length) * 100)
      : 100;

    let waiting = 0;
    let inService = 0;
    let automatic = 0;
    let unansweredNow = 0;
    let unreadMessages = 0;
    let slaBreachedNow = 0;
    let slaAtRiskNow = 0;
    let oldestPendingSeconds = 0;
    let automaticUnanswered = 0;
    const aging = { under5m: 0, from5to15m: 0, from15to30m: 0, over30m: 0 };
    const criticalConversations: CriticalAttendanceConversation[] = [];

    for (const row of conversationsResult.data ?? []) {
      const conversationId = String(row.id);
      const state = stateFromEvent(latestState.get(conversationId), row.assigned_user_id ?? null);
      if (state.state === "waiting") waiting += 1;
      else if (state.state === "in_service") inService += 1;
      else automatic += 1;
      unreadMessages += Number(row.unread_count ?? 0);

      const latest = latestMessage.get(conversationId);
      const latestIsInbound = latest?.direction === "inbound";
      const unansweredAge = latestIsInbound ? ageSeconds(String(latest.sent_at ?? ""), nowMs) : 0;
      if (latestIsInbound) {
        unansweredNow += 1;
        if (state.state === "automatic") automaticUnanswered += 1;
        oldestPendingSeconds = Math.max(oldestPendingSeconds, unansweredAge);
        if (unansweredAge < 5 * 60) aging.under5m += 1;
        else if (unansweredAge < 15 * 60) aging.from5to15m += 1;
        else if (unansweredAge < 30 * 60) aging.from15to30m += 1;
        else aging.over30m += 1;
      }

      const waitingAge = state.state === "waiting" ? ageSeconds(state.waitingSince, nowMs) : 0;
      const firstResponseAge =
        state.state === "in_service" && !state.firstResponseAt
          ? ageSeconds(state.acceptedAt, nowMs)
          : 0;
      oldestPendingSeconds = Math.max(oldestPendingSeconds, waitingAge, firstResponseAge);

      const candidates: Array<{ reason: string; age: number; target: number }> = [];
      if (state.state === "waiting" && waitingAge > 0) {
        candidates.push({
          reason: "Aguardando atendimento humano",
          age: waitingAge,
          target: WAITING_SLA_SECONDS,
        });
      }
      if (state.state === "in_service" && !state.firstResponseAt && firstResponseAge > 0) {
        candidates.push({
          reason: "Atendimento assumido sem 1ª resposta",
          age: firstResponseAge,
          target: FIRST_RESPONSE_SLA_SECONDS,
        });
      }
      if (latestIsInbound && unansweredAge > 0) {
        candidates.push({
          reason: "Cliente aguardando resposta",
          age: unansweredAge,
          target: FIRST_RESPONSE_SLA_SECONDS,
        });
      }

      const worst = candidates
        .map((candidate) => ({
          ...candidate,
          pct: Math.round((candidate.age / candidate.target) * 100),
        }))
        .sort((a, b) => b.pct - a.pct)[0];
      if (!worst) continue;

      const breached = worst.pct >= 100;
      const atRisk = !breached && worst.pct >= SLA_RISK_THRESHOLD_PCT;
      if (breached) slaBreachedNow += 1;
      else if (atRisk) slaAtRiskNow += 1;

      if (breached || atRisk || latestIsInbound) {
        criticalConversations.push({
          conversationId,
          contactLabel: String(row.contact_name || "Contato sem nome"),
          phoneMasked: maskPhone(String(row.phone_e164 ?? "")),
          state: state.state,
          reason: worst.reason,
          urgency: breached ? "breached" : atRisk ? "risk" : "unanswered",
          ageSeconds: worst.age,
          slaPct: clamp(worst.pct, 0, 999),
          lastMessageAt: row.last_message_at ?? null,
        });
      }
    }

    criticalConversations.sort((a, b) => {
      const priority = { breached: 3, risk: 2, unanswered: 1 } as const;
      const difference = priority[b.urgency] - priority[a.urgency];
      return difference || b.slaPct - a.slaPct || b.ageSeconds - a.ageSeconds;
    });

    const answerRatePct = inboundConversationIds.size
      ? Math.round((answeredConversationIds.size / inboundConversationIds.size) * 100)
      : 100;
    const backlogNow = waiting + inService + automaticUnanswered;
    const openOperational = Math.max(1, waiting + inService + automaticUnanswered);
    const backlogHealth = clamp(100 - (slaBreachedNow / openOperational) * 100);
    const healthScore = Math.round(
      0.45 * slaCompliancePct + 0.35 * answerRatePct + 0.2 * backlogHealth,
    );
    const healthLabel: AttendanceIntelligence["healthLabel"] =
      healthScore >= 85 ? "Saudável" : healthScore >= 65 ? "Atenção" : "Crítico";

    let peakInboundHour: string | null = null;
    if (hourCounts.size) {
      const [peakHour] = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
      if (typeof peakHour === "number") peakInboundHour = peakHourLabel(peakHour);
    }

    const insights: string[] = [];
    if (slaBreachedNow > 0) {
      insights.push(
        `${slaBreachedNow} conversa${slaBreachedNow === 1 ? " está" : "s estão"} acima do SLA e deve${slaBreachedNow === 1 ? "" : "m"} ser priorizada${slaBreachedNow === 1 ? "" : "s"} agora.`,
      );
    }
    if (unansweredNow > 0) {
      insights.push(
        `${unansweredNow} conversa${unansweredNow === 1 ? " termina" : "s terminam"} com mensagem do cliente sem resposta posterior.`,
      );
    }
    if (measuredSessions.length > 0 && slaCompliancePct < 90) {
      insights.push(
        `A aderência ao SLA no período está em ${slaCompliancePct}%; a meta recomendada é manter pelo menos 90%.`,
      );
    }
    if (peakInboundHour) {
      insights.push(
        `Maior concentração de mensagens recebidas no período: ${peakInboundHour}. Considere reforçar capacidade nesse intervalo.`,
      );
    }
    if (!insights.length) {
      insights.push("Operação estável: não há gargalo crítico identificado neste momento.");
    }

    return {
      generatedAt: now.toISOString(),
      totalAttendances: activeConversationIds.size,
      inboundMessages,
      outboundMessages,
      unansweredNow,
      unreadMessages,
      slaBreachedNow,
      slaAtRiskNow,
      slaCompliancePct,
      slaMeasured: measuredSessions.length,
      answerRatePct,
      healthScore,
      healthLabel,
      backlogNow,
      oldestPendingSeconds,
      peakInboundHour,
      current: { waiting, inService, automatic },
      aging,
      sla: {
        waitingTargetSeconds: WAITING_SLA_SECONDS,
        firstResponseTargetSeconds: FIRST_RESPONSE_SLA_SECONDS,
        riskThresholdPct: SLA_RISK_THRESHOLD_PCT,
      },
      criticalConversations: criticalConversations.slice(0, 8),
      insights: insights.slice(0, 4),
    };
  });
