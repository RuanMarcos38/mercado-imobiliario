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

const syncSchema = z.object({
  connectionId: z.string().uuid(),
});

type HealthRow = {
  code: string;
  domain: string | null;
  online: boolean | null;
  statusCode: number | null;
  checkedAt: string;
};

let healthCache: { expiresAt: number; rows: HealthRow[] } | null = null;

async function checkWebsite(code: string, domain: string | null): Promise<HealthRow> {
  const checkedAt = new Date().toISOString();
  if (!domain) return { code, domain, online: null, statusCode: null, checkedAt };

  try {
    const response = await fetch(`https://${domain}`, {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        Range: "bytes=0-2048",
        "User-Agent": "Mozilla/5.0 MercadoImobi Source Availability/1.0",
      },
      signal: AbortSignal.timeout(7_000),
    });
    return {
      code,
      domain,
      online: response.status >= 200 && response.status < 500,
      statusCode: response.status,
      checkedAt,
    };
  } catch {
    return { code, domain, online: false, statusCode: null, checkedAt };
  }
}

export const listPropertySources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;

    const [catalogResult, connectionsResult, runsResult] = await Promise.all([
      db
        .from("property_source_catalog")
        .select(
          "code,name,category,integration_mode,status,website_domain,supports_contacts,supports_updates,notes",
        )
        .order("name"),
      db
        .from("property_source_connections")
        .select(
          "id,source_code,name,status,connection_type,last_sync_at,last_success_at,last_error,public_config",
        )
        .eq("tenant_id", tenantId),
      db
        .from("property_scan_runs")
        .select(
          "id,source_code,connection_id,status,discovered_count,inserted_count,updated_count,removed_count,started_at,finished_at,created_at,error_summary",
        )
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (catalogResult.error) throw new Error(catalogResult.error.message);
    if (connectionsResult.error) throw new Error(connectionsResult.error.message);
    if (runsResult.error) throw new Error(runsResult.error.message);

    const connections = connectionsResult.data ?? [];
    const runs = runsResult.data ?? [];
    return {
      sources: (catalogResult.data ?? []).map((source: any) => ({
        ...source,
        connections: connections.filter((connection: any) => connection.source_code === source.code),
        latestRun: runs.find((run: any) => run.source_code === source.code) ?? null,
      })),
      recentRuns: runs,
    };
  });

export const getPropertySourceHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (healthCache && healthCache.expiresAt > Date.now()) return healthCache.rows;
    const db = context.supabase as any;
    const { data, error } = await db
      .from("property_source_catalog")
      .select("code,website_domain")
      .order("code");
    if (error) throw new Error(error.message);

    const entries = data ?? [];
    const rows: HealthRow[] = [];
    for (let offset = 0; offset < entries.length; offset += 5) {
      const batch = entries.slice(offset, offset + 5);
      rows.push(
        ...(await Promise.all(
          batch.map((source: any) => checkWebsite(source.code, source.website_domain || null)),
        )),
      );
    }
    healthCache = { expiresAt: Date.now() + 5 * 60_000, rows };
    return rows;
  });

export const registerPropertyFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => feedSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { data: source, error: sourceError } = await db
      .from("property_source_catalog")
      .select("code,name")
      .eq("code", data.sourceCode)
      .maybeSingle();
    if (sourceError) throw new Error(sourceError.message);
    if (!source) throw new Error("Fonte não encontrada.");

    const { assertPublicFeedUrl } = await import("@/lib/property-feed.server");
    assertPublicFeedUrl(data.feedUrl);

    const now = new Date().toISOString();
    const { data: connection, error } = await db
      .from("property_source_connections")
      .upsert(
        {
          tenant_id: tenantId,
          source_code: data.sourceCode,
          name: data.name,
          status: "pending",
          connection_type: `authorized_${data.format}_feed`,
          public_config: { feedUrl: data.feedUrl, format: data.format },
          created_by: context.userId,
          updated_at: now,
        },
        { onConflict: "tenant_id,source_code,name" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { syncAuthorizedFeedConnection } = await import("@/lib/property-feed.server");
    const result = await syncAuthorizedFeedConnection(connection.id as string, tenantId);
    return { success: true, id: connection.id as string, imported: result.count };
  });

export const syncPropertyFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => syncSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const { syncAuthorizedFeedConnection } = await import("@/lib/property-feed.server");
    return syncAuthorizedFeedConnection(data.connectionId, tenantId);
  });

export const getPropertySourceSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const { data, error } = await db
      .from("property_search_index")
      .select("listing_market,is_auction,sale_mode,source_portal");
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    return {
      total: rows.length,
      caixa: rows.filter((row: any) => row.listing_market === "caixa").length,
      auctions: rows.filter((row: any) => row.is_auction).length,
      market: rows.filter((row: any) => row.listing_market !== "caixa").length,
      withPortal: rows.filter((row: any) => Boolean(row.source_portal)).length,
      portals: Array.from(
        new Set(
          rows
            .map((row: any) => row.source_portal)
            .filter((portal: unknown): portal is string => typeof portal === "string" && portal.length > 0),
        ),
      ).length,
    };
  });
