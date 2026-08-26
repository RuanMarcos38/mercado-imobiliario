import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  evolutionGatewayConfig,
  getTenantEvolutionInstance,
} from "@/lib/evolution-instance.server";
import { sendEvolutionTextMessage } from "@/lib/evolution-text.server";
import { whatsappParameters } from "@/lib/platform-parameters.server";
import { normalizeWhatsAppPhone, whatsappPhoneErrorMessage } from "@/lib/whatsapp-phone";

type JsonObject = Record<string, unknown>;

type SystemEventRow = {
  event_type: string;
  metadata: JsonObject | null;
  created_at: string | null;
};

type SurveyRow = {
  id: string;
  tenant_id: string;
  conversation_id: string;
  session_id: string;
  attendant_user_id: string | null;
  protocol_code: string | null;
  status: "queued" | "sending" | "sent" | "answered" | "failed";
  attempts: number | null;
  requested_at?: string | null;
  request_message_id?: string | null;
};

export const ATTENDANCE_SATISFACTION_SURVEY_TEXT =
  "Atendimento encerrado. Para nos ajudar a melhorar, de 1 a 5, qual nota você dá para este atendimento? Responda apenas com 1, 2, 3, 4 ou 5. Obrigado!";

const REQUESTED_EVENT = "attendance_satisfaction_requested";
const ANSWERED_EVENT = "attendance_satisfaction_answered";
const FAILED_EVENT = "attendance_satisfaction_send_failed";
const SURVEY_COLUMNS =
  "id,tenant_id,conversation_id,session_id,attendant_user_id,protocol_code,status,attempts,requested_at,request_message_id";

function db() {
  return supabaseAdmin as any;
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

function unavailableSurveyTable(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return code === "42P01" || /attendance_satisfaction_surveys/i.test(message);
}

async function recordEvent(
  tenantId: string,
  eventType: string,
  message: string,
  eventMetadata: JsonObject,
) {
  const events = db().from("system_events");
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

async function alreadyRequestedByEvent(tenantId: string, sessionId: string) {
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

async function findSurveyBySession(tenantId: string, sessionId: string) {
  try {
    const table = db().from("attendance_satisfaction_surveys");
    if (!table || typeof table.select !== "function") return undefined;
    const { data, error } = await table
      .select(SURVEY_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("session_id", sessionId)
      .maybeSingle();
    if (error) {
      if (unavailableSurveyTable(error)) return undefined;
      throw new Error(error.message);
    }
    return (data ?? null) as SurveyRow | null;
  } catch (error) {
    if (unavailableSurveyTable(error) || error instanceof TypeError) return undefined;
    throw error;
  }
}

async function createSurveyRow(input: {
  tenantId: string;
  conversationId: string;
  sessionId: string;
  attendantUserId: string;
  protocolCode?: string | null;
}) {
  const now = new Date().toISOString();
  try {
    const { data, error } = await db()
      .from("attendance_satisfaction_surveys")
      .insert({
        tenant_id: input.tenantId,
        conversation_id: input.conversationId,
        session_id: input.sessionId,
        attendant_user_id: input.attendantUserId,
        protocol_code: input.protocolCode ?? "",
        status: "queued",
        next_attempt_at: now,
        created_at: now,
        updated_at: now,
      })
      .select(SURVEY_COLUMNS)
      .maybeSingle();
    if (error) {
      if (error.code === "23505") {
        return await findSurveyBySession(input.tenantId, input.sessionId);
      }
      if (unavailableSurveyTable(error)) return undefined;
      throw new Error(error.message);
    }
    return (data ?? null) as SurveyRow | null;
  } catch (error) {
    if (unavailableSurveyTable(error) || error instanceof TypeError) return undefined;
    throw error;
  }
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

async function markSurveyFailure(
  row: Pick<SurveyRow, "id" | "tenant_id" | "session_id" | "conversation_id" | "attempts">,
  reason: string,
) {
  const attempts = Number(row.attempts ?? 0) + 1;
  const delaySeconds = Math.min(3600, 60 * 2 ** Math.min(attempts - 1, 5));
  const now = new Date().toISOString();
  const nextAttempt = new Date(Date.now() + delaySeconds * 1000).toISOString();
  await db()
    .from("attendance_satisfaction_surveys")
    .update({
      status: "failed",
      attempts,
      last_attempt_at: now,
      next_attempt_at: nextAttempt,
      updated_at: now,
    })
    .eq("id", row.id);
  await recordEvent(row.tenant_id, FAILED_EVENT, reason, {
    surveyId: row.id,
    sessionId: row.session_id,
    conversationId: row.conversation_id,
    attempt: attempts,
  }).catch(() => undefined);
}

async function dispatchSurvey(row: SurveyRow, phoneOverride?: string | null) {
  const database = db();
  if (row.status === "sent" || row.status === "answered") {
    return {
      sent: false,
      skipped: true,
      reason: "already_requested" as const,
      requestMessageId: row.request_message_id ?? null,
    };
  }

  const claimed = await database
    .from("attendance_satisfaction_surveys")
    .update({ status: "sending", updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .in("status", ["queued", "failed"])
    .is("rating", null)
    .select("id")
    .maybeSingle();
  if (claimed.error) throw new Error(claimed.error.message);
  if (!claimed.data) return { sent: false, skipped: true, reason: "already_claimed" as const };

  let conversationPhone = phoneOverride ?? null;
  if (!conversationPhone) {
    const { data: conversation, error: conversationError } = await database
      .from("whatsapp_conversations")
      .select("id,phone_e164")
      .eq("tenant_id", row.tenant_id)
      .eq("id", row.conversation_id)
      .maybeSingle();
    if (conversationError || !conversation) {
      await markSurveyFailure(row, "Conversa não encontrada para envio da pesquisa.");
      return { sent: false, skipped: false, reason: "conversation_not_found" as const };
    }
    conversationPhone = String(conversation.phone_e164 ?? "");
  }

  const phone = normalizeWhatsAppPhone(conversationPhone);
  if (!phone) {
    const reason = whatsappPhoneErrorMessage(conversationPhone);
    await markSurveyFailure(row, reason);
    return { sent: false, skipped: false, reason };
  }

  const instanceName = await getTenantEvolutionInstance(database, row.tenant_id);
  const gateway = evolutionGatewayConfig();
  if (!gateway || !instanceName) {
    const reason = "WHATSAPP_NOT_CONFIGURED";
    await markSurveyFailure(row, "WhatsApp indisponível para a pesquisa de satisfação.");
    return { sent: false, skipped: false, reason };
  }

  try {
    const payload = (await sendEvolutionTextMessage({
      phone,
      text: ATTENDANCE_SATISFACTION_SURVEY_TEXT,
      delay: whatsappParameters().sendDelayMs,
      instanceName,
    })) as JsonObject;
    const messageId = externalMessageId(payload);
    const now = new Date().toISOString();

    const messageInsert = await database.from("whatsapp_messages").insert({
      tenant_id: row.tenant_id,
      conversation_id: row.conversation_id,
      external_message_id: messageId,
      direction: "outbound",
      message_type: "text",
      body: ATTENDANCE_SATISFACTION_SURVEY_TEXT,
      status: "sent",
      sent_at: now,
      raw_payload: {
        ...payload,
        mercadoimobi_kind: "attendance_satisfaction_request",
        attendance_survey_id: row.id,
        attendance_session_id: row.session_id,
      },
    });
    if (messageInsert.error && messageInsert.error.code !== "23505") {
      throw new Error(messageInsert.error.message);
    }

    await database
      .from("whatsapp_conversations")
      .update({
        last_message: ATTENDANCE_SATISFACTION_SURVEY_TEXT,
        last_message_at: now,
        updated_at: now,
      })
      .eq("tenant_id", row.tenant_id)
      .eq("id", row.conversation_id);

    await database
      .from("attendance_satisfaction_surveys")
      .update({
        status: "sent",
        requested_at: now,
        request_message_id: messageId,
        attempts: Number(row.attempts ?? 0) + 1,
        last_attempt_at: now,
        next_attempt_at: now,
        updated_at: now,
      })
      .eq("id", row.id);

    await recordEvent(row.tenant_id, REQUESTED_EVENT, "Pesquisa de satisfação enviada", {
      surveyId: row.id,
      sessionId: row.session_id,
      conversationId: row.conversation_id,
      attendantUserId: row.attendant_user_id,
      protocolCode: row.protocol_code,
      requestMessageId: messageId,
      requestedAt: now,
    }).catch(() => undefined);

    return { sent: true, skipped: false, reason: "sent" as const, requestMessageId: messageId };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Falha ao enviar a pesquisa de satisfação.";
    await markSurveyFailure(row, reason);
    return { sent: false, skipped: false, reason };
  }
}

async function sendSurveyWithoutQueue(input: {
  tenantId: string;
  conversationId: string;
  sessionId: string;
  attendantUserId: string;
  phone: string;
  protocolCode?: string | null;
}) {
  const baseMetadata = {
    conversationId: input.conversationId,
    sessionId: input.sessionId,
    attendantUserId: input.attendantUserId,
    protocolCode: input.protocolCode ?? "",
  };

  if (await alreadyRequestedByEvent(input.tenantId, input.sessionId)) {
    return { sent: false, skipped: true, reason: "already_requested" as const };
  }

  const phone = normalizeWhatsAppPhone(input.phone);
  if (!phone) {
    const reason = whatsappPhoneErrorMessage(input.phone);
    await recordEvent(input.tenantId, FAILED_EVENT, reason, baseMetadata).catch(() => undefined);
    return { sent: false, skipped: false, reason };
  }

  const instanceName = await getTenantEvolutionInstance(db(), input.tenantId);
  const gateway = evolutionGatewayConfig();
  if (!gateway || !instanceName) {
    const reason = "WHATSAPP_NOT_CONFIGURED";
    await recordEvent(
      input.tenantId,
      FAILED_EVENT,
      "WhatsApp indisponível para pesquisa de satisfação",
      {
        ...baseMetadata,
        reason,
      },
    ).catch(() => undefined);
    return { sent: false, skipped: false, reason };
  }

  try {
    const payload = (await sendEvolutionTextMessage({
      phone,
      text: ATTENDANCE_SATISFACTION_SURVEY_TEXT,
      delay: whatsappParameters().sendDelayMs,
      instanceName,
    })) as JsonObject;
    const now = new Date().toISOString();
    const messageId = externalMessageId(payload);
    const insertResult = await db()
      .from("whatsapp_messages")
      .insert({
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
        input.tenantId,
        FAILED_EVENT,
        "Pesquisa enviada, mas não persistida no histórico de mensagens",
        { ...baseMetadata, requestMessageId: messageId, reason: insertResult.error.message },
      ).catch(() => undefined);
    }

    await db()
      .from("whatsapp_conversations")
      .update({
        last_message: ATTENDANCE_SATISFACTION_SURVEY_TEXT,
        last_message_at: now,
        updated_at: now,
      })
      .eq("tenant_id", input.tenantId)
      .eq("id", input.conversationId);

    await recordEvent(input.tenantId, REQUESTED_EVENT, "Pesquisa de satisfação enviada", {
      ...baseMetadata,
      requestMessageId: messageId,
      requestedAt: now,
    }).catch(() => undefined);

    return { sent: true, skipped: false, reason: "sent" as const, requestMessageId: messageId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "attendance_survey_send_failed";
    await recordEvent(input.tenantId, FAILED_EVENT, reason, {
      ...baseMetadata,
      reason,
    }).catch(() => undefined);
    return { sent: false, skipped: false, reason };
  }
}

export async function sendAttendanceSatisfactionSurvey(input: {
  tenantId: string;
  conversationId: string;
  sessionId: string;
  attendantUserId: string;
  phone: string;
  protocolCode?: string | null;
}) {
  const existing = await findSurveyBySession(input.tenantId, input.sessionId);
  if (existing === undefined) return sendSurveyWithoutQueue(input);

  const row =
    existing ??
    (await createSurveyRow({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      sessionId: input.sessionId,
      attendantUserId: input.attendantUserId,
      protocolCode: input.protocolCode,
    }));

  if (!row) return sendSurveyWithoutQueue(input);
  return dispatchSurvey(row, input.phone);
}

export async function processAttendanceSatisfactionQueue(limit = 25) {
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("attendance_satisfaction_surveys")
    .select(SURVEY_COLUMNS)
    .in("status", ["queued", "failed"])
    .is("rating", null)
    .lt("attempts", 5)
    .lte("next_attempt_at", now)
    .order("created_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 50)));
  if (error) throw new Error(error.message);

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of (data ?? []) as SurveyRow[]) {
    const result = await dispatchSurvey(row);
    if (result.sent) sent += 1;
    else if (result.skipped) skipped += 1;
    else failed += 1;
  }
  return { processed: (data ?? []).length, sent, failed, skipped };
}

async function captureSurveyTableResponse(input: {
  tenantId: string;
  conversationId: string;
  inboundText: string;
  rating: number;
  inboundExternalMessageId?: string | null;
  inboundSentAt?: string;
}) {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const database = db();
    const { data: survey, error } = await database
      .from("attendance_satisfaction_surveys")
      .select("id,session_id,attendant_user_id,protocol_code,requested_at")
      .eq("tenant_id", input.tenantId)
      .eq("conversation_id", input.conversationId)
      .eq("status", "sent")
      .is("rating", null)
      .gte("requested_at", cutoff)
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (unavailableSurveyTable(error)) return false;
      throw new Error(error.message);
    }
    if (!survey) return false;

    const respondedAt = input.inboundSentAt || new Date().toISOString();
    const { data: updated, error: updateError } = await database
      .from("attendance_satisfaction_surveys")
      .update({
        rating: input.rating,
        status: "answered",
        responded_at: respondedAt,
        response_message_id: input.inboundExternalMessageId ?? null,
        response_text: input.inboundText,
        updated_at: new Date().toISOString(),
      })
      .eq("id", survey.id)
      .eq("status", "sent")
      .is("rating", null)
      .select("id")
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (!updated) return false;

    await recordEvent(
      input.tenantId,
      ANSWERED_EVENT,
      `Pesquisa respondida com nota ${input.rating}`,
      {
        surveyId: survey.id,
        sessionId: survey.session_id,
        conversationId: input.conversationId,
        attendantUserId: survey.attendant_user_id,
        protocolCode: survey.protocol_code,
        rating: input.rating,
        responseText: input.inboundText,
        responseMessageId: input.inboundExternalMessageId ?? null,
        respondedAt,
      },
    ).catch(() => undefined);
    return true;
  } catch (error) {
    if (unavailableSurveyTable(error) || error instanceof TypeError) return false;
    throw error;
  }
}

async function captureSurveyEventResponse(input: {
  tenantId: string;
  conversationId: string;
  inboundText: string;
  rating: number;
  inboundExternalMessageId?: string | null;
  inboundSentAt?: string;
}) {
  const events = await satisfactionEvents(input.tenantId, input.conversationId);
  const latest = events[0];
  if (!latest || latest.event_type !== REQUESTED_EVENT) return false;

  const latestMetadata = metadata(latest);
  const requestedAt = stringValue(latestMetadata["requestedAt"]) ?? latest.created_at;
  const requestedTime = requestedAt ? new Date(requestedAt).getTime() : Number.NaN;
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(requestedTime) || Date.now() - requestedTime > maxAgeMs) return false;

  await recordEvent(
    input.tenantId,
    ANSWERED_EVENT,
    `Pesquisa respondida com nota ${input.rating}`,
    {
      conversationId: input.conversationId,
      sessionId: stringValue(latestMetadata["sessionId"]),
      attendantUserId: stringValue(latestMetadata["attendantUserId"]),
      protocolCode: stringValue(latestMetadata["protocolCode"]),
      rating: input.rating,
      responseText: input.inboundText,
      responseMessageId: input.inboundExternalMessageId ?? null,
      respondedAt: input.inboundSentAt || new Date().toISOString(),
    },
  );
  return true;
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

  const inboundText = String(input.inboundText ?? "");
  const capturedInTable = await captureSurveyTableResponse({
    ...input,
    inboundText,
    rating,
  });
  if (capturedInTable) return { captured: true as const, rating };

  const capturedByEvent = await captureSurveyEventResponse({
    ...input,
    inboundText,
    rating,
  });
  return { captured: capturedByEvent as boolean, rating: capturedByEvent ? rating : null };
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
  if (String(latestMetadata["state"] ?? "") !== "automatic" || !latestMetadata["closedAt"]) {
    return false;
  }

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
