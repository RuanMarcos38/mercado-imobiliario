import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const discoverySchema = z.object({
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(2).optional(),
  query: z.string().trim().max(300).optional(),
});

export const getPropertyDiscoveryStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({
    configured: Boolean(process.env["OPENAI_API_KEY"]),
  }));

export const runPropertyDiscovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => discoverySchema.parse(data))
  .handler(async ({ data, context }) => {
    const { discoverPublicPropertySources } = await import("@/lib/property-discovery.server");
    const result = await discoverPublicPropertySources(data);
    if (!result.configured) return result;

    const db = context.supabase as any;
    const now = new Date().toISOString();
    for (const candidate of result.candidates) {
      const { error } = await db.from("property_discovered_domains").upsert(
        {
          domain: candidate.domain,
          business_name: candidate.title,
          city: data.city || null,
          state: data.state?.toUpperCase() || null,
          discovery_source: "ai_web_search",
          status: "candidate",
          last_checked_at: now,
          metadata: {
            discovered_url: candidate.url,
            discovery_query: data.query || null,
          },
          updated_at: now,
        },
        { onConflict: "domain" },
      );
      if (error) throw new Error(error.message);
    }

    return result;
  });

export const listDiscoveredPropertyDomains = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const { data, error } = await db
      .from("property_discovered_domains")
      .select(
        "id,domain,business_name,city,state,status,feed_url,last_checked_at,last_property_seen_at,metadata",
      )
      .order("last_checked_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
