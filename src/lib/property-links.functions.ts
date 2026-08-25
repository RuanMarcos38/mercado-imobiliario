import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertPublicFeedUrl } from "@/lib/property-feed.server";
import { requireTenantId } from "@/lib/tenant.server";

const linkSchema = z.object({ url: z.string().trim().url().max(2000) });
const linkIdSchema = z.object({ id: z.string().uuid() });

export interface ExternalPropertyLinkItem {
  id: string;
  url: string;
  host: string;
  status: string;
  title: string | null;
  lastCheckedAt: string | null;
  nextSyncAt: string;
  lastHttpStatus: number | null;
  lastError: string | null;
  createdAt: string;
}

type ExtractedProperty = {
  title: string;
  description: string | null;
  price: number | null;
  city: string | null;
  state: string | null;
  address: string | null;
  propertyType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  images: string[];
  isRealEstate: boolean;
};

function cleanText(value: unknown) {
  if (value == null) return null;
  return String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || null;
}

function numeric(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = cleanText(value);
  if (!text) return null;
  const normalized = text
    .replace(/R\$/gi, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".")
    .replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function meta(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expressions = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const expression of expressions) {
    const match = html.match(expression);
    if (match?.[1]) return match[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
  }
  return null;
}

function jsonLdObjects(html: string) {
  const values: any[] = [];
  const expression = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(expression)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) values.push(...parsed);
      else values.push(parsed);
    } catch {
      // Ignore malformed structured data and continue with public meta tags.
    }
  }
  return values;
}

function flattenObjects(value: any, output: any[] = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) flattenObjects(item, output);
    return output;
  }
  output.push(value);
  for (const child of Object.values(value)) flattenObjects(child, output);
  return output;
}

function propertyKeywordText(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\b(imovel|apartamento|casa|sobrado|terreno|lote|studio|residencial|condominio|quarto|dormitorio|suite|m2|corretor|venda|aluguel)\b/.test(
    normalized,
  );
}

function extractFromHtml(html: string, url: URL): ExtractedProperty {
  const objects = jsonLdObjects(html).flatMap((value) => flattenObjects(value));
  const candidate = objects.find((item) => {
    const type = Array.isArray(item?.["@type"])
      ? item["@type"].join(" ")
      : String(item?.["@type"] || "");
    return /Apartment|House|Residence|SingleFamilyResidence|Accommodation|Product|Offer|RealEstate/i.test(
      type,
    );
  });
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null;
  const title =
    cleanText(meta(html, "og:title")) || cleanText(candidate?.name) || cleanText(titleTag) || url.hostname;
  const description =
    cleanText(meta(html, "og:description")) ||
    cleanText(meta(html, "description")) ||
    cleanText(candidate?.description);
  const offer = candidate?.offers && typeof candidate.offers === "object" ? candidate.offers : null;
  const price =
    numeric(meta(html, "product:price:amount")) ?? numeric(offer?.price) ?? numeric(candidate?.price) ?? null;
  const addressObject =
    candidate?.address && typeof candidate.address === "object" ? candidate.address : null;
  const address =
    cleanText(addressObject?.streetAddress) || cleanText(candidate?.address) || cleanText(meta(html, "place:location:address"));
  const city = cleanText(addressObject?.addressLocality);
  const state = cleanText(addressObject?.addressRegion);
  const typeRaw = Array.isArray(candidate?.["@type"])
    ? candidate["@type"][0]
    : candidate?.["@type"];
  const propertyType = cleanText(typeRaw);
  const bedrooms =
    numeric(candidate?.numberOfBedrooms) ?? numeric(candidate?.numberOfRooms) ?? numeric(candidate?.bedrooms);
  const bathrooms = numeric(candidate?.numberOfBathroomsTotal) ?? numeric(candidate?.bathrooms);
  const areaSqm =
    numeric(candidate?.floorSize?.value) ?? numeric(candidate?.floorSize) ?? numeric(candidate?.area);
  const images = new Set<string>();
  const ogImage = meta(html, "og:image");
  if (ogImage) images.add(new URL(ogImage, url).toString());
  const candidateImages = Array.isArray(candidate?.image) ? candidate.image : [candidate?.image];
  for (const image of candidateImages) {
    const value = typeof image === "string" ? image : image?.url;
    if (!value) continue;
    try {
      images.add(new URL(String(value), url).toString());
    } catch {
      // Ignore invalid image references.
    }
  }
  const combined = `${title || ""} ${description || ""} ${propertyType || ""}`;
  return {
    title: title || url.hostname,
    description: description || null,
    price,
    city,
    state,
    address,
    propertyType,
    bedrooms: bedrooms == null ? null : Math.trunc(bedrooms),
    bathrooms: bathrooms == null ? null : Math.trunc(bathrooms),
    areaSqm,
    images: [...images].slice(0, 20),
    isRealEstate: propertyKeywordText(combined),
  };
}

async function aiEnhanceProperty(html: string, url: string, current: ExtractedProperty) {
  const apiKey = process.env["OPENAI_API_KEY"]?.trim();
  if (!apiKey) return current;
  const snippet = cleanText(html)?.slice(0, 12_000) || "";
  if (!snippet) return current;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env["OPENAI_MODEL"] || "gpt-5.6",
        store: false,
        instructions:
          "Extraia somente dados explicitamente presentes no anúncio imobiliário. Responda APENAS JSON válido com: isRealEstate, title, description, price, city, state, address, propertyType, bedrooms, bathrooms, areaSqm. Nunca invente dados.",
        input: `URL: ${url}\n\nConteúdo público da página:\n${snippet}`,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return current;
    const payload = (await response.json()) as any;
    const text = (payload?.output ?? [])
      .flatMap((item: any) => item?.content ?? [])
      .filter((item: any) => item?.type === "output_text")
      .map((item: any) => item?.text || "")
      .join("\n")
      .trim()
      .replace(/^```json\s*|\s*```$/g, "");
    const parsed = JSON.parse(text);
    return {
      ...current,
      title: cleanText(parsed.title) || current.title,
      description: cleanText(parsed.description) || current.description,
      price: numeric(parsed.price) ?? current.price,
      city: cleanText(parsed.city) || current.city,
      state: cleanText(parsed.state) || current.state,
      address: cleanText(parsed.address) || current.address,
      propertyType: cleanText(parsed.propertyType) || current.propertyType,
      bedrooms: numeric(parsed.bedrooms) == null ? current.bedrooms : Math.trunc(Number(parsed.bedrooms)),
      bathrooms:
        numeric(parsed.bathrooms) == null ? current.bathrooms : Math.trunc(Number(parsed.bathrooms)),
      areaSqm: numeric(parsed.areaSqm) ?? current.areaSqm,
      isRealEstate: parsed.isRealEstate === true || current.isRealEstate,
    } satisfies ExtractedProperty;
  } catch {
    return current;
  }
}

async function fetchPublicPage(urlValue: string) {
  let current = assertPublicFeedUrl(urlValue);
  for (let redirect = 0; redirect < 5; redirect += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "User-Agent": "MercadoImobi-LinkMonitor/1.0 (+public-listing-monitor)",
      },
      signal: AbortSignal.timeout(25_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return { response, url: current, html: "" };
      current = assertPublicFeedUrl(new URL(location, current).toString());
      continue;
    }
    const length = Number(response.headers.get("content-length") || "0");
    if (length > 5 * 1024 * 1024) throw new Error("A página do anúncio excede o limite seguro de leitura.");
    const html = response.ok ? (await response.text()).slice(0, 5 * 1024 * 1024) : "";
    return { response, url: current, html };
  }
  throw new Error("O anúncio redirecionou muitas vezes.");
}

async function syncLink(row: any) {
  const db = supabaseAdmin as any;
  const now = new Date().toISOString();
  try {
    const fetched = await fetchPublicPage(String(row.source_url));
    const status = fetched.response.status;
    if ([404, 410].includes(status)) {
      await db
        .from("property_search_index")
        .delete()
        .eq("source_url", row.source_url)
        .contains("metadata", { external_link_id: row.id });
      await db
        .from("property_external_links")
        .update({
          status: "removed",
          last_http_status: status,
          last_checked_at: now,
          next_sync_at: new Date(Date.now() + 60 * 60_000).toISOString(),
          last_error: "Anúncio removido ou indisponível no portal de origem.",
          updated_at: now,
        })
        .eq("id", row.id);
      return { id: String(row.id), status: "removed" };
    }
    if ([401, 403, 429].includes(status)) {
      const partnerRequired = /(^|\.)(olx\.com\.br|mercadolivre\.com\.br|mercadolibre\.com)/i.test(
        fetched.url.hostname,
      );
      const nextStatus = partnerRequired ? "partner_required" : "unavailable";
      await db
        .from("property_external_links")
        .update({
          status: nextStatus,
          last_http_status: status,
          last_checked_at: now,
          next_sync_at: new Date(Date.now() + 60 * 60_000).toISOString(),
          last_error: partnerRequired
            ? "O portal exige integração oficial/autorizada para leitura automatizada deste anúncio."
            : `Portal respondeu HTTP ${status}.`,
          updated_at: now,
        })
        .eq("id", row.id);
      return { id: String(row.id), status: nextStatus };
    }
    if (!fetched.response.ok) throw new Error(`Portal respondeu HTTP ${status}.`);

    let extracted = extractFromHtml(fetched.html, fetched.url);
    extracted = await aiEnhanceProperty(fetched.html, fetched.url.toString(), extracted);
    if (!extracted.isRealEstate) {
      await db
        .from("property_external_links")
        .update({
          status: "unavailable",
          last_http_status: status,
          last_checked_at: now,
          next_sync_at: new Date(Date.now() + 60 * 60_000).toISOString(),
          last_error: "A página pública não contém evidência suficiente de anúncio imobiliário.",
          extracted_data: extracted,
          updated_at: now,
        })
        .eq("id", row.id);
      return { id: String(row.id), status: "unavailable" };
    }

    const fingerprint = createHash("sha256").update(JSON.stringify(extracted)).digest("hex");
    const portal = fetched.url.hostname.replace(/^www\./, "");
    const { data: indexed, error: indexError } = await db
      .from("property_search_index")
      .upsert(
        {
          title: extracted.title,
          description: extracted.description,
          price: extracted.price,
          location_city: extracted.city,
          location_state: extracted.state,
          location_address: extracted.address,
          property_type: extracted.propertyType,
          bedrooms: extracted.bedrooms,
          bathrooms: extracted.bathrooms,
          area_sqm: extracted.areaSqm,
          images: extracted.images,
          source_url: fetched.url.toString(),
          source_portal: portal,
          is_verified: false,
          scanned_at: now,
          last_seen_at: now,
          metadata: {
            external_import: true,
            external_link_id: String(row.id),
            monitored_hourly: true,
          },
          listing_market: "market",
          is_auction: false,
          sale_mode: "market",
        },
        { onConflict: "source_url" },
      )
      .select("id")
      .single();
    if (indexError) throw new Error(indexError.message);

    await db
      .from("property_external_links")
      .update({
        source_url: fetched.url.toString(),
        source_host: portal,
        status: "active",
        title: extracted.title,
        property_index_id: indexed.id,
        fingerprint,
        last_http_status: status,
        last_checked_at: now,
        next_sync_at: new Date(Date.now() + 60 * 60_000).toISOString(),
        last_error: null,
        extracted_data: extracted,
        updated_at: now,
      })
      .eq("id", row.id);
    return { id: String(row.id), status: "active" };
  } catch (error) {
    await db
      .from("property_external_links")
      .update({
        status: "error",
        last_checked_at: now,
        next_sync_at: new Date(Date.now() + 60 * 60_000).toISOString(),
        last_error: error instanceof Error ? error.message.slice(0, 500) : "Falha ao consultar anúncio.",
        updated_at: now,
      })
      .eq("id", row.id);
    return { id: String(row.id), status: "error" };
  }
}

function mapRow(row: any): ExternalPropertyLinkItem {
  return {
    id: String(row.id),
    url: String(row.source_url),
    host: String(row.source_host),
    status: String(row.status),
    title: row.title ? String(row.title) : null,
    lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : null,
    nextSyncAt: String(row.next_sync_at),
    lastHttpStatus: row.last_http_status == null ? null : Number(row.last_http_status),
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: String(row.created_at),
  };
}

export const listExternalPropertyLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ExternalPropertyLinkItem[]> => {
    const tenantId = await requireTenantId(context.supabase as any, context.userId);
    const { data, error } = await (context.supabase as any)
      .from("property_external_links")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapRow);
  });

export const registerExternalPropertyLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => linkSchema.parse(data))
  .handler(async ({ context, data }) => {
    const tenantId = await requireTenantId(context.supabase as any, context.userId);
    const url = assertPublicFeedUrl(data.url);
    const { data: row, error } = await (context.supabase as any)
      .from("property_external_links")
      .upsert(
        {
          tenant_id: tenantId,
          created_by: context.userId,
          source_url: url.toString(),
          source_host: url.hostname.replace(/^www\./, ""),
          status: "pending",
          next_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,source_url" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const result = await syncLink(row);
    const { data: refreshed } = await (context.supabase as any)
      .from("property_external_links")
      .select("*")
      .eq("id", row.id)
      .single();
    return { item: mapRow(refreshed || row), syncStatus: result.status };
  });

export const syncExternalPropertyLinkNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => linkIdSchema.parse(data))
  .handler(async ({ context, data }) => {
    const tenantId = await requireTenantId(context.supabase as any, context.userId);
    const { data: row, error } = await (context.supabase as any)
      .from("property_external_links")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Link não encontrado.");
    return syncLink(row);
  });

export async function syncDueExternalPropertyLinks(limit = 100) {
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("property_external_links")
    .select("*")
    .in("status", ["pending", "active", "unavailable", "error", "partner_required"])
    .lte("next_sync_at", new Date().toISOString())
    .order("next_sync_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  const results = [];
  for (const row of data ?? []) results.push(await syncLink(row));
  return {
    processed: results.length,
    active: results.filter((item) => item.status === "active").length,
    removed: results.filter((item) => item.status === "removed").length,
    partnerRequired: results.filter((item) => item.status === "partner_required").length,
    failed: results.filter((item) => item.status === "error").length,
  };
}
