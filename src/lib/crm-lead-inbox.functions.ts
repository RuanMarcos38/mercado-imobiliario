import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";

const uuid = z.string().uuid();
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();

export type CrmLeadInboxStatus = "new" | "qualifying" | "qualified" | "discarded" | "converted";
export type CrmLeadTemperature = "cold" | "warm" | "hot";

export interface CrmLeadInboxItem {
  id: string;
  owner_user_id: string | null;
  conversation_id: string | null;
  avatar_url: string | null;
  protocol_code: string | null;
  contact_name: string;
  contact_phone: string | null;
  contact_email: string | null;
  source: string;
  last_message: string | null;
  last_activity_at: string | null;
  score: number;
  temperature: CrmLeadTemperature;
  status: CrmLeadInboxStatus;
  city: string | null;
  neighborhood: string | null;
  property_type: string | null;
  interest: string | null;
  income: number | null;
  down_payment: number | null;
  has_fgts: boolean | null;
  credit_status: string | null;
  notes: string | null;
  converted_opportunity_id: string | null;
  created_at: string;
  updated_at: string;
}

const qualificationSchema = z.object({
  id: uuid,
  contactName: z.string().trim().min(2).max(160),
  contactEmail: z.string().trim().email().nullable().optional().or(z.literal("")),
  city: nullableText(120),
  neighborhood: nullableText(120),
  propertyType: nullableText(120),
  interest: nullableText(500),
  income: z.number().nonnegative().nullable().optional(),
  downPayment: z.number().nonnegative().nullable().optional(),
  hasFgts: z.boolean().nullable().optional(),
  creditStatus: nullableText(120),
  notes: nullableText(4000),
});

// Score objetivo: prioriza dados que ajudam o corretor a decidir a próxima ação.
function scoreLead(input: {
  contactName: string;
  contactPhone: string | null;
  lastMessage: string | null;
  city: string | null;
  propertyType: string | null;
  interest: string | null;
  income: number | null;
  downPayment: number | null;
  hasFgts: boolean | null;
  creditStatus: string | null;
}) {
  let score = 0;
  const nameDigits = input.contactName.replace(/\D/g, "");
  const phoneDigits = String(input.contactPhone ?? "").replace(/\D/g, "");
  if (input.contactName.trim().length >= 2 && nameDigits !== phoneDigits) score += 10;
  if (phoneDigits.length >= 10) score += 10;
  if ((input.lastMessage ?? "").trim().length >= 3) score += 10;
  if (input.city?.trim()) score += 10;
  if (input.propertyType?.trim()) score += 10;
  if (input.interest?.trim()) score += 10;
  if ((input.income ?? 0) > 0) score += 15;
  if ((input.downPayment ?? 0) > 0) score += 10;
  if (typeof input.hasFgts === "boolean") score += 5;
  if (input.creditStatus?.trim()) score += 10;
  return Math.min(100, score);
}

function temperature(score: number): CrmLeadTemperature {
  if (score >= 70) return "hot";
  if (score >= 45) return "warm";
  return "cold";
}

function qualificationReady(input: {
  city: string | null;
  propertyType: string | null;
  interest: string | null;
  income: number | null;
  downPayment: number | null;
}) {
  return Boolean(
    input.city?.trim() &&
    input.propertyType?.trim() &&
    input.interest?.trim() &&
    ((input.income ?? 0) > 0 || (input.downPayment ?? 0) > 0),
  );
}

async function tenant(context: { supabase: any; userId: string }) {
  return requireTenantId(context.supabase, context.userId);
}

async function leadById(db: any, tenantId: string, id: string) {
  const result = await db
    .from("crm_lead_inbox")
    .select(
      "id,owner_user_id,conversation_id,protocol_code,contact_name,contact_phone,contact_email,source,last_message,last_activity_at,score,temperature,status,city,neighborhood,property_type,interest,income,down_payment,has_fgts,credit_status,notes,converted_opportunity_id,created_at,updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("Lead não encontrado.");
  return result.data as any;
}

function mapLead(
  row: any,
  avatarByConversation: Map<string, string | null> = new Map(),
): CrmLeadInboxItem {
  return {
    ...row,
    avatar_url: row.conversation_id
      ? avatarByConversation.get(String(row.conversation_id)) ?? null
      : null,
    score: Number(row.score ?? 0),
    income: row.income == null ? null : Number(row.income),
    down_payment: row.down_payment == null ? null : Number(row.down_payment),
  } as CrmLeadInboxItem;
}

export const listCrmLeadInbox = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CrmLeadInboxItem[]> => {
    const tenantId = await tenant(context);
    const db = context.supabase as any;
    const result = await db
      .from("crm_lead_inbox")
      .select(
        "id,owner_user_id,conversation_id,protocol_code,contact_name,contact_phone,contact_email,source,last_message,last_activity_at,score,temperature,status,city,neighborhood,property_type,interest,income,down_payment,has_fgts,credit_status,notes,converted_opportunity_id,created_at,updated_at",
      )
      .eq("tenant_id", tenantId)
      .order("score", { ascending: false })
      .order("last_activity_at", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (result.error) throw new Error(result.error.message);

    const rows = result.data ?? [];
    const conversationIds = [
      ...new Set(
        rows
          .map((row: any) => row.conversation_id)
          .filter((value: unknown): value is string => typeof value === "string" && Boolean(value)),
      ),
    ];
    const avatarByConversation = new Map<string, string | null>();

    if (conversationIds.length) {
      const avatars = await db
        .from("whatsapp_conversations")
        .select("id,avatar_url")
        .eq("tenant_id", tenantId)
        .in("id", conversationIds);
      if (avatars.error) throw new Error(avatars.error.message);
      for (const row of avatars.data ?? []) {
        avatarByConversation.set(String(row.id), row.avatar_url ? String(row.avatar_url) : null);
      }
    }

    return rows.map((row: any) => mapLead(row, avatarByConversation));
  });

export const updateCrmLeadQualification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => qualificationSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const db = context.supabase as any;
    const current = await leadById(db, tenantId, data.id);
    if (current.status === "converted") throw new Error("Este lead já foi convertido.");

    const payload = {
      contact_name: data.contactName,
      contact_email: data.contactEmail || null,
      city: data.city || null,
      neighborhood: data.neighborhood || null,
      property_type: data.propertyType || null,
      interest: data.interest || null,
      income: data.income ?? null,
      down_payment: data.downPayment ?? null,
      has_fgts: data.hasFgts ?? null,
      credit_status: data.creditStatus || null,
      notes: data.notes || null,
    };
    const score = scoreLead({
      contactName: payload.contact_name,
      contactPhone: current.contact_phone,
      lastMessage: current.last_message,
      city: payload.city,
      propertyType: payload.property_type,
      interest: payload.interest,
      income: payload.income,
      downPayment: payload.down_payment,
      hasFgts: payload.has_fgts,
      creditStatus: payload.credit_status,
    });
    const ready = qualificationReady({
      city: payload.city,
      propertyType: payload.property_type,
      interest: payload.interest,
      income: payload.income,
      downPayment: payload.down_payment,
    });
    const status: CrmLeadInboxStatus =
      current.status === "discarded" ? "discarded" : ready ? "qualified" : "qualifying";

    const result = await db
      .from("crm_lead_inbox")
      .update({
        ...payload,
        score,
        temperature: temperature(score),
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", data.id);
    if (result.error) throw new Error(result.error.message);

    return { success: true, score, temperature: temperature(score), status, ready };
  });

export const discardCrmLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const result = await (context.supabase as any)
      .from("crm_lead_inbox")
      .update({ status: "discarded", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", data.id)
      .neq("status", "converted");
    if (result.error) throw new Error(result.error.message);
    return { success: true };
  });

export const restoreCrmLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const result = await (context.supabase as any)
      .from("crm_lead_inbox")
      .update({ status: "new", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", data.id)
      .eq("status", "discarded");
    if (result.error) throw new Error(result.error.message);
    return { success: true };
  });

export const convertCrmLeadToOpportunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const db = context.supabase as any;
    const lead = await leadById(db, tenantId, data.id);

    if (lead.status === "converted" && lead.converted_opportunity_id) {
      return { success: true, opportunityId: String(lead.converted_opportunity_id) };
    }
    if (lead.status === "discarded") throw new Error("Restaure o lead antes de converter.");

    const ready = qualificationReady({
      city: lead.city,
      propertyType: lead.property_type,
      interest: lead.interest,
      income: lead.income == null ? null : Number(lead.income),
      downPayment: lead.down_payment == null ? null : Number(lead.down_payment),
    });
    if (!ready) {
      throw new Error(
        "Complete cidade, tipo de imóvel, interesse e renda ou entrada antes de converter.",
      );
    }

    if (lead.conversation_id) {
      const existing = await db
        .from("crm_opportunities")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("conversation_id", lead.conversation_id)
        .maybeSingle();
      if (existing.error) throw new Error(existing.error.message);
      if (existing.data?.id) {
        await db
          .from("crm_lead_inbox")
          .update({
            status: "converted",
            converted_opportunity_id: existing.data.id,
            updated_at: new Date().toISOString(),
          })
          .eq("tenant_id", tenantId)
          .eq("id", data.id);
        return { success: true, opportunityId: String(existing.data.id) };
      }
    }

    const ensured = await db.rpc("crm_ensure_default_pipeline", {
      p_tenant_id: tenantId,
      p_user_id: lead.owner_user_id || context.userId,
    });
    if (ensured.error) throw new Error(ensured.error.message);
    const routing = Array.isArray(ensured.data) ? ensured.data[0] : ensured.data;
    const pipelineId = routing?.pipeline_id;
    const stageId = routing?.initial_stage_id;
    if (!pipelineId || !stageId) throw new Error("Funil padrão não está disponível.");

    let contactId: string | null = null;
    const phone = String(lead.contact_phone ?? "").trim();
    if (phone) {
      const existingContact = await db
        .from("crm_contacts")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("phone_e164", phone)
        .maybeSingle();
      if (existingContact.error) throw new Error(existingContact.error.message);
      contactId = existingContact.data?.id ?? null;
    }

    const contactPayload = {
      tenant_id: tenantId,
      phone_e164: phone || null,
      name: lead.contact_name,
      email: lead.contact_email || null,
      city: lead.city || null,
      neighborhood: lead.neighborhood || null,
      property_type: lead.property_type || null,
      interest: lead.interest || null,
      income: lead.income ?? null,
      down_payment: lead.down_payment ?? null,
      has_fgts: lead.has_fgts ?? null,
      credit_status: lead.credit_status || null,
      notes: lead.notes || null,
      source: lead.conversation_id ? "whatsapp+crm" : lead.source || "crm",
      last_whatsapp_at: lead.last_activity_at || null,
      updated_at: new Date().toISOString(),
    };

    if (contactId) {
      const updated = await db
        .from("crm_contacts")
        .update(contactPayload)
        .eq("tenant_id", tenantId)
        .eq("id", contactId);
      if (updated.error) throw new Error(updated.error.message);
    } else {
      const insertedContact = await db
        .from("crm_contacts")
        .insert(contactPayload)
        .select("id")
        .single();
      if (insertedContact.error) throw new Error(insertedContact.error.message);
      contactId = insertedContact.data.id;
    }

    const inserted = await db
      .from("crm_opportunities")
      .insert({
        tenant_id: tenantId,
        pipeline_id: pipelineId,
        stage_id: stageId,
        owner_user_id: lead.owner_user_id || context.userId,
        conversation_id: lead.conversation_id || null,
        contact_id: contactId,
        protocol_code: lead.protocol_code || null,
        contact_name: lead.contact_name,
        contact_phone: lead.contact_phone || null,
        contact_email: lead.contact_email || null,
        property_reference: lead.interest || null,
        source: lead.source || "whatsapp",
        notes: lead.notes || lead.last_message || null,
        custom_values: {
          lead_score: Number(lead.score ?? 0),
          lead_temperature: lead.temperature,
          city: lead.city,
          neighborhood: lead.neighborhood,
          property_type: lead.property_type,
          income: lead.income,
          down_payment: lead.down_payment,
          has_fgts: lead.has_fgts,
          credit_status: lead.credit_status,
        },
      })
      .select("id")
      .single();
    if (inserted.error) throw new Error(inserted.error.message);

    const marked = await db
      .from("crm_lead_inbox")
      .update({
        status: "converted",
        converted_opportunity_id: inserted.data.id,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", data.id);
    if (marked.error) throw new Error(marked.error.message);

    return { success: true, opportunityId: String(inserted.data.id) };
  });
