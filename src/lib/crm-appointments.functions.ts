import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTenantId } from "@/lib/tenant.server";
import { sendEvolutionTextMessage } from "@/lib/evolution-text.server";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";

const appointmentSchema = z.object({
  opportunityId: z.string().uuid().nullable().optional(),
  contactName: z.string().trim().min(2).max(160),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  contactEmail: z.string().trim().email().nullable().optional().or(z.literal("")),
  title: z.string().trim().min(2).max(200),
  notes: z.string().trim().max(3000).nullable().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  timezone: z.string().trim().min(3).max(80).default("America/Sao_Paulo"),
  meetingType: z.enum(["meet", "phone", "in_person", "other"]).default("meet"),
  location: z.string().trim().max(300).nullable().optional(),
});

const appointmentIdSchema = z.object({ appointmentId: z.string().uuid() });

export interface CrmAppointmentItem {
  id: string;
  opportunityId: string | null;
  conversationId: string | null;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  title: string;
  notes: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  meetingType: string;
  location: string | null;
  meetUrl: string | null;
  googleEventId: string | null;
  status: string;
  confirmationStatus: string;
  reminder24hSentAt: string | null;
  reminder5hSentAt: string | null;
}

function mapAppointment(row: any): CrmAppointmentItem {
  return {
    id: String(row.id),
    opportunityId: row.opportunity_id ? String(row.opportunity_id) : null,
    conversationId: row.conversation_id ? String(row.conversation_id) : null,
    contactName: String(row.contact_name),
    contactPhone: row.contact_phone ? String(row.contact_phone) : null,
    contactEmail: row.contact_email ? String(row.contact_email) : null,
    title: String(row.title),
    notes: row.notes ? String(row.notes) : null,
    startsAt: String(row.starts_at),
    endsAt: String(row.ends_at),
    timezone: String(row.timezone),
    meetingType: String(row.meeting_type),
    location: row.location ? String(row.location) : null,
    meetUrl: row.meet_url ? String(row.meet_url) : null,
    googleEventId: row.google_event_id ? String(row.google_event_id) : null,
    status: String(row.status),
    confirmationStatus: String(row.confirmation_status),
    reminder24hSentAt: row.reminder_24h_sent_at ? String(row.reminder_24h_sent_at) : null,
    reminder5hSentAt: row.reminder_5h_sent_at ? String(row.reminder_5h_sent_at) : null,
  };
}

export const listMyCrmAppointments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CrmAppointmentItem[]> => {
    const tenantId = await requireTenantId(context.supabase as any, context.userId);
    const { data, error } = await (context.supabase as any)
      .from("crm_appointments")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("owner_user_id", context.userId)
      .gte("starts_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order("starts_at", { ascending: true })
      .limit(300);
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapAppointment);
  });

export const createCrmAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => appointmentSchema.parse(data))
  .handler(async ({ context, data }) => {
    const tenantId = await requireTenantId(context.supabase as any, context.userId);
    if (new Date(data.endsAt).getTime() <= new Date(data.startsAt).getTime()) {
      throw new Error("O horário final precisa ser posterior ao início.");
    }
    const db = context.supabase as any;
    let conversationId: string | null = null;
    let contactName = data.contactName;
    let contactPhone = data.contactPhone || null;
    let contactEmail = data.contactEmail || null;

    if (data.opportunityId) {
      const { data: opportunity } = await db
        .from("crm_opportunities")
        .select("contact_name,contact_phone,contact_email,conversation_id")
        .eq("tenant_id", tenantId)
        .eq("id", data.opportunityId)
        .maybeSingle();
      if (opportunity) {
        contactName = String(opportunity.contact_name || contactName);
        contactPhone = opportunity.contact_phone ? String(opportunity.contact_phone) : contactPhone;
        contactEmail = opportunity.contact_email ? String(opportunity.contact_email) : contactEmail;
        conversationId = opportunity.conversation_id ? String(opportunity.conversation_id) : null;
      }
    }

    const { data: created, error } = await db
      .from("crm_appointments")
      .insert({
        tenant_id: tenantId,
        opportunity_id: data.opportunityId || null,
        conversation_id: conversationId,
        owner_user_id: context.userId,
        contact_name: contactName,
        contact_phone: contactPhone,
        contact_email: contactEmail || null,
        title: data.title,
        notes: data.notes || null,
        starts_at: data.startsAt,
        ends_at: data.endsAt,
        timezone: data.timezone,
        meeting_type: data.meetingType,
        location: data.location || null,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    let googleWarning: string | null = null;
    if (data.meetingType === "meet") {
      try {
        const { createGoogleCalendarMeeting } = await import("@/lib/google-workspace.server");
        const google = await createGoogleCalendarMeeting({
          tenantId,
          userId: context.userId,
          title: data.title,
          description: data.notes || `Atendimento MercadoImobi com ${contactName}`,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          timezone: data.timezone,
          attendeeEmail: contactEmail || null,
        });
        const { data: updated, error: updateError } = await db
          .from("crm_appointments")
          .update({
            meet_url: google.meetUrl,
            google_calendar_id: google.calendarId,
            google_event_id: google.eventId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", created.id)
          .select("*")
          .single();
        if (updateError) throw new Error(updateError.message);
        return { appointment: mapAppointment(updated), googleWarning: null };
      } catch (googleError) {
        googleWarning =
          googleError instanceof Error && googleError.message === "GOOGLE_NOT_CONNECTED"
            ? "Agendamento salvo no MercadoImobi. Conecte o Google para gerar Meet e sincronizar a agenda."
            : googleError instanceof Error
              ? `Agendamento salvo, mas o Google não sincronizou: ${googleError.message}`
              : "Agendamento salvo, mas o Google não sincronizou.";
      }
    }

    return { appointment: mapAppointment(created), googleWarning };
  });

export const cancelCrmAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => appointmentIdSchema.parse(data))
  .handler(async ({ context, data }) => {
    const tenantId = await requireTenantId(context.supabase as any, context.userId);
    const db = context.supabase as any;
    const { data: appointment, error } = await db
      .from("crm_appointments")
      .select("id,google_event_id,google_calendar_id,owner_user_id")
      .eq("tenant_id", tenantId)
      .eq("owner_user_id", context.userId)
      .eq("id", data.appointmentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!appointment) throw new Error("Agendamento não encontrado.");
    if (appointment.google_event_id) {
      const { cancelGoogleCalendarMeeting } = await import("@/lib/google-workspace.server");
      await cancelGoogleCalendarMeeting({
        tenantId,
        userId: context.userId,
        eventId: String(appointment.google_event_id),
        calendarId: appointment.google_calendar_id ? String(appointment.google_calendar_id) : null,
      }).catch(() => undefined);
    }
    await db
      .from("crm_appointments")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", data.appointmentId);
    return { success: true };
  });

export async function maybeApplyAppointmentConfirmation(input: {
  tenantId: string;
  conversationId: string;
  inboundText: string;
}) {
  const normalized = input.inboundText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  const confirms = /^(sim|s|confirmo|confirmado|confirmar|ok|pode confirmar|estarei presente)[.! ]*$/.test(
    normalized,
  );
  const reschedule = /\b(remarcar|reagendar|outro horario|mudar horario|nao posso)\b/.test(normalized);
  if (!confirms && !reschedule) return null;

  const db = supabaseAdmin as any;
  const { data: appointment } = await db
    .from("crm_appointments")
    .select("id,contact_name,starts_at")
    .eq("tenant_id", input.tenantId)
    .eq("conversation_id", input.conversationId)
    .in("status", ["scheduled", "confirmed"])
    .gte("starts_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .lte("starts_at", new Date(Date.now() + 14 * 86_400_000).toISOString())
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!appointment) return null;

  await db
    .from("crm_appointments")
    .update({
      status: confirms ? "confirmed" : "scheduled",
      confirmation_status: confirms ? "confirmed" : "reschedule_requested",
      updated_at: new Date().toISOString(),
    })
    .eq("id", appointment.id);
  return { appointmentId: String(appointment.id), confirmed: confirms, rescheduleRequested: reschedule };
}

function reminderMessage(appointment: any, kind: "24h" | "5h") {
  const startsAt = new Date(String(appointment.starts_at));
  const dateLabel = startsAt.toLocaleString("pt-BR", {
    timeZone: String(appointment.timezone || "America/Sao_Paulo"),
    dateStyle: "short",
    timeStyle: "short",
  });
  const lead = kind === "24h" ? "Lembrete: seu atendimento é amanhã" : "Seu atendimento começa em aproximadamente 5 horas";
  const meet = appointment.meet_url ? `\nLink do Google Meet: ${appointment.meet_url}` : "";
  return `${lead}, em ${dateLabel}. ${appointment.title}.${meet}\n\nResponda SIM para confirmar ou REMARCAR caso precise alterar o horário.`;
}

async function sendAppointmentReminder(appointment: any, kind: "24h" | "5h") {
  const phone = normalizeWhatsAppPhone(String(appointment.contact_phone || ""));
  if (!phone) return false;
  const db = supabaseAdmin as any;
  const { data: connection } = await db
    .from("whatsapp_connections")
    .select("instance_name,status")
    .eq("tenant_id", appointment.tenant_id)
    .order("last_connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const instanceName = String(connection?.instance_name || process.env["EVOLUTION_INSTANCE"] || "");
  if (!instanceName) return false;
  const text = reminderMessage(appointment, kind);
  const payload = await sendEvolutionTextMessage({ phone, text, delay: 1200, instanceName }).catch(
    () => null,
  );
  if (!payload) return false;
  const now = new Date().toISOString();
  if (appointment.conversation_id) {
    await db.from("whatsapp_messages").insert({
      tenant_id: appointment.tenant_id,
      conversation_id: appointment.conversation_id,
      external_message_id: (payload as any)?.key?.id || (payload as any)?.id || null,
      direction: "outbound",
      message_type: "text",
      body: text,
      status: "sent",
      sent_at: now,
      raw_payload: payload,
    });
  }
  await db
    .from("crm_appointments")
    .update({
      [kind === "24h" ? "reminder_24h_sent_at" : "reminder_5h_sent_at"]: now,
      updated_at: now,
    })
    .eq("id", appointment.id);
  return true;
}

export async function runCrmAutomationMaintenance() {
  const db = supabaseAdmin as any;
  const now = Date.now();
  const from = new Date(now + 4 * 60 * 60 * 1000).toISOString();
  const to = new Date(now + 25 * 60 * 60 * 1000).toISOString();
  const { data: appointments, error } = await db
    .from("crm_appointments")
    .select("*")
    .in("status", ["scheduled", "confirmed"])
    .gte("starts_at", from)
    .lte("starts_at", to)
    .order("starts_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);

  let reminders24h = 0;
  let reminders5h = 0;
  for (const appointment of appointments ?? []) {
    const hours = (new Date(String(appointment.starts_at)).getTime() - now) / 3_600_000;
    if (hours >= 23 && hours <= 25 && !appointment.reminder_24h_sent_at) {
      if (await sendAppointmentReminder(appointment, "24h")) reminders24h += 1;
    }
    if (hours >= 4 && hours <= 6 && !appointment.reminder_5h_sent_at) {
      if (await sendAppointmentReminder(appointment, "5h")) reminders5h += 1;
    }
  }

  const { data: googleAccounts } = await db
    .from("integration_accounts")
    .select("tenant_id,user_id,last_sync_at")
    .eq("provider_key", "google_workspace")
    .eq("status", "connected")
    .limit(250);
  let driveBackups = 0;
  for (const account of googleAccounts ?? []) {
    const lastSync = account.last_sync_at ? new Date(String(account.last_sync_at)).getTime() : 0;
    if (Date.now() - lastSync < 23 * 60 * 60 * 1000) continue;
    try {
      const { backupCrmSnapshotToDrive } = await import("@/lib/google-workspace.server");
      await backupCrmSnapshotToDrive(String(account.tenant_id), String(account.user_id));
      await db
        .from("integration_accounts")
        .update({ last_sync_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() })
        .eq("provider_key", "google_workspace")
        .eq("user_id", account.user_id);
      driveBackups += 1;
    } catch (backupError) {
      await db
        .from("integration_accounts")
        .update({
          last_error: backupError instanceof Error ? backupError.message.slice(0, 300) : "DRIVE_BACKUP_FAILED",
          updated_at: new Date().toISOString(),
        })
        .eq("provider_key", "google_workspace")
        .eq("user_id", account.user_id);
    }
  }

  return { reminders24h, reminders5h, driveBackups, checkedAppointments: appointments?.length ?? 0 };
}
