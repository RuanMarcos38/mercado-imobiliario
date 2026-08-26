import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateApiRequest } from "@/lib/api-auth.server";

const propertySchema = z.object({
  title: z.string().trim().min(2).max(300),
  description: z.string().nullable().optional(),
  price: z.number().nonnegative(),
  location_address: z.string().nullable().optional(),
  location_city: z.string().nullable().optional(),
  location_state: z.string().trim().max(2).nullable().optional(),
  source_portal: z.string().trim().max(120).nullable().optional(),
  source_url: z.string().url(),
  images: z.array(z.string().url()).max(30).nullable().optional(),
  property_type: z.string().nullable().optional(),
  bedrooms: z.number().nonnegative().nullable().optional(),
  bathrooms: z.number().nonnegative().nullable().optional(),
  area_sqm: z.number().nonnegative().nullable().optional(),
  tenant_id: z.string().uuid().optional(),
});

async function resolveLegacyTenant(payloadTenantId: string | undefined) {
  if (!payloadTenantId) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;

  const { data: tenantRow } = await db
    .from("tenants")
    .select("id")
    .eq("id", payloadTenantId)
    .maybeSingle();
  if (tenantRow?.id) return { tenantId: String(tenantRow.id), userId: null as string | null };

  const { data: profileRow } = await db
    .from("profiles")
    .select("id,tenant_id")
    .eq("id", payloadTenantId)
    .maybeSingle();
  if (!profileRow?.tenant_id) return null;
  return { tenantId: String(profileRow.tenant_id), userId: String(profileRow.id) };
}

async function handleN8nWebhook(request: Request) {
  const suppliedLegacyKey = request.headers.get("x-n8n-api-key")?.trim() || "";
  const legacySecret =
    process.env["N8N_WEBHOOK_SECRET"]?.trim() ||
    process.env["PROPERTY_IMPORT_WEBHOOK_SECRET"]?.trim() ||
    "";
  const legacyAuthorized = Boolean(
    legacySecret && suppliedLegacyKey && suppliedLegacyKey === legacySecret,
  );

  // Preferred mode: the token generated inside Central de Integrações. This avoids a
  // global N8N secret and keeps each automation bound to its authenticated tenant.
  const principal = legacyAuthorized ? null : await authenticateApiRequest(request);
  if (!legacyAuthorized && !principal) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = propertySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Formato de imóvel inválido.", issues: parsed.error.issues.map((issue) => issue.path.join(".")) },
      { status: 400 },
    );
  }

  const legacyTenant = principal ? null : await resolveLegacyTenant(parsed.data.tenant_id);
  const tenantId = principal?.tenantId ?? legacyTenant?.tenantId ?? null;
  const userId = principal?.userId ?? legacyTenant?.userId ?? null;
  if (!tenantId) {
    return Response.json(
      { error: "tenant_id não corresponde a nenhuma organização ou usuário" },
      { status: 400 },
    );
  }

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const now = new Date().toISOString();
    const item = parsed.data;

    const { data: previous } = await db
      .from("property_search_index")
      .select("first_seen_at,metadata")
      .eq("source_url", item.source_url)
      .maybeSingle();

    const metadata = {
      ...(previous?.metadata && typeof previous.metadata === "object" ? previous.metadata : {}),
      source: "n8n_authorized",
      importer_tenant: tenantId,
      ...(userId ? { importer_user: userId } : {}),
    };

    const { error } = await db.from("property_search_index").upsert(
      {
        title: item.title,
        description: item.description ?? null,
        price: item.price,
        location_address: item.location_address ?? null,
        location_city: item.location_city ?? null,
        location_state: item.location_state?.toUpperCase() ?? null,
        source_portal: item.source_portal || "N8N",
        source_url: item.source_url,
        images: item.images ?? null,
        property_type: item.property_type ?? null,
        bedrooms: item.bedrooms == null ? null : Math.trunc(item.bedrooms),
        bathrooms: item.bathrooms == null ? null : Math.trunc(item.bathrooms),
        area_sqm: item.area_sqm ?? null,
        is_verified: false,
        listing_market: "market",
        is_auction: false,
        first_seen_at: previous?.first_seen_at ?? now,
        last_seen_at: now,
        scanned_at: now,
        metadata,
      },
      { onConflict: "source_url" },
    );
    if (error) throw new Error(error.message);

    return Response.json({ success: true, tenantId, sourceUrl: item.source_url });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Não foi possível importar o imóvel." },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/public/hooks/n8n-webhook")({
  server: {
    handlers: {
      POST: ({ request }) => handleN8nWebhook(request),
      GET: async () =>
        Response.json({
          status: "ok",
          methods: ["POST"],
          authentication: ["Bearer mi_live_*", "x-n8n-api-key (legado)"],
        }),
    },
  },
});
