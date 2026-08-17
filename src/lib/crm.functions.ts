import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";

export const CRM_STAGES = [
  "novo",
  "contato",
  "qualificado",
  "visita",
  "proposta",
  "documentos",
  "analise_caixa",
  "aprovado",
  "fechado",
  "perdido",
] as const;

export type CrmStage = (typeof CRM_STAGES)[number];

export const CRM_STAGE_LABELS: Record<CrmStage, string> = {
  novo: "Novo lead",
  contato: "Em contato",
  qualificado: "Qualificado",
  visita: "Visita",
  proposta: "Proposta",
  documentos: "Documentos",
  analise_caixa: "Análise CAIXA",
  aprovado: "Aprovado",
  fechado: "Venda fechada",
  perdido: "Perdido",
};

export interface CrmLead {
  id: string;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  status: string | null;
  ai_qualification_notes: string | null;
  interest_property_id: string | null;
  created_at: string | null;
  user_id: string;
  tenant_id: string | null;
}

const createLeadSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional(),
  propertyReference: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(4000).optional(),
  stage: z.enum(CRM_STAGES).default("novo"),
});

const updateStageSchema = z.object({ leadId: z.string().uuid(), stage: z.enum(CRM_STAGES) });
const leadIdSchema = z.object({ leadId: z.string().uuid() });

function buildNotes(propertyReference?: string, notes?: string) {
  return [
    propertyReference?.trim() ? `Imóvel/oportunidade: ${propertyReference.trim()}` : "",
    notes?.trim() ? `Observações: ${notes.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const listCrmLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CrmLead[]> => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { data, error } = await db
      .from("leads")
      .select(
        "id,client_name,client_email,client_phone,status,ai_qualification_notes,interest_property_id,created_at,user_id,tenant_id",
      )
      .eq("tenant_id", tenantId)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as CrmLead[];
  });

export const createCrmLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createLeadSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { data: inserted, error } = await db
      .from("leads")
      .insert({
        tenant_id: tenantId,
        user_id: context.userId,
        client_name: data.name,
        client_email: data.email || null,
        client_phone: data.phone || null,
        status: data.stage,
        ai_qualification_notes: buildNotes(data.propertyReference, data.notes) || null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { success: true, leadId: inserted.id as string };
  });

export const updateCrmLeadStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateStageSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { error } = await db
      .from("leads")
      .update({ status: data.stage })
      .eq("id", data.leadId)
      .eq("tenant_id", tenantId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const deleteCrmLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => leadIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { error } = await db
      .from("leads")
      .delete()
      .eq("id", data.leadId)
      .eq("tenant_id", tenantId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });
