import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";

const conversationInput = z.object({ conversationId: z.string().uuid() });
const aiModeInput = conversationInput.extend({ enabled: z.boolean() });

export interface ConversationAiMode {
  conversationId: string;
  enabled: boolean;
  pausedAt: string | null;
  pausedBy: string | null;
}

export interface ResponseRiskItem {
  conversationId: string;
  contactName: string;
  phone: string;
  lastInboundAt: string;
  lastOutboundAt: string | null;
  hoursWaiting: number;
  assignedUserId: string | null;
}

export interface PipelineAgeAlert {
  opportunityId: string;
  contactName: string;
  stageId: string;
  stageName: string;
  stageEnteredAt: string;
  daysInStage: number;
  level: 5 | 10 | 30;
  conversationId: string | null;
}

export const getConversationAiMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => conversationInput.parse(data))
  .handler(async ({ context, data }): Promise<ConversationAiMode> => {
    const tenantId = await requireTenantId(context.supabase as any, context.userId);
    const { data: conversation, error } = await (context.supabase as any)
      .from("whatsapp_conversations")
      .select("id,ai_enabled,ai_paused_at,ai_paused_by")
      .eq("tenant_id", tenantId)
      .eq("id", data.conversationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!conversation) throw new Error("Conversa não encontrada.");
    return {
      conversationId: String(conversation.id),
      enabled: conversation.ai_enabled !== false,
      pausedAt: conversation.ai_paused_at ?? null,
      pausedBy: conversation.ai_paused_by ?? null,
    };
  });

export const setConversationAiMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => aiModeInput.parse(data))
  .handler(async ({ context, data }): Promise<ConversationAiMode> => {
    const tenantId = await requireTenantId(context.supabase as any, context.userId);
    const now = new Date().toISOString();
    const { data: conversation, error } = await (context.supabase as any)
      .from("whatsapp_conversations")
      .update({
        ai_enabled: data.enabled,
        ai_paused_at: data.enabled ? null : now,
        ai_paused_by: data.enabled ? null : context.userId,
        updated_at: now,
      })
      .eq("tenant_id", tenantId)
      .eq("id", data.conversationId)
      .select("id,ai_enabled,ai_paused_at,ai_paused_by")
      .single();
    if (error) throw new Error(error.message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as any).from("system_events").insert({
      tenant_id: tenantId,
      event_type: "conversation_ai_mode",
      severity: "info",
      message: data.enabled
        ? "Agente de IA reativado na conversa"
        : "Agente de IA pausado para atendimento manual",
      metadata: {
        conversationId: data.conversationId,
        enabled: data.enabled,
        changedBy: context.userId,
      },
    });

    return {
      conversationId: String(conversation.id),
      enabled: conversation.ai_enabled !== false,
      pausedAt: conversation.ai_paused_at ?? null,
      pausedBy: conversation.ai_paused_by ?? null,
    };
  });

export const getUnansweredCustomerAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ResponseRiskItem[]> => {
    const tenantId = await requireTenantId(context.supabase as any, context.userId);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const db = context.supabase as any;
    const { data: rows, error } = await db
      .from("whatsapp_conversations")
      .select(
        "id,contact_name,phone_e164,last_inbound_at,last_outbound_at,assigned_user_id,last_message_at",
      )
      .eq("tenant_id", tenantId)
      .not("last_inbound_at", "is", null)
      .lte("last_inbound_at", cutoff)
      .order("last_inbound_at", { ascending: true })
      .limit(100);
    if (error) throw new Error(error.message);

    const now = Date.now();
    return (rows ?? [])
      .filter((row: any) => {
        if (!row.last_inbound_at) return false;
        if (row.assigned_user_id && String(row.assigned_user_id) !== context.userId) return false;
        if (!row.last_outbound_at) return true;
        return new Date(row.last_outbound_at).getTime() < new Date(row.last_inbound_at).getTime();
      })
      .map((row: any) => ({
        conversationId: String(row.id),
        contactName: String(row.contact_name || "Cliente sem nome"),
        phone: String(row.phone_e164 || ""),
        lastInboundAt: String(row.last_inbound_at),
        lastOutboundAt: row.last_outbound_at ? String(row.last_outbound_at) : null,
        hoursWaiting: Math.max(
          24,
          Math.floor((now - new Date(String(row.last_inbound_at)).getTime()) / 3_600_000),
        ),
        assignedUserId: row.assigned_user_id ? String(row.assigned_user_id) : null,
      }));
  });

export const getPipelineAgeAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PipelineAgeAlert[]> => {
    const tenantId = await requireTenantId(context.supabase as any, context.userId);
    const db = context.supabase as any;
    const { data: opportunities, error } = await db
      .from("crm_opportunities")
      .select("id,contact_name,stage_id,stage_entered_at,conversation_id,owner_user_id,status")
      .eq("tenant_id", tenantId)
      .eq("status", "open")
      .lte("stage_entered_at", new Date(Date.now() - 5 * 86_400_000).toISOString())
      .order("stage_entered_at", { ascending: true })
      .limit(250);
    if (error) throw new Error(error.message);

    const visible = (opportunities ?? []).filter(
      (row: any) => !row.owner_user_id || String(row.owner_user_id) === context.userId,
    );
    const stageIds = [...new Set(visible.map((row: any) => String(row.stage_id)).filter(Boolean))];
    const stageNames = new Map<string, string>();
    if (stageIds.length) {
      const { data: stages } = await db.from("crm_stages").select("id,name").in("id", stageIds);
      for (const stage of stages ?? [])
        stageNames.set(String(stage.id), String(stage.name || "Etapa"));
    }

    const now = Date.now();
    return visible.map((row: any) => {
      const stageEnteredAt = String(row.stage_entered_at);
      const daysInStage = Math.max(
        5,
        Math.floor((now - new Date(stageEnteredAt).getTime()) / 86_400_000),
      );
      const level: 5 | 10 | 30 = daysInStage >= 30 ? 30 : daysInStage >= 10 ? 10 : 5;
      return {
        opportunityId: String(row.id),
        contactName: String(row.contact_name || "Cliente sem nome"),
        stageId: String(row.stage_id),
        stageName: stageNames.get(String(row.stage_id)) || "Etapa",
        stageEnteredAt,
        daysInStage,
        level,
        conversationId: row.conversation_id ? String(row.conversation_id) : null,
      };
    });
  });
