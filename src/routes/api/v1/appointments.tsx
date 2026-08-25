import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { apiJson, authenticateApiRequest } from "@/lib/api-auth.server";

async function handleGet(request: Request) {
  const principal = await authenticateApiRequest(request);
  if (!principal) return apiJson({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const { data, error } = await (supabaseAdmin as any)
    .from("crm_appointments")
    .select("*")
    .eq("tenant_id", principal.tenantId)
    .eq("owner_user_id", principal.userId)
    .order("starts_at", { ascending: true })
    .limit(limit);
  if (error) return apiJson({ error: "query_failed", message: error.message }, 500);
  return apiJson({ data: data ?? [], count: data?.length ?? 0 });
}

async function handlePost(request: Request) {
  const principal = await authenticateApiRequest(request);
  if (!principal) return apiJson({ error: "unauthorized" }, 401);
  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return apiJson({ error: "invalid_json" }, 400);
  }
  const title = String(payload?.title || "Atendimento imobiliário").trim().slice(0, 200);
  const contactName = String(payload?.contactName || "").trim().slice(0, 160);
  const startsAt = new Date(String(payload?.startsAt || ""));
  const endsAt = new Date(String(payload?.endsAt || ""));
  if (contactName.length < 2 || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
    return apiJson({ error: "contact_name_starts_at_ends_at_required" }, 422);
  }
  if (endsAt.getTime() <= startsAt.getTime()) return apiJson({ error: "invalid_time_range" }, 422);
  const db = supabaseAdmin as any;
  let conversationId: string | null = null;
  let opportunityId: string | null = null;
  if (payload?.opportunityId) {
    const { data: opportunity } = await db
      .from("crm_opportunities")
      .select("id,conversation_id")
      .eq("tenant_id", principal.tenantId)
      .eq("id", String(payload.opportunityId))
      .maybeSingle();
    if (opportunity) {
      opportunityId = String(opportunity.id);
      conversationId = opportunity.conversation_id ? String(opportunity.conversation_id) : null;
    }
  }
  const meetingType = ["meet", "phone", "in_person", "other"].includes(String(payload?.meetingType))
    ? String(payload.meetingType)
    : "meet";
  const { data: created, error } = await db
    .from("crm_appointments")
    .insert({
      tenant_id: principal.tenantId,
      opportunity_id: opportunityId,
      conversation_id: conversationId,
      owner_user_id: principal.userId,
      contact_name: contactName,
      contact_phone: payload?.contactPhone ? String(payload.contactPhone).slice(0, 40) : null,
      contact_email: payload?.contactEmail ? String(payload.contactEmail).slice(0, 220) : null,
      title,
      notes: payload?.notes ? String(payload.notes).slice(0, 3000) : null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      timezone: String(payload?.timezone || "America/Sao_Paulo").slice(0, 80),
      meeting_type: meetingType,
      location: payload?.location ? String(payload.location).slice(0, 300) : null,
      created_by: principal.userId,
    })
    .select("*")
    .single();
  if (error) return apiJson({ error: "create_failed", message: error.message }, 500);

  if (meetingType === "meet") {
    try {
      const { createGoogleCalendarMeeting } = await import("@/lib/google-workspace.server");
      const google = await createGoogleCalendarMeeting({
        tenantId: principal.tenantId,
        userId: principal.userId,
        title,
        description: payload?.notes ? String(payload.notes) : null,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        timezone: String(payload?.timezone || "America/Sao_Paulo"),
        attendeeEmail: payload?.contactEmail ? String(payload.contactEmail) : null,
      });
      const { data: updated } = await db
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
      return apiJson({ data: updated || created, googleSynced: true }, 201);
    } catch (googleError) {
      return apiJson(
        {
          data: created,
          googleSynced: false,
          warning: googleError instanceof Error ? googleError.message : "GOOGLE_SYNC_FAILED",
        },
        201,
      );
    }
  }

  return apiJson({ data: created, googleSynced: false }, 201);
}

export const Route = createFileRoute("/api/v1/appointments")({
  server: {
    handlers: {
      GET: ({ request }) => handleGet(request),
      POST: ({ request }) => handlePost(request),
    },
  },
});
