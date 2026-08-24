import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";

const uuid = z.string().uuid();
const idsSchema = z.array(uuid).min(1).max(200);
const optionalText = (max = 2000) => z.string().trim().max(max).optional().or(z.literal(""));

export type CrmPipeline = {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
};

export type CrmStage = {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
  probability: number;
  status_type: "open" | "won" | "lost";
  color: string;
  is_active: boolean;
};

export type CrmOpportunity = {
  id: string;
  pipeline_id: string;
  stage_id: string;
  owner_user_id: string | null;
  conversation_id: string | null;
  contact_name: string;
  contact_phone: string | null;
  contact_email: string | null;
  property_reference: string | null;
  source: string;
  value: number | null;
  probability: number;
  status: "open" | "won" | "lost";
  loss_reason_id: string | null;
  notes: string | null;
  tags: string[];
  custom_values: Record<string, unknown>;
  expected_close_date: string | null;
  next_action_at: string | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmLossReason = {
  id: string;
  name: string;
  is_active: boolean;
};

export type CrmCustomField = {
  id: string;
  field_key: string;
  label: string;
  field_type: "text" | "number" | "date" | "select" | "boolean";
  options: unknown[];
  is_required: boolean;
  is_active: boolean;
  position: number;
};

export type CrmCadence = {
  id: string;
  pipeline_id: string;
  stage_id: string | null;
  name: string;
  is_active: boolean;
};

export type CrmCadenceStep = {
  id: string;
  cadence_id: string;
  position: number;
  delay_minutes: number;
  action_type: "task" | "call" | "whatsapp" | "email";
  title: string;
  message_template: string | null;
  is_active: boolean;
};

export type CrmAutomation = {
  id: string;
  pipeline_id: string;
  stage_id: string | null;
  name: string;
  trigger_event: "created" | "stage_entered";
  action_type: "create_task" | "schedule_followup" | "set_probability";
  action_config: Record<string, unknown>;
  is_active: boolean;
};

export type CrmActivity = {
  id: string;
  opportunity_id: string;
  kind: "task" | "call" | "whatsapp" | "email" | "note" | "system";
  title: string;
  description: string | null;
  due_at: string | null;
  status: "pending" | "done" | "canceled";
  source: "manual" | "cadence" | "automation" | "system";
  created_at: string;
};

export type CrmWorkspace = {
  pipelines: CrmPipeline[];
  stages: CrmStage[];
  opportunities: CrmOpportunity[];
  lossReasons: CrmLossReason[];
  customFields: CrmCustomField[];
  cadences: CrmCadence[];
  cadenceSteps: CrmCadenceStep[];
  automations: CrmAutomation[];
  activities: CrmActivity[];
};

async function tenant(context: { supabase: any; userId: string }) {
  return requireTenantId(context.supabase, context.userId);
}

async function assertPipeline(db: any, tenantId: string, pipelineId: string) {
  const { data, error } = await db
    .from("crm_pipelines")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", pipelineId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Funil não encontrado.");
}

async function assertStage(db: any, tenantId: string, pipelineId: string, stageId: string) {
  const { data, error } = await db
    .from("crm_stages")
    .select("id,status_type")
    .eq("tenant_id", tenantId)
    .eq("pipeline_id", pipelineId)
    .eq("id", stageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Etapa não encontrada neste funil.");
  return data as { id: string; status_type: "open" | "won" | "lost" };
}

export const getCrmWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CrmWorkspace> => {
    const tenantId = await tenant(context);
    const db = context.supabase as any;

    await db.rpc("crm_ensure_default_pipeline", {
      p_tenant_id: tenantId,
      p_user_id: context.userId,
    });

    const [
      pipelines,
      stages,
      opportunities,
      lossReasons,
      customFields,
      cadences,
      cadenceSteps,
      automations,
      activities,
    ] = await Promise.all([
      db
        .from("crm_pipelines")
        .select("id,name,description,is_default,is_active,created_at")
        .eq("tenant_id", tenantId)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true }),
      db
        .from("crm_stages")
        .select("id,pipeline_id,name,position,probability,status_type,color,is_active")
        .eq("tenant_id", tenantId)
        .order("position", { ascending: true }),
      db
        .from("crm_opportunities")
        .select(
          "id,pipeline_id,stage_id,owner_user_id,conversation_id,contact_name,contact_phone,contact_email,property_reference,source,value,probability,status,loss_reason_id,notes,tags,custom_values,expected_close_date,next_action_at,last_activity_at,created_at,updated_at",
        )
        .eq("tenant_id", tenantId)
        .order("updated_at", { ascending: false })
        .limit(1500),
      db
        .from("crm_loss_reasons")
        .select("id,name,is_active")
        .eq("tenant_id", tenantId)
        .order("name", { ascending: true }),
      db
        .from("crm_custom_fields")
        .select("id,field_key,label,field_type,options,is_required,is_active,position")
        .eq("tenant_id", tenantId)
        .order("position", { ascending: true }),
      db
        .from("crm_cadences")
        .select("id,pipeline_id,stage_id,name,is_active")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true }),
      db
        .from("crm_cadence_steps")
        .select("id,cadence_id,position,delay_minutes,action_type,title,message_template,is_active")
        .eq("tenant_id", tenantId)
        .order("position", { ascending: true }),
      db
        .from("crm_automations")
        .select("id,pipeline_id,stage_id,name,trigger_event,action_type,action_config,is_active")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true }),
      db
        .from("crm_activities")
        .select("id,opportunity_id,kind,title,description,due_at,status,source,created_at")
        .eq("tenant_id", tenantId)
        .eq("status", "pending")
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(1000),
    ]);

    const results = [
      pipelines,
      stages,
      opportunities,
      lossReasons,
      customFields,
      cadences,
      cadenceSteps,
      automations,
      activities,
    ];
    const failure = results.find((result) => result.error);
    if (failure?.error) throw new Error(failure.error.message);

    return {
      pipelines: (pipelines.data ?? []) as CrmPipeline[],
      stages: (stages.data ?? []) as CrmStage[],
      opportunities: (opportunities.data ?? []) as CrmOpportunity[],
      lossReasons: (lossReasons.data ?? []) as CrmLossReason[],
      customFields: (customFields.data ?? []) as CrmCustomField[],
      cadences: (cadences.data ?? []) as CrmCadence[],
      cadenceSteps: (cadenceSteps.data ?? []) as CrmCadenceStep[],
      automations: (automations.data ?? []) as CrmAutomation[],
      activities: (activities.data ?? []) as CrmActivity[],
    };
  });

const opportunitySchema = z.object({
  pipelineId: uuid,
  stageId: uuid,
  contactName: z.string().trim().min(2).max(160),
  contactPhone: optionalText(40),
  contactEmail: z.string().trim().email().optional().or(z.literal("")),
  propertyReference: optionalText(300),
  source: z.string().trim().min(1).max(80).default("manual"),
  value: z.number().nonnegative().nullable().optional(),
  expectedCloseDate: optionalText(20),
  nextActionAt: optionalText(40),
  notes: optionalText(5000),
  customValues: z.record(z.string(), z.unknown()).default({}),
});

export const createCrmOpportunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => opportunitySchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const db = context.supabase as any;
    await assertPipeline(db, tenantId, data.pipelineId);
    await assertStage(db, tenantId, data.pipelineId, data.stageId);
    const { data: inserted, error } = await db
      .from("crm_opportunities")
      .insert({
        tenant_id: tenantId,
        pipeline_id: data.pipelineId,
        stage_id: data.stageId,
        owner_user_id: context.userId,
        contact_name: data.contactName,
        contact_phone: data.contactPhone || null,
        contact_email: data.contactEmail || null,
        property_reference: data.propertyReference || null,
        source: data.source,
        value: data.value ?? null,
        expected_close_date: data.expectedCloseDate || null,
        next_action_at: data.nextActionAt || null,
        notes: data.notes || null,
        custom_values: data.customValues,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { success: true, id: inserted.id as string };
  });

export const updateCrmOpportunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => opportunitySchema.extend({ id: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const db = context.supabase as any;
    await assertPipeline(db, tenantId, data.pipelineId);
    await assertStage(db, tenantId, data.pipelineId, data.stageId);
    const { error } = await db
      .from("crm_opportunities")
      .update({
        pipeline_id: data.pipelineId,
        stage_id: data.stageId,
        contact_name: data.contactName,
        contact_phone: data.contactPhone || null,
        contact_email: data.contactEmail || null,
        property_reference: data.propertyReference || null,
        source: data.source,
        value: data.value ?? null,
        expected_close_date: data.expectedCloseDate || null,
        next_action_at: data.nextActionAt || null,
        notes: data.notes || null,
        custom_values: data.customValues,
      })
      .eq("tenant_id", tenantId)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const bulkMoveCrmOpportunities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ ids: idsSchema, pipelineId: uuid, stageId: uuid }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const db = context.supabase as any;
    await assertStage(db, tenantId, data.pipelineId, data.stageId);
    const { error } = await db
      .from("crm_opportunities")
      .update({ pipeline_id: data.pipelineId, stage_id: data.stageId })
      .eq("tenant_id", tenantId)
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    return { success: true, affected: data.ids.length };
  });

export const bulkLoseCrmOpportunities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({ ids: idsSchema, pipelineId: uuid, lostStageId: uuid, lossReasonId: uuid })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const db = context.supabase as any;
    const stage = await assertStage(db, tenantId, data.pipelineId, data.lostStageId);
    if (stage.status_type !== "lost")
      throw new Error("Selecione uma etapa configurada como perdida.");
    const { data: reason, error: reasonError } = await db
      .from("crm_loss_reasons")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", data.lossReasonId)
      .eq("is_active", true)
      .maybeSingle();
    if (reasonError) throw new Error(reasonError.message);
    if (!reason) throw new Error("Motivo de perda inválido.");
    const { error } = await db
      .from("crm_opportunities")
      .update({
        pipeline_id: data.pipelineId,
        stage_id: data.lostStageId,
        loss_reason_id: data.lossReasonId,
      })
      .eq("tenant_id", tenantId)
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    return { success: true, affected: data.ids.length };
  });

export const bulkDeleteCrmOpportunities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ ids: idsSchema }).parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const { error } = await (context.supabase as any)
      .from("crm_opportunities")
      .delete()
      .eq("tenant_id", tenantId)
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    return { success: true, affected: data.ids.length };
  });

export const createCrmPipeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({ name: z.string().trim().min(2).max(100), description: optionalText(500) })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const db = context.supabase as any;
    const { data: pipeline, error } = await db
      .from("crm_pipelines")
      .insert({
        tenant_id: tenantId,
        name: data.name,
        description: data.description || null,
        is_default: false,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const starter = [
      { name: "Novo lead", position: 10, probability: 10, status_type: "open", color: "#2563eb" },
      { name: "Negociação", position: 20, probability: 70, status_type: "open", color: "#f97316" },
      { name: "Ganho", position: 30, probability: 100, status_type: "won", color: "#16a34a" },
      { name: "Perdido", position: 40, probability: 0, status_type: "lost", color: "#dc2626" },
    ].map((stage) => ({ ...stage, tenant_id: tenantId, pipeline_id: pipeline.id }));
    const seeded = await db.from("crm_stages").insert(starter);
    if (seeded.error) throw new Error(seeded.error.message);
    return { success: true, id: pipeline.id as string };
  });

export const createCrmStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        pipelineId: uuid,
        name: z.string().trim().min(2).max(100),
        probability: z.number().int().min(0).max(100),
        statusType: z.enum(["open", "won", "lost"]),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const db = context.supabase as any;
    await assertPipeline(db, tenantId, data.pipelineId);
    const { data: tail, error: tailError } = await db
      .from("crm_stages")
      .select("position")
      .eq("tenant_id", tenantId)
      .eq("pipeline_id", data.pipelineId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (tailError) throw new Error(tailError.message);
    const { error } = await db.from("crm_stages").insert({
      tenant_id: tenantId,
      pipeline_id: data.pipelineId,
      name: data.name,
      position: Number(tail?.position ?? 0) + 10,
      probability: data.probability,
      status_type: data.statusType,
      color: data.color,
    });
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const updateCrmStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        id: uuid,
        name: z.string().trim().min(2).max(100),
        probability: z.number().int().min(0).max(100),
        statusType: z.enum(["open", "won", "lost"]),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        isActive: z.boolean(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const { error } = await (context.supabase as any)
      .from("crm_stages")
      .update({
        name: data.name,
        probability: data.probability,
        status_type: data.statusType,
        color: data.color,
        is_active: data.isActive,
      })
      .eq("tenant_id", tenantId)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const createCrmLossReason = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ name: z.string().trim().min(2).max(120) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const { error } = await (context.supabase as any)
      .from("crm_loss_reasons")
      .insert({ tenant_id: tenantId, name: data.name });
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const toggleCrmLossReason = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: uuid, isActive: z.boolean() }).parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const { error } = await (context.supabase as any)
      .from("crm_loss_reasons")
      .update({ is_active: data.isActive })
      .eq("tenant_id", tenantId)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const createCrmCustomField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        key: z
          .string()
          .trim()
          .regex(/^[a-z0-9_]{2,50}$/),
        label: z.string().trim().min(2).max(100),
        fieldType: z.enum(["text", "number", "date", "select", "boolean"]),
        options: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
        isRequired: z.boolean().default(false),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const db = context.supabase as any;
    const { data: tail } = await db
      .from("crm_custom_fields")
      .select("position")
      .eq("tenant_id", tenantId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await db.from("crm_custom_fields").insert({
      tenant_id: tenantId,
      field_key: data.key,
      label: data.label,
      field_type: data.fieldType,
      options: data.options,
      is_required: data.isRequired,
      position: Number(tail?.position ?? 0) + 10,
    });
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const createCrmCadence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        pipelineId: uuid,
        stageId: uuid.nullable().optional(),
        name: z.string().trim().min(2).max(120),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const db = context.supabase as any;
    await assertPipeline(db, tenantId, data.pipelineId);
    if (data.stageId) await assertStage(db, tenantId, data.pipelineId, data.stageId);
    const { data: cadence, error } = await db
      .from("crm_cadences")
      .insert({
        tenant_id: tenantId,
        pipeline_id: data.pipelineId,
        stage_id: data.stageId ?? null,
        name: data.name,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { success: true, id: cadence.id as string };
  });

export const addCrmCadenceStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        cadenceId: uuid,
        delayMinutes: z.number().int().min(0).max(525600),
        actionType: z.enum(["task", "call", "whatsapp", "email"]),
        title: z.string().trim().min(2).max(160),
        messageTemplate: optionalText(3000),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const db = context.supabase as any;
    const { data: cadence, error: cadenceError } = await db
      .from("crm_cadences")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", data.cadenceId)
      .maybeSingle();
    if (cadenceError) throw new Error(cadenceError.message);
    if (!cadence) throw new Error("Cadência não encontrada.");
    const { data: tail } = await db
      .from("crm_cadence_steps")
      .select("position")
      .eq("cadence_id", data.cadenceId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await db.from("crm_cadence_steps").insert({
      tenant_id: tenantId,
      cadence_id: data.cadenceId,
      position: Number(tail?.position ?? 0) + 10,
      delay_minutes: data.delayMinutes,
      action_type: data.actionType,
      title: data.title,
      message_template: data.messageTemplate || null,
    });
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const toggleCrmCadence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: uuid, isActive: z.boolean() }).parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const { error } = await (context.supabase as any)
      .from("crm_cadences")
      .update({ is_active: data.isActive })
      .eq("tenant_id", tenantId)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const createCrmAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        pipelineId: uuid,
        stageId: uuid.nullable().optional(),
        name: z.string().trim().min(2).max(120),
        triggerEvent: z.enum(["created", "stage_entered"]),
        actionType: z.enum(["create_task", "schedule_followup", "set_probability"]),
        delayMinutes: z.number().int().min(0).max(525600).default(0),
        title: optionalText(160),
        value: z.number().int().min(0).max(100).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const db = context.supabase as any;
    await assertPipeline(db, tenantId, data.pipelineId);
    if (data.stageId) await assertStage(db, tenantId, data.pipelineId, data.stageId);
    const actionConfig = {
      delay_minutes: data.delayMinutes,
      ...(data.title ? { title: data.title } : {}),
      ...(typeof data.value === "number" ? { value: data.value } : {}),
    };
    const { error } = await db.from("crm_automations").insert({
      tenant_id: tenantId,
      pipeline_id: data.pipelineId,
      stage_id: data.stageId ?? null,
      name: data.name,
      trigger_event: data.triggerEvent,
      action_type: data.actionType,
      action_config: actionConfig,
    });
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const toggleCrmAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: uuid, isActive: z.boolean() }).parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const { error } = await (context.supabase as any)
      .from("crm_automations")
      .update({ is_active: data.isActive })
      .eq("tenant_id", tenantId)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const completeCrmActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const { error } = await (context.supabase as any)
      .from("crm_activities")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { success: true };
  });

const importRowSchema = z.object({
  contactName: z.string().trim().min(2).max(160),
  contactPhone: optionalText(40),
  contactEmail: z.string().trim().email().optional().or(z.literal("")),
  propertyReference: optionalText(300),
  source: z.string().trim().max(80).optional(),
  value: z.number().nonnegative().nullable().optional(),
  notes: optionalText(3000),
});

export const importCrmOpportunities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({ pipelineId: uuid, stageId: uuid, rows: z.array(importRowSchema).min(1).max(500) })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const db = context.supabase as any;
    await assertStage(db, tenantId, data.pipelineId, data.stageId);
    const payload = data.rows.map((row) => ({
      tenant_id: tenantId,
      pipeline_id: data.pipelineId,
      stage_id: data.stageId,
      owner_user_id: context.userId,
      contact_name: row.contactName,
      contact_phone: row.contactPhone || null,
      contact_email: row.contactEmail || null,
      property_reference: row.propertyReference || null,
      source: row.source || "importacao",
      value: row.value ?? null,
      notes: row.notes || null,
    }));
    const { error } = await db.from("crm_opportunities").insert(payload);
    if (error) throw new Error(error.message);
    return { success: true, imported: payload.length };
  });
