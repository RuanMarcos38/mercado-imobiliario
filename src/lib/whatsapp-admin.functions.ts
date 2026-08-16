import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";

const flowSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  triggerType: z.enum(["manual", "new_conversation", "keyword", "new_property_alert", "webhook"]),
  triggerValue: z.string().trim().max(200).optional(),
  enabled: z.boolean().default(false),
});

const flowStepSchema = z.object({
  flowId: z.string().uuid(),
  stepType: z.enum(["message", "wait", "ai", "handoff", "webhook", "tag"]),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const listWhatsAppFlows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { data, error } = await db
      .from("whatsapp_flows")
      .select("id,name,description,trigger_type,trigger_value,enabled,created_at,updated_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createWhatsAppFlow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => flowSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { data: created, error } = await db
      .from("whatsapp_flows")
      .insert({
        tenant_id: tenantId,
        created_by: context.userId,
        name: data.name,
        description: data.description || null,
        trigger_type: data.triggerType,
        trigger_value: data.triggerValue || null,
        enabled: data.enabled,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { success: true, id: created.id as string };
  });

export const addWhatsAppFlowStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => flowStepSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { data: flow } = await db
      .from("whatsapp_flows")
      .select("id,tenant_id")
      .eq("id", data.flowId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!flow) throw new Error("Fluxo não encontrado.");

    const { data: existing } = await db
      .from("whatsapp_flow_steps")
      .select("position")
      .eq("flow_id", data.flowId)
      .order("position", { ascending: false })
      .limit(1);
    const position = Number(existing?.[0]?.position ?? 0) + 1;
    const { error } = await db.from("whatsapp_flow_steps").insert({
      flow_id: data.flowId,
      position,
      step_type: data.stepType,
      config: data.config,
    });
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const getAiAgentSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { data, error } = await db
      .from("ai_agent_settings")
      .select("enabled,agent_name,system_prompt,auto_reply,handoff_keywords,business_hours,updated_at")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ?? {
      enabled: false,
      agent_name: "Assistente MercadoImobi",
      system_prompt: "",
      auto_reply: false,
      handoff_keywords: ["humano", "corretor", "atendente"],
      business_hours: {},
      updated_at: null,
    };
  });

export const saveAiAgentSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({
    enabled: z.boolean(),
    agentName: z.string().trim().min(1).max(80),
    systemPrompt: z.string().max(12000),
    autoReply: z.boolean(),
    handoffKeywords: z.array(z.string().trim().min(1).max(80)).max(30),
  }).parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { error } = await db.from("ai_agent_settings").upsert({
      tenant_id: tenantId,
      enabled: data.enabled,
      agent_name: data.agentName,
      system_prompt: data.systemPrompt,
      auto_reply: data.autoReply,
      handoff_keywords: data.handoffKeywords,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id" });
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const listIntegrationWebhooks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { data, error } = await db
      .from("integration_webhooks")
      .select("id,name,direction,event_type,endpoint_url,enabled,created_at,updated_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });
