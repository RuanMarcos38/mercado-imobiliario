import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";

const propertySchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  price: z.number(),
  location_city: z.string().optional(),
  location_state: z.string().optional(),
  source_portal: z.string().optional(),
  source_url: z.string().url(),
  property_type: z.string().optional(),
});
const leadCriteriaSchema = z.object({ criteria: z.record(z.string(), z.any()).optional() });

/** Returns only real leads already imported/created for the authenticated tenant. */
export const prospectLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => leadCriteriaSchema.parse(data ?? {}))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const tenantId = await requireTenantId(supabase, userId);
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Imports normalized properties. Anti-fraud remains pending until an actual verifier scores the record. */
export const syncPropertiesBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.array(propertySchema).parse(data))
  .handler(async ({ data: properties, context }) => {
    const { supabase, userId } = context;
    const tenantId = await requireTenantId(supabase, userId);
    const { error } = await supabase.from("properties").upsert(
      properties.map((p) => ({
        tenant_id: tenantId,
        owner_id: userId,
        title: p.title,
        description: p.description ?? null,
        price: p.price,
        location_city: p.location_city ?? null,
        location_state: p.location_state ?? null,
        source_portal: p.source_portal ?? null,
        source_url: p.source_url,
        property_type: p.property_type ?? null,
        anti_fraud_score: null,
        is_verified: false,
      })),
      { onConflict: "source_url" },
    );
    if (error) throw new Error(error.message);
    return { success: true, count: properties.length, tenantId };
  });
