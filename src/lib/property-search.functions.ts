import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const searchSchema = z.object({
  city: z.string().trim().max(120).optional(),
  neighborhood: z.string().trim().max(120).optional(),
  state: z.string().trim().max(2).optional(),
  propertyType: z.string().trim().max(80).optional(),
  minPrice: z.number().nonnegative().optional(),
  maxPrice: z.number().nonnegative().optional(),
  bedrooms: z.number().int().nonnegative().optional(),
  bathrooms: z.number().int().nonnegative().optional(),
  minArea: z.number().nonnegative().optional(),
  maxArea: z.number().nonnegative().optional(),
  sourcePortal: z.string().trim().max(120).optional(),
  verifiedOnly: z.boolean().optional().default(false),
  sort: z.enum(["recent", "price_asc", "price_desc", "area_desc"]).optional().default("recent"),
  limit: z.number().int().min(1).max(60).optional().default(30),
});

const liveListingSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  price: z.number().nonnegative().nullable().optional(),
  location_address: z.string().nullable().optional(),
  location_city: z.string().nullable().optional(),
  location_state: z.string().nullable().optional(),
  property_type: z.string().nullable().optional(),
  bedrooms: z.number().nullable().optional(),
  bathrooms: z.number().nullable().optional(),
  area_sqm: z.number().nullable().optional(),
  images: z.array(z.string()).nullable().optional(),
  is_verified: z.boolean().nullable().optional(),
  source_portal: z.string().nullable().optional(),
  source_url: z.string().url(),
  updated_at: z.string().nullable().optional(),
});

export type PropertySearchInput = z.infer<typeof searchSchema>;

export interface PropertySearchItem {
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  location_address: string | null;
  location_city: string | null;
  location_state: string | null;
  property_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqm: number | null;
  images: string[] | null;
  is_verified: boolean | null;
  source_portal: string | null;
  source_url: string | null;
  updated_at: string | null;
}

function keyFor(item: PropertySearchItem): string {
  if (item.source_url) return item.source_url.trim().toLowerCase();
  return [item.title, item.location_address, item.location_city, item.location_state, item.price]
    .filter(Boolean)
    .join("|")
    .toLowerCase();
}

function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function safePostgrestTerm(value: string): string {
  return value.replace(/[,%()]/g, " ").replace(/\s+/g, " ").trim();
}

function textVariants(value: string): string[] {
  const original = safePostgrestTerm(value);
  const normalized = safePostgrestTerm(
    value.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
  );
  return Array.from(new Set([original, normalized].filter(Boolean)));
}

function sortItems(items: PropertySearchItem[], sort: PropertySearchInput["sort"]) {
  if (sort === "price_asc") {
    return items.sort(
      (a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER),
    );
  }
  if (sort === "price_desc") {
    return items.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
  }
  if (sort === "area_desc") {
    return items.sort((a, b) => (b.area_sqm ?? -1) - (a.area_sqm ?? -1));
  }
  return items.sort((a, b) => {
    const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    return bTime - aTime;
  });
}

function matchesSearch(item: PropertySearchItem, input: PropertySearchInput): boolean {
  if (input.city) {
    const city = normalizeSearchText(input.city);
    const haystack = normalizeSearchText(
      [item.location_city, item.location_address, item.title].filter(Boolean).join(" "),
    );
    if (!haystack.includes(city)) return false;
  }
  if (input.neighborhood) {
    const neighborhood = normalizeSearchText(input.neighborhood);
    const haystack = normalizeSearchText(
      [item.title, item.description, item.location_address].filter(Boolean).join(" "),
    );
    if (!haystack.includes(neighborhood)) return false;
  }
  if (input.state && normalizeSearchText(item.location_state) !== normalizeSearchText(input.state)) {
    return false;
  }
  if (input.propertyType) {
    const expected = normalizeSearchText(input.propertyType);
    const actual = normalizeSearchText(item.property_type);
    if (!actual.includes(expected) && !expected.includes(actual)) return false;
  }
  if (typeof input.minPrice === "number" && (item.price == null || item.price < input.minPrice)) return false;
  if (typeof input.maxPrice === "number" && (item.price == null || item.price > input.maxPrice)) return false;
  if (typeof input.bedrooms === "number" && input.bedrooms > 0 && (item.bedrooms == null || item.bedrooms < input.bedrooms)) return false;
  if (typeof input.bathrooms === "number" && input.bathrooms > 0 && (item.bathrooms == null || item.bathrooms < input.bathrooms)) return false;
  if (typeof input.minArea === "number" && (item.area_sqm == null || item.area_sqm < input.minArea)) return false;
  if (typeof input.maxArea === "number" && (item.area_sqm == null || item.area_sqm > input.maxArea)) return false;
  if (input.sourcePortal && !normalizeSearchText(item.source_portal).includes(normalizeSearchText(input.sourcePortal))) return false;
  if (input.verifiedOnly && !item.is_verified) return false;
  return true;
}

async function fetchConfiguredLiveSource(input: PropertySearchInput): Promise<PropertySearchItem[]> {
  const url = process.env["PROPERTY_SEARCH_LIVE_URL"];
  if (!url) return [];
  const token = process.env["PROPERTY_SEARCH_LIVE_TOKEN"];
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return [];
    const json = await response.json();
    const candidates = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : [];
    const parsed = z.array(liveListingSchema).safeParse(candidates);
    if (!parsed.success) return [];

    return parsed.data
      .map((item, index): PropertySearchItem => ({
        id: item.id ?? `live-${index}-${item.source_url}`,
        title: item.title,
        description: item.description ?? null,
        price: item.price ?? null,
        location_address: item.location_address ?? null,
        location_city: item.location_city ?? null,
        location_state: item.location_state ?? null,
        property_type: item.property_type ?? null,
        bedrooms: item.bedrooms ?? null,
        bathrooms: item.bathrooms ?? null,
        area_sqm: item.area_sqm ?? null,
        images: item.images ?? null,
        is_verified: item.is_verified ?? null,
        source_portal: item.source_portal ?? null,
        source_url: item.source_url,
        updated_at: item.updated_at ?? null,
      }))
      .filter((item) => matchesSearch(item, input));
  } catch {
    return [];
  }
}

export const searchRealProperties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => searchSchema.parse(data ?? {}))
  .handler(async ({ data: input, context }) => {
    let indexQuery = context.supabase
      .from("property_search_index")
      .select(
        "id,title,description,price,location_address,location_city,location_state,property_type,bedrooms,bathrooms,area_sqm,images,is_verified,source_portal,source_url,scanned_at",
      );

    let propertyQuery = context.supabase
      .from("properties")
      .select(
        "id,title,description,price,location_address,location_city,location_state,property_type,bedrooms,bathrooms,area_sqm,images,is_verified,source_portal,source_url,updated_at",
      );

    if (input.city) {
      const variants = textVariants(input.city);
      const expression = variants
        .flatMap((term) => [
          `location_city.ilike.%${term}%`,
          `location_address.ilike.%${term}%`,
          `title.ilike.%${term}%`,
        ])
        .join(",");
      if (expression) {
        indexQuery = indexQuery.or(expression);
        propertyQuery = propertyQuery.or(expression);
      }
    }
    if (input.neighborhood) {
      const variants = textVariants(input.neighborhood);
      const expression = variants
        .flatMap((term) => [
          `title.ilike.%${term}%`,
          `description.ilike.%${term}%`,
          `location_address.ilike.%${term}%`,
        ])
        .join(",");
      if (expression) {
        indexQuery = indexQuery.or(expression);
        propertyQuery = propertyQuery.or(expression);
      }
    }
    if (input.state) {
      const state = input.state.toUpperCase();
      indexQuery = indexQuery.eq("location_state", state);
      propertyQuery = propertyQuery.eq("location_state", state);
    }
    if (input.propertyType) {
      indexQuery = indexQuery.ilike("property_type", `%${safePostgrestTerm(input.propertyType)}%`);
      propertyQuery = propertyQuery.ilike("property_type", `%${safePostgrestTerm(input.propertyType)}%`);
    }
    if (input.sourcePortal) {
      indexQuery = indexQuery.ilike("source_portal", `%${safePostgrestTerm(input.sourcePortal)}%`);
      propertyQuery = propertyQuery.ilike("source_portal", `%${safePostgrestTerm(input.sourcePortal)}%`);
    }
    if (typeof input.minPrice === "number") {
      indexQuery = indexQuery.gte("price", input.minPrice);
      propertyQuery = propertyQuery.gte("price", input.minPrice);
    }
    if (typeof input.maxPrice === "number") {
      indexQuery = indexQuery.lte("price", input.maxPrice);
      propertyQuery = propertyQuery.lte("price", input.maxPrice);
    }
    if (typeof input.bedrooms === "number" && input.bedrooms > 0) {
      indexQuery = indexQuery.gte("bedrooms", input.bedrooms);
      propertyQuery = propertyQuery.gte("bedrooms", input.bedrooms);
    }
    if (typeof input.bathrooms === "number" && input.bathrooms > 0) {
      indexQuery = indexQuery.gte("bathrooms", input.bathrooms);
      propertyQuery = propertyQuery.gte("bathrooms", input.bathrooms);
    }
    if (typeof input.minArea === "number") {
      indexQuery = indexQuery.gte("area_sqm", input.minArea);
      propertyQuery = propertyQuery.gte("area_sqm", input.minArea);
    }
    if (typeof input.maxArea === "number") {
      indexQuery = indexQuery.lte("area_sqm", input.maxArea);
      propertyQuery = propertyQuery.lte("area_sqm", input.maxArea);
    }
    if (input.verifiedOnly) {
      indexQuery = indexQuery.eq("is_verified", true);
      propertyQuery = propertyQuery.eq("is_verified", true);
    }

    if (input.sort === "price_asc") {
      indexQuery = indexQuery.order("price", { ascending: true, nullsFirst: false });
      propertyQuery = propertyQuery.order("price", { ascending: true, nullsFirst: false });
    } else if (input.sort === "price_desc") {
      indexQuery = indexQuery.order("price", { ascending: false, nullsFirst: false });
      propertyQuery = propertyQuery.order("price", { ascending: false, nullsFirst: false });
    } else if (input.sort === "area_desc") {
      indexQuery = indexQuery.order("area_sqm", { ascending: false, nullsFirst: false });
      propertyQuery = propertyQuery.order("area_sqm", { ascending: false, nullsFirst: false });
    } else {
      indexQuery = indexQuery.order("scanned_at", { ascending: false });
      propertyQuery = propertyQuery.order("updated_at", { ascending: false });
    }

    const limit = input.limit ?? 30;
    const fetchLimit = Math.min(60, Math.max(limit, limit * 2));
    indexQuery = indexQuery.limit(fetchLimit);
    propertyQuery = propertyQuery.limit(fetchLimit);

    const [indexResult, propertyResult, configuredLiveItems] = await Promise.all([
      indexQuery,
      propertyQuery,
      fetchConfiguredLiveSource(input),
    ]);

    if (indexResult.error && propertyResult.error && configuredLiveItems.length === 0) {
      throw new Error("SEARCH_UNAVAILABLE");
    }

    const indexed: PropertySearchItem[] = (indexResult.data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      price: item.price,
      location_address: item.location_address,
      location_city: item.location_city,
      location_state: item.location_state,
      property_type: item.property_type,
      bedrooms: item.bedrooms,
      bathrooms: item.bathrooms,
      area_sqm: item.area_sqm,
      images: item.images,
      is_verified: item.is_verified,
      source_portal: item.source_portal,
      source_url: item.source_url,
      updated_at: item.scanned_at,
    }));

    const saved: PropertySearchItem[] = (propertyResult.data ?? []).map((item) => ({
      ...item,
      updated_at: item.updated_at,
    }));

    const deduped = new Map<string, PropertySearchItem>();
    for (const item of [...configuredLiveItems, ...indexed, ...saved]) {
      if (!matchesSearch(item, input)) continue;
      const key = keyFor(item);
      if (!key || deduped.has(key)) continue;
      deduped.set(key, item);
    }

    const items = sortItems(Array.from(deduped.values()), input.sort).slice(0, limit);
    const latestTimestamp =
      items
        .map((item) => item.updated_at)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;

    return { items, total: items.length, latestTimestamp };
  });

const savedSearchSchema = z.object({
  name: z.string().trim().min(1).max(80),
  criteria: searchSchema,
});

export const savePropertySearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => savedSearchSchema.parse(data))
  .handler(async ({ data, context }) => {
    const criteria = JSON.parse(JSON.stringify(data.criteria));
    const { error } = await context.supabase.from("search_configurations").insert({
      user_id: context.userId,
      name: data.name,
      criteria,
      is_active: true,
    });
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const listSavedPropertySearches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("search_configurations")
      .select("id,name,criteria,created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const favoritePropertySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  price: z.number().nullable(),
  location_address: z.string().nullable(),
  location_city: z.string().nullable(),
  location_state: z.string().nullable(),
  property_type: z.string().nullable(),
  bedrooms: z.number().nullable(),
  bathrooms: z.number().nullable(),
  area_sqm: z.number().nullable(),
  images: z.array(z.string()).nullable(),
  is_verified: z.boolean().nullable(),
  source_portal: z.string().nullable(),
  source_url: z.string().nullable(),
  updated_at: z.string().nullable(),
});

const favoriteMutationSchema = z.object({
  property: favoritePropertySchema,
  favorite: z.boolean(),
});

function favoriteKey(property: z.infer<typeof favoritePropertySchema>): string {
  return property.source_url?.trim().toLowerCase() || property.id;
}

export const listFavoriteProperties = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("property_favorites")
      .select("property_key,property_snapshot,created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);

    return (data ?? []).flatMap((row) => {
      const parsed = favoritePropertySchema.safeParse(row.property_snapshot);
      if (!parsed.success) return [];
      return [{ key: row.property_key, property: parsed.data, created_at: row.created_at }];
    });
  });

export const setPropertyFavorite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => favoriteMutationSchema.parse(data))
  .handler(async ({ data, context }) => {
    const propertyKey = favoriteKey(data.property);

    if (!data.favorite) {
      const { error } = await context.supabase
        .from("property_favorites")
        .delete()
        .eq("user_id", context.userId)
        .eq("property_key", propertyKey);
      if (error) throw new Error(error.message);
      return { success: true, favorite: false, propertyKey };
    }

    const snapshot = JSON.parse(JSON.stringify(data.property));
    const { error } = await context.supabase.from("property_favorites").upsert(
      {
        user_id: context.userId,
        property_key: propertyKey,
        property_snapshot: snapshot,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,property_key" },
    );
    if (error) throw new Error(error.message);
    return { success: true, favorite: true, propertyKey };
  });

const savedSearchUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
});

export const renameSavedPropertySearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => savedSearchUpdateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("search_configurations")
      .update({ name: data.name, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

const savedSearchDeleteSchema = z.object({ id: z.string().uuid() });

export const deleteSavedPropertySearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => savedSearchDeleteSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("search_configurations")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });
