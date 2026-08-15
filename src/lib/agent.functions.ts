import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";

const propertySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  price: z.number().nonnegative().nullable().optional(),
  location_address: z.string().optional(),
  location_city: z.string().optional(),
  location_state: z.string().optional(),
  source_portal: z.string().optional(),
  source_url: z.string().url(),
  property_type: z.string().optional(),
  bedrooms: z.number().nonnegative().optional(),
  bathrooms: z.number().nonnegative().optional(),
  area_sqm: z.number().nonnegative().optional(),
  images: z.array(z.string()).optional(),
  updated_at: z.string().optional(),
});

/**
 * Receives only normalized, real property records supplied by an authorized source.
 * No synthetic listings, prices or verification status are generated here.
 */
export const syncPropertiesBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.array(propertySchema).max(500).parse(data))
  .handler(async ({ data: properties, context }) => {
    const { supabase, userId } = context;
    const tenantId = await requireTenantId(supabase, userId);

    const { error } = await supabase.from("properties").upsert(
      properties.map((property) => ({
        tenant_id: tenantId,
        owner_id: userId,
        title: property.title,
        description: property.description ?? null,
        price: property.price ?? null,
        location_address: property.location_address ?? null,
        location_city: property.location_city ?? null,
        location_state: property.location_state ?? null,
        source_portal: property.source_portal ?? null,
        source_url: property.source_url,
        property_type: property.property_type ?? null,
        bedrooms: property.bedrooms ?? null,
        bathrooms: property.bathrooms ?? null,
        area_sqm: property.area_sqm ?? null,
        images: property.images ?? null,
        anti_fraud_score: null,
        is_verified: false,
        updated_at: property.updated_at ?? new Date().toISOString(),
      })),
      { onConflict: "source_url" },
    );

    if (error) throw new Error(error.message);
    return { success: true, count: properties.length };
  });
