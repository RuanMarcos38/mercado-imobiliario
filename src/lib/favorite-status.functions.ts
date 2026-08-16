import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PropertySearchItem } from "@/lib/property-search.functions";

export interface FavoritePropertyWithStatus {
  key: string;
  property: PropertySearchItem;
  created_at: string;
  available: boolean;
}

export const listFavoritePropertiesWithStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FavoritePropertyWithStatus[]> => {
    const { data: favorites, error } = await context.supabase
      .from("property_favorites")
      .select("property_key,property_snapshot,created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);

    const snapshots = (favorites ?? []).map((row) => ({
      key: row.property_key,
      property: row.property_snapshot as unknown as PropertySearchItem,
      created_at: row.created_at,
    }));
    const urls = snapshots
      .map((item) => item.property.source_url)
      .filter((value): value is string => Boolean(value));

    const currentUrls = new Set<string>();
    if (urls.length > 0) {
      const [indexResult, savedResult] = await Promise.all([
        context.supabase.from("property_search_index").select("source_url").in("source_url", urls),
        context.supabase.from("properties").select("source_url").in("source_url", urls),
      ]);
      for (const row of [...(indexResult.data ?? []), ...(savedResult.data ?? [])]) {
        if (row.source_url) currentUrls.add(row.source_url.trim().toLowerCase());
      }
    }

    return snapshots.map((item) => ({
      ...item,
      available: item.property.source_url
        ? currentUrls.has(item.property.source_url.trim().toLowerCase())
        : true,
    }));
  });
