import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantEvolutionInstance } from "@/lib/evolution-instance.server";
import { sendEvolutionTextMessage } from "@/lib/evolution-text.server";
import { whatsappParameters } from "@/lib/platform-parameters.server";
import { normalizeWhatsAppPhone, whatsappPhoneErrorMessage } from "@/lib/whatsapp-phone";

type JsonObject = Record<string, unknown>;

type SystemEventRow = {
  event_type: string;
  metadata: JsonObject | null;
  created_at: string | null;
};

export const ATTENDANCE_SATISFACTION_SURVEY_TEXT =
  "Atendimento encerrado. Para nos ajudar a melhorar, de 1 a 5, qual nota você dá para este atendimento? Responda apenas com 1, 2, 3, 4 ou 5. Obrigado!";

const REQUESTED_EVENT = "attendance_satisfaction_requested";
const ANSWERED_EVENT = "attendance_satisfaction_answered";
const FAILED_EVENT = "attendance_satisfaction_send_failed";

function db(): typeof supabaseAdmin {
  return supabaseAdmin;
}

function metadata(row: SystemEventRow | null | undefined): JsonObject {
  return row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function externalMessageId(payload: JsonObject) {
  const key =
    payload["key"] && typeof payload["key"] === "object" ? (payload["key"] as JsonObject) : {};
  return (
    (typeof key["id"] === "string" && key["id"]) ||
    (typeof payload["id"] === "string" && payload["id"]) ||
    null
  );
}

async function recordEvent(
  database: ReturnType<typeof db>,
  tenantId: string,
  eventType: string,
  message: string,
  eventMetadata: JsonObject,
) {
  const events = database.from("system_events");
  if (!events || typeof events.insert !== "function") return;
  const { error } = await events.insert({
    tenant_id: tenantId,
    event_type: eventType,
    severity: "info",
    message,
    metadata: eventMetadata,
  });
  if (error) throw new Error(error.message);
}

async function satisfactionEvents(tenantId: string, conversationId: string) {
  const { data, error } = await db()
    .from("system_events")
    .select("event_type,metadata,created_at")
    .eq("tenant_id", tenantId)
    .in("event_type", [REQUESTED_EVENT, ANSWERED_EVENT])
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as SystemEventRow[]).filter(
    (event) => stringValue(metadata(event)["conversationId"]) === conversationId,
  );
}

async function alreadyRequested(tenantId: string, sessionId: string) {
  const { data, error } = await db()
    .from("system_events")
    .select("metadata,created_at")
    .eq("tenant_id", tenantId)
    .eq("event_type", REQUESTED_EVENT)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as SystemEventRow[]).some(
    (event) => stringValue(metadata(event)["sessionId"]) === sessionId,
  );
}

export function parseAttendanceSatisfactionRating(text: string | null | undefined): number | null {
  const normalized = String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .trim();
  const match = normalized.match(/^(?:nota\s*)?([1-5])(?:\s*\/\s*5)?$/i);
  if (!match) return null;
  const rating = Number(match[1]);
  return rating >= 1 && rating <= 5 ? rating : null;
}

export async function sendAttendanceSatisfactionSurvey(input: {
  tenantId: string;
  conversationId: string;
  sessionId: string;
  attendantUserId: string;
  phone: string;
  protocolCode?: string | null;
}) {
  const database = db();
  const baseMetadata = {
    conversationId: input.conversationId,
    sessionId: input.sessionId,
    attendantUserId: input.attendantUserId,
    protocolCode: input.protocolCode ?? "",
  };

  if (await alreadyRequested(input.tenantId, input.sessionId)) {
    return { sent: false, skipped: true, reason: "already_requested" as const };
  }

  const phone = normalizeWhatsAppPhone(input.phone);
  if (!phone) {
    const reason = whatsappPhoneErrorMessage(input.phone);
    await recordEvent(database, input.tenantId, FAILED_EVENT, reason, baseMetadata).catch(
      () => undefined,
    );
    return { sent: false, skipped: false, reason };
  }

  const instanceName = await getTenantEvolutionInstance(database, input.tenantId);
  if (!instanceName) {
    const reason = "WHATSAPP_NOT_CONFIGURED";
    await recordEvent(
      database,
      input.tenantId,
      FAILED_EVENT,
      "WhatsApp indisponível para pesquisa de satisfação",
      { ...baseMetadata, reason },
    ).catch(() => undefined);
    return { sent: false, skipped: false, reason };
  }

  let payload: JsonObject;
  try {
    payload = await sendEvolutionTextMessage({
      phone,
      text: ATTENDANCE_SATISFACTION_SURVEY_TEXT,
      delay: whatsappParameters().sendDelayMs,
      instanceName,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "attendance_survey_send_failed";
    await recordEvent(database, input.tenantId, FAILED_EVENT, reason, {
      ...baseMetadata,
      reason,
    }).catch(() => undefined);
    return { sent: false, skipped: false, reason };
  }

  const now = new Date().toISOString();
  const messageId = externalMessageId(payload);
  const insertResult = await database.from("whatsapp_messages").insert({
    tenant_id: input.tenantId,
    conversation_id: input.conversationId,
    external_message_id: messageId,
    direction: "outbound",
    message_type: "text",
    body: ATTENDANCE_SATISFACTION_SURVEY_TEXT,
    status: "sent",
    sent_at: now,
    raw_payload: {
      ...payload,
      mercadoimobi_kind: "attendance_satisfaction_request",
      attendance_session_id: input.sessionId,
    },
  });
  if (insertResult.error && insertResult.error.code !== "23505") {
    await recordEvent(
      database,
      input.tenantId,
      FAILED_EVENT,
      "Pesquisa enviada, mas não persistida no histórico de mensagens",
      { ...baseMetadata, requestMessageId: messageId, reason: insertResult.error.message },
    ).catch(() => undefined);
  }

  await database
    .from("whatsapp_conversations")
    .update({
      last_message: ATTENDANCE_SATISFACTION_SURVEY_TEXT,
      last_message_at: now,
      updated_at: now,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.conversationId);

  await recordEvent(database, input.tenantId, REQUESTED_EVENT, "Pesquisa de satisfação enviada", {
    ...baseMetadata,
    requestMessageId: messageId,
    requestedAt: now,
  }).catch(() => undefined);

  return { sent: true, skipped: false, reason: "sent" as const, requestMessageId: messageId };
}

export async function captureAttendanceSatisfactionResponse(input: {
  tenantId: string;
  conversationId: string;
  inboundText: string | null;
  inboundExternalMessageId?: string | null;
  inboundSentAt?: string;
}) {
  const rating = parseAttendanceSatisfactionRating(input.inboundText);
  if (!rating) return { captured: false as const, rating: null };

  const events = await satisfactionEvents(input.tenantId, input.conversationId);
  const latest = events[0];
  if (!latest || latest.event_type !== REQUESTED_EVENT) {
    return { captured: false as const, rating: null };
  }

  const latestMetadata = metadata(latest);
  const requestedAt = stringValue(latestMetadata["requestedAt"]) ?? latest.created_at;
  const requestedTime = requestedAt ? new Date(requestedAt).getTime() : Number.NaN;
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(requestedTime) || Date.now() - requestedTime > maxAgeMs) {
    return { captured: false as const, rating: null };
  }

  const database = db();
  await recordEvent(
    database,
    input.tenantId,
    ANSWERED_EVENT,
    `Pesquisa respondida com nota ${rating}`,
    {
      conversationId: input.conversationId,
      sessionId: stringValue(latestMetadata["sessionId"]),
      attendantUserId: stringValue(latestMetadata["attendantUserId"]),
      protocolCode: stringValue(latestMetadata["protocolCode"]),
      rating,
      responseText: input.inboundText,
      responseMessageId: input.inboundExternalMessageId ?? null,
      respondedAt: input.inboundSentAt || new Date().toISOString(),
    },
  );

  return { captured: true as const, rating };
}

export async function reopenClosedAttendanceAfterInbound(input: {
  tenantId: string;
  conversationId: string;
  inboundSentAt?: string;
}) {
  const database = db();
  const { data, error } = await database
    .from("system_events")
    .select("metadata,created_at")
    .eq("tenant_id", input.tenantId)
    .eq("event_type", "attendance_state")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);

  const latest = ((data ?? []) as SystemEventRow[]).find(
    (event) => stringValue(metadata(event)["conversationId"]) === input.conversationId,
  );
  const latestMetadata = metadata(latest);
  if (latestMetadata["state"] !== "automatic" || !latestMetadata["closedAt"]) return false;

  await database.from("system_events").insert({
    tenant_id: input.tenantId,
    event_type: "attendance_state",
    severity: "info",
    message: "Nova interação após atendimento encerrado",
    metadata: {
      conversationId: input.conversationId,
      state: "automatic",
      waitingSince: null,
      acceptedAt: null,
      firstResponseAt: null,
      closedAt: null,
      assignedUserId: null,
      departmentName: stringValue(latestMetadata["departmentName"]) ?? "Geral",
      sessionId: null,
      reopenedAt: input.inboundSentAt || new Date().toISOString(),
    },
  });
  return true;
}
