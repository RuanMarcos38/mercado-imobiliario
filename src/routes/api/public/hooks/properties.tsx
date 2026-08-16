import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const itemSchema = z.object({
  id: z.string().max(200).optional(),
  title: z.string().trim().min(2).max(300),
  description: z.string().nullable().optional(),
  price: z.number().nonnegative().nullable().optional(),
  location_address: z.string().nullable().optional(),
  location_city: z.string().nullable().optional(),
  location_state: z.string().max(2).nullable().optional(),
  property_type: z.string().nullable().optional(),
  bedrooms: z.number().nonnegative().nullable().optional(),
  bathrooms: z.number().nonnegative().nullable().optional(),
  area_sqm: z.number().nonnegative().nullable().optional(),
  images: z.array(z.string().url()).max(30).nullable().optional(),
  source_url: z.string().url(),
  source_portal: z.string().trim().min(1).max(120),
  sale_mode: z.string().nullable().optional(),
  is_auction: z.boolean().optional(),
  contact_name: z.string().nullable().optional(),
  contact_phone: z.string().nullable().optional(),
  contact_whatsapp: z.string().nullable().optional(),
  contact_email: z.string().email().nullable().optional(),
  is_verified: z.boolean().optional().default(false),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

const payloadSchema = z.object({
  source_code: z.string().trim().min(1).max(80),
  items: z.array(itemSchema).min(1).max(500),
});

async function handler(request: Request) {
  const secret = process.env["PROPERTY_IMPORT_WEBHOOK_SECRET"];
  if (!secret) return Response.json({ ok: false, message: "Importação ainda não ativada." }, { status: 503 });
  const supplied = request.headers.get("x-property-import-key") ?? request.headers.get("x-api-key");
  if (supplied !== secret) return Response.json({ ok: false }, { status: 401 });

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, message: "Formato de importação inválido." }, { status: 400 });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: source } = await db.from("property_source_catalog").select("code,name").eq("code", parsed.data.source_code).maybeSingle();
  if (!source) return Response.json({ ok: false, message: "Fonte não cadastrada." }, { status: 400 });

  const run = await db.from("property_scan_runs").insert({ source_code: parsed.data.source_code, status: "running", started_at: new Date().toISOString(), discovered_count: parsed.data.items.length }).select("id").single();
  const runId = run.data?.id as string | undefined;
  const now = new Date().toISOString();
  let upserted = 0;

  try {
    const rows = parsed.data.items.map((item) => ({
      title: item.title,
      description: item.description ?? null,
      price: item.price ?? null,
      location_address: item.location_address ?? null,
      location_city: item.location_city ?? null,
      location_state: item.location_state?.toUpperCase() ?? null,
      property_type: item.property_type ?? null,
      bedrooms: item.bedrooms == null ? null : Math.trunc(item.bedrooms),
      bathrooms: item.bathrooms == null ? null : Math.trunc(item.bathrooms),
      area_sqm: item.area_sqm ?? null,
      images: item.images ?? null,
      source_url: item.source_url,
      source_portal: item.source_portal,
      is_verified: item.is_verified,
      scanned_at: now,
      listing_market: "market",
      is_auction: item.is_auction ?? false,
      sale_mode: item.sale_mode ?? null,
      contact_name: item.contact_name ?? null,
      contact_phone: item.contact_phone ?? null,
      contact_whatsapp: item.contact_whatsapp?.replace(/\D/g, "") || null,
      contact_email: item.contact_email ?? null,
      source_property_id: item.id ?? null,
      first_seen_at: now,
      last_seen_at: now,
      metadata: { ...item.metadata, source: parsed.data.source_code },
    }));

    const result = await db.from("property_search_index").upsert(rows, { onConflict: "source_url" });
    if (result.error) throw new Error(result.error.message);
    upserted = rows.length;
    if (runId) await db.from("property_scan_runs").update({ status: "success", inserted_count: upserted, finished_at: new Date().toISOString() }).eq("id", runId);
    return Response.json({ ok: true, received: rows.length, upserted });
  } catch (error) {
    if (runId) await db.from("property_scan_runs").update({ status: "failed", error_summary: error instanceof Error ? error.message.slice(0, 500) : "Falha na importação", finished_at: new Date().toISOString() }).eq("id", runId);
    return Response.json({ ok: false, message: "Não foi possível importar os imóveis." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/properties")({
  server: { handlers: { POST: ({ request }) => handler(request) } },
});
