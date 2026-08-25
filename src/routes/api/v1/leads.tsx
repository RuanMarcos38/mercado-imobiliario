import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { apiJson, authenticateApiRequest } from "@/lib/api-auth.server";

async function handleGet(request: Request) {
  const principal = await authenticateApiRequest(request);
  if (!principal) return apiJson({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const status = (url.searchParams.get("status") || "").trim();
  let query = (supabaseAdmin as any)
    .from("crm_opportunities")
    .select(
      "id,protocol_code,contact_name,contact_phone,contact_email,property_reference,source,value,probability,status,notes,next_action_at,stage_entered_at,created_at,updated_at",
    )
    .eq("tenant_id", principal.tenantId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
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
  const contactName = String(payload?.contactName || payload?.name || "")
    .trim()
    .slice(0, 160);
  if (contactName.length < 2) return apiJson({ error: "contact_name_required" }, 422);
  const db = supabaseAdmin as any;
  const { data: pipeline } = await db
    .from("crm_pipelines")
    .select("id")
    .eq("tenant_id", principal.tenantId)
    .eq("is_active", true)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!pipeline) return apiJson({ error: "crm_pipeline_not_configured" }, 422);
  const { data: stage } = await db
    .from("crm_stages")
    .select("id,probability")
    .eq("tenant_id", principal.tenantId)
    .eq("pipeline_id", pipeline.id)
    .eq("is_active", true)
    .eq("status_type", "open")
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!stage) return apiJson({ error: "crm_stage_not_configured" }, 422);
  const { data: created, error } = await db
    .from("crm_opportunities")
    .insert({
      tenant_id: principal.tenantId,
      pipeline_id: pipeline.id,
      stage_id: stage.id,
      owner_user_id: principal.userId,
      contact_name: contactName,
      contact_phone: payload?.contactPhone ? String(payload.contactPhone).slice(0, 40) : null,
      contact_email: payload?.contactEmail ? String(payload.contactEmail).slice(0, 220) : null,
      property_reference: payload?.propertyReference
        ? String(payload.propertyReference).slice(0, 240)
        : null,
      source: payload?.source ? String(payload.source).slice(0, 80) : "open_api",
      value: Number.isFinite(Number(payload?.value)) ? Number(payload.value) : null,
      probability: Number(stage.probability || 0),
      status: "open",
      notes: payload?.notes ? String(payload.notes).slice(0, 5000) : null,
      next_action_at: payload?.nextActionAt ? String(payload.nextActionAt) : null,
      custom_values:
        payload?.customValues && typeof payload.customValues === "object"
          ? payload.customValues
          : {},
    })
    .select("*")
    .single();
  if (error) return apiJson({ error: "create_failed", message: error.message }, 500);
  return apiJson({ data: created }, 201);
}

export const Route = createFileRoute("/api/v1/leads")({
  server: {
    handlers: {
      GET: ({ request }) => handleGet(request),
      POST: ({ request }) => handlePost(request),
    },
  },
});
