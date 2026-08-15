import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const searchSchema = z.object({
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(2).optional(),
  propertyType: z.string().trim().max(80).optional(),
  minPrice: z.number().nonnegative().optional(),
  maxPrice: z.number().nonnegative().optional(),
  bedrooms: z.number().int().nonnegative().optional(),
  bathrooms: z.number().int().nonnegative().optional(),
  verifiedOnly: z.boolean().optional().default(false),
  sort: z.enum(["recent", "price_asc", "price_desc"]).optional().default("recent"),
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

const CAIXA_STATES = [
  "AC",
  "AL",
  "AM",
  "AP",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MG",
  "MS",
  "MT",
  "PA",
  "PB",
  "PE",
  "PI",
  "PR",
  "RJ",
  "RN",
  "RO",
  "RR",
  "RS",
  "SC",
  "SE",
  "SP",
  "TO",
] as const;

const CAIXA_CACHE_TTL_MS = 15 * 60 * 1000;
const caixaCache = new Map<string, { expiresAt: number; items: PropertySearchItem[] }>();

function keyFor(item: PropertySearchItem): string {
  if (item.source_url) return item.source_url.trim().toLowerCase();
  return [item.title, item.location_address, item.location_city, item.location_state, item.price]
    .filter(Boolean)
    .join("|")
    .toLowerCase();
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
  return items.sort((a, b) => {
    const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    return bTime - aTime;
  });
}

function parseSemicolonLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === ";" && !quoted) {
      fields.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  fields.push(current.trim());
  return fields;
}

function parseLocalizedNumber(value: string | undefined): number | null {
  if (!value) return null;
  const clean = value.replace(/[^0-9,.-]/g, "").trim();
  if (!clean) return null;

  let normalized = clean;
  if (clean.includes(",") && clean.includes(".")) {
    normalized = clean.replace(/\./g, "").replace(",", ".");
  } else if (clean.includes(",")) {
    normalized = clean.replace(",", ".");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCaixaGenerationDate(header: string): string | null {
  const match = header.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  const [, day, month, year] = match;
  return new Date(`${year}-${month}-${day}T12:00:00-03:00`).toISOString();
}

function extractNumber(description: string, expression: RegExp): number | null {
  const match = description.match(expression);
  return match?.[1] ? parseLocalizedNumber(match[1]) : null;
}

function extractArea(description: string): number | null {
  const privateArea = extractNumber(description, /([\d.,]+)\s+de área privativa/i);
  if (privateArea && privateArea > 0) return privateArea;

  const totalArea = extractNumber(description, /([\d.,]+)\s+de área total/i);
  if (totalArea && totalArea > 0) return totalArea;

  const landArea = extractNumber(description, /([\d.,]+)\s+de área do terreno/i);
  return landArea && landArea > 0 ? landArea : null;
}

function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function matchesSearch(item: PropertySearchItem, input: PropertySearchInput): boolean {
  if (input.city) {
    const city = normalizeSearchText(input.city);
    const haystack = normalizeSearchText(
      [item.location_city, item.location_address, item.title].filter(Boolean).join(" "),
    );
    if (!haystack.includes(city)) return false;
  }

  if (
    input.state &&
    normalizeSearchText(item.location_state) !== normalizeSearchText(input.state)
  ) {
    return false;
  }

  if (input.propertyType) {
    const expectedType = normalizeSearchText(input.propertyType);
    const actualType = normalizeSearchText(item.property_type);
    if (!actualType.includes(expectedType) && !expectedType.includes(actualType)) return false;
  }

  if (typeof input.minPrice === "number" && (item.price == null || item.price < input.minPrice)) {
    return false;
  }
  if (typeof input.maxPrice === "number" && (item.price == null || item.price > input.maxPrice)) {
    return false;
  }
  if (
    typeof input.bedrooms === "number" &&
    input.bedrooms > 0 &&
    (item.bedrooms == null || item.bedrooms < input.bedrooms)
  ) {
    return false;
  }
  if (
    typeof input.bathrooms === "number" &&
    input.bathrooms > 0 &&
    (item.bathrooms == null || item.bathrooms < input.bathrooms)
  ) {
    return false;
  }
  if (input.verifiedOnly && !item.is_verified) return false;

  return true;
}

async function fetchCaixaState(state: string): Promise<PropertySearchItem[]> {
  const cached = caixaCache.get(state);
  if (cached && cached.expiresAt > Date.now()) return cached.items;

  const url = `https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_${state}.csv`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/csv,text/plain;q=0.9,*/*;q=0.5",
        "User-Agent": "MercadoImobi/1.0 (+property-search)",
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) return [];

    const buffer = await response.arrayBuffer();
    const text = new TextDecoder("windows-1252").decode(buffer);
    const lines = text.split(/\r?\n/).filter((line) => line.trim().replace(/;/g, ""));
    if (lines.length < 3) return [];

    const generatedAt = parseCaixaGenerationDate(lines[0] ?? "");
    const items: PropertySearchItem[] = [];

    for (const line of lines.slice(2)) {
      const fields = parseSemicolonLine(line);
      if (fields.length < 12) continue;

      const [
        rawId,
        rawState,
        city,
        neighborhood,
        address,
        rawPrice,
        _evaluationValue,
        _discount,
        financing,
        description,
        saleMode,
        sourceUrl,
      ] = fields;

      const id = rawId?.trim();
      const source = sourceUrl?.trim();
      if (!id || !source?.startsWith("https://venda-imoveis.caixa.gov.br/")) continue;

      const propertyType = description?.split(",")[0]?.trim() || null;
      const bedroomsValue = description ? extractNumber(description, /(\d+)\s*qto\(s\)/i) : null;
      const bathroomsValue = description
        ? extractNumber(description, /(\d+)\s*(?:banheiro|wc)\(s\)?/i)
        : null;
      const area = description ? extractArea(description) : null;
      const details = [
        description?.trim(),
        saleMode ? `Modalidade: ${saleMode.trim()}` : null,
        financing ? `Financiamento: ${financing.trim()}` : null,
      ]
        .filter(Boolean)
        .join(" • ");

      items.push({
        id: `caixa-${id}`,
        title: `${propertyType ?? "Imóvel"} em ${city?.trim() || rawState?.trim() || "Brasil"}${neighborhood?.trim() ? ` — ${neighborhood.trim()}` : ""}`,
        description: details || null,
        price: parseLocalizedNumber(rawPrice),
        location_address: address?.trim() || null,
        location_city: city?.trim() || null,
        location_state: rawState?.trim() || state,
        property_type: propertyType,
        bedrooms: bedroomsValue == null ? null : Math.trunc(bedroomsValue),
        bathrooms: bathroomsValue == null ? null : Math.trunc(bathroomsValue),
        area_sqm: area,
        images: null,
        is_verified: true,
        source_portal: "Imóveis CAIXA",
        source_url: source,
        updated_at: generatedAt,
      });
    }

    caixaCache.set(state, {
      expiresAt: Date.now() + CAIXA_CACHE_TTL_MS,
      items,
    });
    return items;
  } catch {
    return [];
  }
}

async function fetchCaixaLiveSource(input: PropertySearchInput): Promise<PropertySearchItem[]> {
  const requestedState = input.state?.trim().toUpperCase();
  if (
    !requestedState ||
    !CAIXA_STATES.includes(requestedState as (typeof CAIXA_STATES)[number])
  ) {
    return [];
  }

  const items = await fetchCaixaState(requestedState);
  return items.filter((item) => matchesSearch(item, input));
}

async function fetchConfiguredLiveSource(
  input: PropertySearchInput,
): Promise<PropertySearchItem[]> {
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
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) return [];

    const json = await response.json();
    const candidates = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : [];
    const parsed = z.array(liveListingSchema).safeParse(candidates);
    if (!parsed.success) return [];

    return parsed.data.map((item, index) => ({
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
    }));
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
      indexQuery = indexQuery.ilike("location_city", `%${input.city}%`);
      propertyQuery = propertyQuery.ilike("location_city", `%${input.city}%`);
    }
    if (input.state) {
      const state = input.state.toUpperCase();
      indexQuery = indexQuery.eq("location_state", state);
      propertyQuery = propertyQuery.eq("location_state", state);
    }
    if (input.propertyType) {
      indexQuery = indexQuery.eq("property_type", input.propertyType);
      propertyQuery = propertyQuery.eq("property_type", input.propertyType);
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
    if (input.verifiedOnly) {
      indexQuery = indexQuery.eq("is_verified", true);
      propertyQuery = propertyQuery.eq("is_verified", true);
    }

    if (input.sort === "price_asc") {
      indexQuery = indexQuery.order("price", { ascending: true });
      propertyQuery = propertyQuery.order("price", { ascending: true });
    } else if (input.sort === "price_desc") {
      indexQuery = indexQuery.order("price", { ascending: false });
      propertyQuery = propertyQuery.order("price", { ascending: false });
    } else {
      indexQuery = indexQuery.order("scanned_at", { ascending: false });
      propertyQuery = propertyQuery.order("updated_at", { ascending: false });
    }

    const limit = input.limit ?? 30;
    indexQuery = indexQuery.limit(limit);
    propertyQuery = propertyQuery.limit(limit);

    const [indexResult, propertyResult, configuredLiveItems, caixaItems] = await Promise.all([
      indexQuery,
      propertyQuery,
      fetchConfiguredLiveSource(input),
      fetchCaixaLiveSource(input),
    ]);

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

    if (
      indexResult.error &&
      propertyResult.error &&
      configuredLiveItems.length === 0 &&
      caixaItems.length === 0
    ) {
      throw new Error("SEARCH_UNAVAILABLE");
    }

    const deduped = new Map<string, PropertySearchItem>();
    for (const item of [...configuredLiveItems, ...caixaItems, ...indexed, ...saved]) {
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
      .limit(12);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
