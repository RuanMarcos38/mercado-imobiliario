import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { apiJson, authenticateApiRequest } from "@/lib/api-auth.server";

async function handleProperties(request: Request) {
  const principal = await authenticateApiRequest(request);
  if (!principal) return apiJson({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
  const city = (url.searchParams.get("city") || "").trim().slice(0, 120);
  const state = (url.searchParams.get("state") || "").trim().slice(0, 40);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 30)));
  let query = (supabaseAdmin as any)
    .from("property_search_index")
    .select(
      "id,title,description,price,location_city,location_state,location_address,property_type,bedrooms,bathrooms,area_sqm,images,source_url,source_portal,is_verified,last_seen_at",
    )
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  if (city) query = query.ilike("location_city", `%${city}%`);
  if (state) query = query.ilike("location_state", `%${state}%`);
  if (q) {
    const escaped = q.replace(/[,%]/g, " ").trim();
    query = query.or(
      `title.ilike.%${escaped}%,description.ilike.%${escaped}%,location_city.ilike.%${escaped}%,location_address.ilike.%${escaped}%`,
    );
  }
  const { data, error } = await query;
  if (error) return apiJson({ error: "query_failed", message: error.message }, 500);
  return apiJson({ data: data ?? [], count: data?.length ?? 0 });
}

export const Route = createFileRoute("/api/v1/properties")({
  server: { handlers: { GET: ({ request }) => handleProperties(request) } },
});
