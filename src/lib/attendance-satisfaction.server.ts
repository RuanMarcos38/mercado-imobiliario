import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  evolutionGatewayConfig,
  getTenantEvolutionInstance,
} from "@/lib/evolution-instance.server";
import { sendEvolutionTextMessage } from "@/lib/evolution-text.server";
import { whatsappParameters } from "@/lib/platform-parameters.server";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";

const SURVEY_TEXT =
  "Atendimento encerrado. Para nos ajudar a melhorar, de 1 a 5, qual nota você dá para este atendimento? Responda apenas com 1, 2, 3, 4 ou 5. Obrigado!";

function db() {
  return supabaseAdmin as any;
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

async function recordEvent(
  tenantId: string,
  eventType: string,
  message: string,
  metadata: Record<string, unknown>,
) {
  await db().from("system_events").insert({
    tenant_id: tenantId,
    event_type: eventType,
    severity: "info",
    message,
    metadata,
  });
}

function externalMessageId(payload: Record<string, unknown>) {
  const key =
    payload["key"] && typeof payload["key"] === "object"
      ? (payload["key"] as Record<string, unknown>)
      : {};
  return (
    (typeof key["id"] === "string" && key["id"]) ||
    (typeof payload["id"] === "string" && payload["id"]) ||
    null
  );
}

async function markSurveyFailure(row: any, reason: string) {
  const attempts = Number(row.attempts ?? 0) + 1;
  const delaySeconds = Math.min(3600, 60 * 2 ** Math.min(attempts - 1, 5));
  const nextAttempt = new Date(Date.now() + delaySeconds * 1000).toISOString();
  await db()
    .from("attendance_satisfaction_surveys")
    .update({
      status: "failed",
      attempts,
      last_attempt_at: new Date().toISOString(),
      next_attempt_at: nextAttempt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  await recordEvent(row.tenant_id, "attendance_satisfaction_send_failed", reason, {
    surveyId: row.id,
    sessionId: row.session_id,
    conversationId: row.conversation_id,
    attempt: attempts,
  }).catch(() => undefined);
}

async function dispatchSurvey(row: any) {
  const database = db();
  const claimed = await database
    .from("attendance_satisfaction_surveys")
    .update({ status: "sending", updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .in("status", ["queued", "failed"])
    .is("rating", null)
    .select("id")
    .maybeSingle();
  if (claimed.error) throw new Error(claimed.error.message);
  if (!claimed.data) return { sent: false, skipped: true };

  const { data: conversation, error: conversationError } = await database
    .from("whatsapp_conversations")
    .select("id,phone_e164")
    .eq("tenant_id", row.tenant_id)
    .eq("id", row.conversation_id)
    .maybeSingle();
  if (conversationError || !conversation) {
    await markSurveyFailure(row, "Conversa não encontrada para envio da pesquisa.");
    return { sent: false, skipped: false };
  }

  const instanceName = await getTenantEvolutionInstance(database, row.tenant_id);
  const gateway = evolutionGatewayConfig();
  const phone = normalizeWhatsAppPhone(String(conversation.phone_e164 ?? ""));
  if (!gateway || !instanceName || !phone) {
    await markSurveyFailure(row, "WhatsApp indisponível para a pesquisa de satisfação.");
    return { sent: false, skipped: false };
  }

  try {
    const payload = await sendEvolutionTextMessage({
      phone,
      text: SURVEY_TEXT,
      delay: whatsappParameters().sendDelayMs,
      instanceName,
    });
    const messageId = externalMessageId(payload);
    const now = new Date().toISOString();

    const messageInsert = await database.from("whatsapp_messages").insert({
      tenant_id: row.tenant_id,
      conversation_id: row.conversation_id,
      external_message_id: messageId,
      direction: "outbound",
      message_type: "text",
      body: SURVEY_TEXT,
      status: "sent",
      sent_at: now,
      raw_payload: {
        ...payload,
        mercadoimobi_kind: "attendance_satisfaction_request",
        attendance_survey_id: row.id,
      },
    });
    if (messageInsert.error && messageInsert.error.code !== "23505") {
      throw new Error(messageInsert.error.message);
    }

    await database
      .from("whatsapp_conversations")
      .update({ last_message: SURVEY_TEXT, last_message_at: now, updated_at: now })
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

    await recordEvent(row.tenant_id, "attendance_satisfaction_requested", "Pesquisa de satisfação enviada", {
      surveyId: row.id,
      sessionId: row.session_id,
      conversationId: row.conversation_id,
      attendantUserId: row.attendant_user_id,
      protocolCode: row.protocol_code,
    }).catch(() => undefined);
    return { sent: true, skipped: false };
  } catch (error) {
    await markSurveyFailure(
      row,
      error instanceof Error ? error.message : "Falha ao enviar a pesquisa de satisfação.",
    );
    return { sent: false, skipped: false };
  }
}

export async function processAttendanceSatisfactionQueue(limit = 25) {
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("attendance_satisfaction_surveys")
    .select(
      "id,tenant_id,conversation_id,session_id,attendant_user_id,protocol_code,status,attempts,next_attempt_at",
    )
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
  for (const row of data ?? []) {
    const result = await dispatchSurvey(row);
    if (result.sent) sent += 1;
    else if (result.skipped) skipped += 1;
    else failed += 1;
  }
  return { processed: (data ?? []).length, sent, failed, skipped };
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
  if (error) throw new Error(error.message);
  if (!survey) return { captured: false as const, rating: null };

  const respondedAt = input.inboundSentAt || new Date().toISOString();
  const { data: updated, error: updateError } = await database
    .from("attendance_satisfaction_surveys")
    .update({
      rating,
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
  if (!updated) return { captured: false as const, rating: null };

  await recordEvent(input.tenantId, "attendance_satisfaction_answered", `Pesquisa respondida com nota ${rating}`, {
    surveyId: survey.id,
    sessionId: survey.session_id,
    conversationId: input.conversationId,
    attendantUserId: survey.attendant_user_id,
    protocolCode: survey.protocol_code,
    rating,
  }).catch(() => undefined);

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

  const latest = (data ?? []).find((row: any) => {
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    return String(metadata.conversationId ?? "") === input.conversationId;
  });
  const metadata =
    latest?.metadata && typeof latest.metadata === "object" ? latest.metadata : ({} as Record<string, unknown>);
  if (String(metadata.state ?? "") !== "automatic" || !metadata.closedAt) return false;

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
      departmentName: String(metadata.departmentName ?? "Geral"),
      sessionId: null,
      reopenedAt: input.inboundSentAt || new Date().toISOString(),
    },
  });
  return true;
}
