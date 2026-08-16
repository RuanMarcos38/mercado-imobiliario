import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";

const feedSchema = z.object({
  sourceCode: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  feedUrl: z.string().url(),
  format: z.enum(["xml", "json"]),
});

export const listPropertySources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;

    const [catalogResult, connectionsResult, runsResult] = await Promise.all([
      db.from("property_source_catalog").select("code,name,category,integration_mode,status,website_domain,supports_contacts,supports_updates,notes").order("name"),
      db.from("property_source_connections").select("id,source_code,name,status,connection_type,last_sync_at,last_success_at,last_error,public_config").eq("tenant_id", tenantId),
      db.from("property_scan_runs").select("id,source_code,status,discovered_count,inserted_count,updated_count,removed_count,started_at,finished_at,created_at").order("created_at", { ascending: false }).limit(50),
    ]);

    if (catalogResult.error) throw new Error(catalogResult.error.message);
    if (connectionsResult.error) throw new Error(connectionsResult.error.message);
    if (runsResult.error) throw new Error(runsResult.error.message);

    const connections = connectionsResult.data ?? [];
    return {
      sources: (catalogResult.data ?? []).map((source: any) => ({
        ...source,
        connections: connections.filter((connection: any) => connection.source_code === source.code),
      })),
      recentRuns: runsResult.data ?? [],
    };
  });

export const registerPropertyFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => feedSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { data: source, error: sourceError } = await db
      .from("property_source_catalog")
      .select("code")
      .eq("code", data.sourceCode)
      .maybeSingle();
    if (sourceError) throw new Error(sourceError.message);
    if (!source) throw new Error("Fonte não encontrada.");

    const { data: connection, error } = await db
      .from("property_source_connections")
      .upsert({
        tenant_id: tenantId,
        source_code: data.sourceCode,
        name: data.name,
        status: "pending",
        connection_type: `authorized_${data.format}_feed`,
        public_config: { feedUrl: data.feedUrl, format: data.format },
        created_by: context.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "tenant_id,source_code,name" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { success: true, id: connection.id as string };
  });

export const getPropertySourceSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const { data, error } = await db.from("property_search_index").select("listing_market,is_auction,sale_mode,source_portal");
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    return {
      total: rows.length,
      caixa: rows.filter((row: any) => row.listing_market === "caixa").length,
      auctions: rows.filter((row: any) => row.is_auction).length,
      market: rows.filter((row: any) => row.listing_market !== "caixa").length,
      withPortal: rows.filter((row: any) => Boolean(row.source_portal)).length,
    };
  });
