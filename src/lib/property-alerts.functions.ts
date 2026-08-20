import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";

const criteriaSchema = z.object({
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(2).optional(),
  propertyType: z.string().trim().max(80).optional(),
  minPrice: z.number().nonnegative().optional(),
  maxPrice: z.number().nonnegative().optional(),
  market: z.enum(["market", "caixa"]).optional(),
  auctionOnly: z.boolean().optional(),
});

const createRuleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  criteria: criteriaSchema,
  notifyWhatsapp: z.boolean().default(false),
  notifyEmail: z.boolean().default(false),
});

const idSchema = z.object({ id: z.string().uuid() });

export const listPropertyAlertRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { data, error } = await db
      .from("property_alert_rules")
      .select(
        "id,name,criteria,notify_in_app,notify_whatsapp,notify_email,active,last_matched_at,created_at",
      )
      .eq("tenant_id", tenantId)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createPropertyAlertRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createRuleSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { data: created, error } = await db
      .from("property_alert_rules")
      .insert({
        tenant_id: tenantId,
        user_id: context.userId,
        name: data.name,
        criteria: data.criteria,
        notify_in_app: true,
        notify_whatsapp: data.notifyWhatsapp,
        notify_email: data.notifyEmail,
        active: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { success: true, id: created.id as string };
  });

export const togglePropertyAlertRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid(), active: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { error } = await db
      .from("property_alert_rules")
      .update({ active: data.active, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const deletePropertyAlertRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { error } = await db
      .from("property_alert_rules")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const listPropertyAlertEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { data, error } = await db
      .from("property_alert_events")
      .select("id,rule_id,property_id,title,property_snapshot,read_at,created_at")
      .eq("tenant_id", tenantId)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const markPropertyAlertRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { error } = await db
      .from("property_alert_events")
      .update({ read_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });
