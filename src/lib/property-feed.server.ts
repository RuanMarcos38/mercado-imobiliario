import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type PropertyFeedFormat = "xml" | "json";

export interface NormalizedFeedProperty {
  id: string | null;
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
  images: string[];
  source_url: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_whatsapp: string | null;
  contact_email: string | null;
}

const MAX_FEED_BYTES = 15 * 1024 * 1024;
const MAX_ITEMS_PER_SYNC = 5000;

function cleanText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
}

function cleanNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
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

function integer(value: unknown): number | null {
  const parsed = cleanNumber(value);
  return parsed == null ? null : Math.trunc(parsed);
}

function normalizePhone(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const digits = text.replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, "/")
    .trim();
}

function stableKey(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isPrivateIpv4(hostname: string) {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export function assertPublicFeedUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("A fonte precisa usar HTTP ou HTTPS.");
  if (url.username || url.password)
    throw new Error("Não informe usuário ou senha diretamente no endereço da fonte.");
  const hostname = url.hostname.toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname === "::1" ||
    isPrivateIpv4(hostname)
  ) {
    throw new Error("O endereço informado não é uma fonte pública válida.");
  }
  return url;
}

async function fetchPublicFeed(urlValue: string) {
  let current = assertPublicFeedUrl(urlValue);

  for (let redirect = 0; redirect < 5; redirect += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        Accept: "application/json, application/xml, text/xml, text/plain;q=0.9, */*;q=0.5",
        "User-Agent": "MercadoImobi-AuthorizedFeed/1.0",
      },
      signal: AbortSignal.timeout(25_000),
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("A fonte redirecionou para um endereço inválido.");
      current = assertPublicFeedUrl(new URL(location, current).toString());
      continue;
    }

    if (!response.ok) throw new Error(`A fonte respondeu com status ${response.status}.`);
    const length = Number(response.headers.get("content-length") || "0");
    if (length > MAX_FEED_BYTES)
      throw new Error("O arquivo da fonte é maior que o limite permitido.");
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_FEED_BYTES) {
      throw new Error("O arquivo da fonte é maior que o limite permitido.");
    }
    return {
      text,
      finalUrl: current.toString(),
      contentType: response.headers.get("content-type") || "",
    };
  }

  throw new Error("A fonte possui redirecionamentos demais.");
}

function valueAt(source: unknown, paths: string[]): unknown {
  for (const path of paths) {
    let current: unknown = source;
    let failed = false;
    for (const part of path.split(".")) {
      if (!current || typeof current !== "object" || !(part in current)) {
        failed = true;
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }
    if (!failed && current != null && current !== "") return current;
  }
  return null;
}

function firstUrl(value: unknown, baseUrl: string): string | null {
  const candidates: unknown[] = Array.isArray(value) ? value : value == null ? [] : [value];
  for (const candidate of candidates) {
    let raw: unknown = candidate;
    if (candidate && typeof candidate === "object") {
      raw = valueAt(candidate, ["url", "src", "href", "link", "URL", "Url"]);
    }
    const text = cleanText(raw);
    if (!text) continue;
    try {
      const resolved = new URL(text, baseUrl);
      if (["http:", "https:"].includes(resolved.protocol)) return resolved.toString();
    } catch {
      // Ignore malformed optional media URLs.
    }
  }
  return null;
}

function imageUrls(value: unknown, baseUrl: string): string[] {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  const urls = new Set<string>();
  for (const item of list) {
    const url = firstUrl(item, baseUrl);
    if (url) urls.add(url);
    if (urls.size >= 30) break;
  }
  return Array.from(urls);
}

function normalizeJsonItem(
  item: unknown,
  index: number,
  feedUrl: string,
): NormalizedFeedProperty | null {
  if (!item || typeof item !== "object") return null;
  const id = cleanText(
    valueAt(item, ["id", "listingId", "listing_id", "code", "codigo", "reference", "ref"]),
  );
  const propertyType = cleanText(
    valueAt(item, [
      "property_type",
      "propertyType",
      "type",
      "tipo",
      "details.propertyType",
      "details.type",
    ]),
  );
  const city = cleanText(
    valueAt(item, [
      "location_city",
      "city",
      "cidade",
      "address.city",
      "location.city",
      "location.City",
    ]),
  );
  const state =
    cleanText(
      valueAt(item, [
        "location_state",
        "state",
        "uf",
        "address.state",
        "location.state",
        "location.State",
      ]),
    )
      ?.slice(0, 2)
      .toUpperCase() || null;
  const title =
    cleanText(valueAt(item, ["title", "titulo", "name", "nome", "headline"])) ||
    [propertyType || "Imóvel", city ? `em ${city}` : null].filter(Boolean).join(" ");
  if (!title) return null;
  const price = cleanNumber(
    valueAt(item, [
      "price",
      "listPrice",
      "sale_price",
      "salePrice",
      "preco",
      "pricing.sale",
      "pricing.price",
    ]),
  );
  const explicitUrl = cleanText(
    valueAt(item, ["source_url", "url", "link", "listingUrl", "webpage", "details.url"]),
  );
  let sourceUrl: string;
  try {
    sourceUrl = explicitUrl
      ? new URL(explicitUrl, feedUrl).toString()
      : `${feedUrl}#listing=${encodeURIComponent(id || stableKey(`${title}|${city || ""}|${state || ""}|${price ?? ""}|${index}`))}`;
  } catch {
    sourceUrl = `${feedUrl}#listing=${encodeURIComponent(id || stableKey(`${title}|${index}`))}`;
  }

  const media = valueAt(item, [
    "images",
    "photos",
    "media",
    "medias",
    "imagens",
    "gallery",
    "details.images",
  ]);
  const directImage = firstUrl(
    valueAt(item, ["image", "image_url", "photo", "thumbnail"]),
    feedUrl,
  );
  const images = new Set(imageUrls(media, feedUrl));
  if (directImage) images.add(directImage);

  return {
    id,
    title,
    description: cleanText(
      valueAt(item, ["description", "descricao", "details.description", "details.Description"]),
    ),
    price,
    location_address: cleanText(
      valueAt(item, [
        "location_address",
        "address",
        "endereco",
        "address.street",
        "location.address",
        "location.Address",
      ]),
    ),
    location_city: city,
    location_state: state,
    property_type: propertyType,
    bedrooms: integer(
      valueAt(item, ["bedrooms", "rooms", "quartos", "details.bedrooms", "details.Bedrooms"]),
    ),
    bathrooms: integer(
      valueAt(item, ["bathrooms", "banheiros", "details.bathrooms", "details.Bathrooms"]),
    ),
    area_sqm: cleanNumber(
      valueAt(item, [
        "area_sqm",
        "area",
        "livingArea",
        "usableArea",
        "details.livingArea",
        "details.LivingArea",
      ]),
    ),
    images: Array.from(images).slice(0, 30),
    source_url: sourceUrl,
    contact_name: cleanText(
      valueAt(item, ["contact_name", "contact.name", "contactName", "contato.nome"]),
    ),
    contact_phone: normalizePhone(
      valueAt(item, [
        "contact_phone",
        "phone",
        "contact.phone",
        "contact.telephone",
        "contato.telefone",
      ]),
    ),
    contact_whatsapp: normalizePhone(
      valueAt(item, ["contact_whatsapp", "whatsapp", "contact.whatsapp", "contato.whatsapp"]),
    ),
    contact_email: cleanText(
      valueAt(item, ["contact_email", "email", "contact.email", "contato.email"]),
    ),
  };
}

function jsonItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const object = payload as Record<string, unknown>;
  for (const key of ["items", "listings", "properties", "imoveis", "results", "data"]) {
    const value = object[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      for (const nested of ["items", "listings", "properties", "results"]) {
        const nestedValue = (value as Record<string, unknown>)[nested];
        if (Array.isArray(nestedValue)) return nestedValue;
      }
    }
  }
  return [];
}

function xmlTag(block: string, names: string[]) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = block.match(
      new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"),
    );
    if (match?.[1]) {
      const decoded = decodeXml(match[1]);
      return cleanText(decoded.replace(/<[^>]+>/g, " "));
    }
  }
  return null;
}

function xmlBlocks(text: string) {
  for (const tag of ["Listing", "Imovel", "Property", "Imóvel"]) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = Array.from(
      text.matchAll(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "gi")),
    );
    if (matches.length > 0) return matches.map((match) => match[1] || "");
  }
  return [];
}

function xmlUrls(block: string, baseUrl: string) {
  const urls = new Set<string>();
  const patterns = [
    /<(?:URL|Url|url|Image|Photo|Foto|Link)(?:\s[^>]*)?>([\s\S]*?)<\/(?:URL|Url|url|Image|Photo|Foto|Link)>/gi,
    /(?:url|src|href)=["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of block.matchAll(pattern)) {
      const raw = cleanText(decodeXml(match[1] || ""));
      if (!raw) continue;
      try {
        const url = new URL(raw, baseUrl);
        if (["http:", "https:"].includes(url.protocol)) urls.add(url.toString());
      } catch {
        // Ignore malformed optional URLs.
      }
      if (urls.size >= 30) break;
    }
  }
  return Array.from(urls);
}

function normalizeXmlItem(
  block: string,
  index: number,
  feedUrl: string,
): NormalizedFeedProperty | null {
  const id = xmlTag(block, [
    "ListingID",
    "ListingId",
    "ID",
    "CodigoImovel",
    "Codigo",
    "Reference",
    "Referencia",
  ]);
  const propertyType = xmlTag(block, ["PropertyType", "TipoImovel", "Tipo", "Category"]);
  const city = xmlTag(block, ["City", "Cidade"]);
  const state = xmlTag(block, ["State", "UF", "Estado"])?.slice(0, 2).toUpperCase() || null;
  const title =
    xmlTag(block, ["Title", "Titulo", "Name", "Nome"]) ||
    [propertyType || "Imóvel", city ? `em ${city}` : null].filter(Boolean).join(" ");
  if (!title) return null;
  const price = cleanNumber(
    xmlTag(block, ["ListPrice", "SalePrice", "Price", "PrecoVenda", "Preco"]),
  );
  const listingUrl = xmlTag(block, [
    "ListingUrl",
    "Website",
    "WebPage",
    "SourceUrl",
    "UrlAnuncio",
    "LinkAnuncio",
  ]);
  let sourceUrl: string;
  try {
    sourceUrl = listingUrl
      ? new URL(listingUrl, feedUrl).toString()
      : `${feedUrl}#listing=${encodeURIComponent(id || stableKey(`${title}|${city || ""}|${state || ""}|${price ?? ""}|${index}`))}`;
  } catch {
    sourceUrl = `${feedUrl}#listing=${encodeURIComponent(id || stableKey(`${title}|${index}`))}`;
  }

  return {
    id,
    title,
    description: xmlTag(block, ["Description", "Descricao", "Observations", "Observacoes"]),
    price,
    location_address: xmlTag(block, ["Address", "StreetAddress", "Endereco", "Logradouro"]),
    location_city: city,
    location_state: state,
    property_type: propertyType,
    bedrooms: integer(xmlTag(block, ["Bedrooms", "Quartos", "Dormitories", "Dormitorios"])),
    bathrooms: integer(xmlTag(block, ["Bathrooms", "Banheiros"])),
    area_sqm: cleanNumber(
      xmlTag(block, ["LivingArea", "UsableArea", "AreaUtil", "AreaPrivativa", "Area"]),
    ),
    images: xmlUrls(block, feedUrl),
    source_url: sourceUrl,
    contact_name: xmlTag(block, ["ContactName", "NomeContato", "Name"]),
    contact_phone: normalizePhone(xmlTag(block, ["Telephone", "Phone", "Telefone"])),
    contact_whatsapp: normalizePhone(xmlTag(block, ["Whatsapp", "WhatsApp"])),
    contact_email: xmlTag(block, ["Email", "ContactEmail"]),
  };
}

export async function readAuthorizedPropertyFeed(input: {
  feedUrl: string;
  format: PropertyFeedFormat;
}) {
  const fetched = await fetchPublicFeed(input.feedUrl);
  let items: NormalizedFeedProperty[] = [];

  if (input.format === "json") {
    const payload = JSON.parse(fetched.text) as unknown;
    items = jsonItems(payload)
      .slice(0, MAX_ITEMS_PER_SYNC)
      .map((item, index) => normalizeJsonItem(item, index, fetched.finalUrl))
      .filter((item): item is NormalizedFeedProperty => Boolean(item));
  } else {
    const blocks = xmlBlocks(fetched.text);
    items = blocks
      .slice(0, MAX_ITEMS_PER_SYNC)
      .map((block, index) => normalizeXmlItem(block, index, fetched.finalUrl))
      .filter((item): item is NormalizedFeedProperty => Boolean(item));
  }

  const unique = new Map<string, NormalizedFeedProperty>();
  for (const item of items) unique.set(item.source_url, item);
  const normalized = Array.from(unique.values());
  if (normalized.length === 0) {
    throw new Error("A fonte respondeu, mas nenhum imóvel compatível foi encontrado no arquivo.");
  }

  return {
    items: normalized,
    finalUrl: fetched.finalUrl,
    contentType: fetched.contentType,
  };
}

export async function syncAuthorizedFeedConnection(
  connectionId: string,
  expectedTenantId?: string,
) {
  const db = supabaseAdmin as any;
  const { data: connection, error: connectionError } = await db
    .from("property_source_connections")
    .select("id,tenant_id,source_code,name,status,connection_type,public_config")
    .eq("id", connectionId)
    .single();
  if (connectionError || !connection) throw new Error("Conexão de imóveis não encontrada.");
  if (expectedTenantId && connection.tenant_id !== expectedTenantId)
    throw new Error("Conexão não pertence a esta conta.");

  const format = connection.public_config?.format as PropertyFeedFormat | undefined;
  const feedUrl = cleanText(connection.public_config?.feedUrl);
  if (!feedUrl || (format !== "xml" && format !== "json"))
    throw new Error("A conexão não possui uma fonte XML/JSON válida.");

  const { data: source } = await db
    .from("property_source_catalog")
    .select("code,name")
    .eq("code", connection.source_code)
    .maybeSingle();
  if (!source) throw new Error("Fonte imobiliária não cadastrada.");

  const now = new Date().toISOString();
  const { data: run } = await db
    .from("property_scan_runs")
    .insert({
      source_code: connection.source_code,
      connection_id: connection.id,
      status: "running",
      started_at: now,
    })
    .select("id")
    .single();
  const runId = run?.id as string | undefined;

  try {
    const feed = await readAuthorizedPropertyFeed({ feedUrl, format });
    let upserted = 0;

    for (let offset = 0; offset < feed.items.length; offset += 400) {
      const chunk = feed.items.slice(offset, offset + 400).map((item) => ({
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
        images: item.images.length ? item.images : null,
        source_url: item.source_url,
        source_portal: source.name,
        is_verified: false,
        scanned_at: now,
        listing_market: "market",
        is_auction: false,
        contact_name: item.contact_name,
        contact_phone: item.contact_phone,
        contact_whatsapp: item.contact_whatsapp,
        contact_email: item.contact_email,
        source_property_id: item.id,
        last_seen_at: now,
        metadata: {
          source: connection.source_code,
          source_connection: connection.id,
          authorized_feed: true,
          feed_format: format,
        },
      }));

      const result = await db
        .from("property_search_index")
        .upsert(chunk, { onConflict: "source_url" });
      if (result.error) throw new Error(result.error.message);
      upserted += chunk.length;
    }

    await db
      .from("property_source_connections")
      .update({
        status: "connected",
        last_sync_at: now,
        last_success_at: now,
        last_error: null,
        public_config: {
          ...connection.public_config,
          feedUrl: feed.finalUrl,
          format,
          lastItemCount: feed.items.length,
        },
        updated_at: now,
      })
      .eq("id", connection.id);

    if (runId) {
      await db
        .from("property_scan_runs")
        .update({
          status: "success",
          discovered_count: feed.items.length,
          updated_count: upserted,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }

    return { success: true, count: feed.items.length, upserted };
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "Falha ao sincronizar a fonte.";
    await db
      .from("property_source_connections")
      .update({ status: "error", last_sync_at: now, last_error: message, updated_at: now })
      .eq("id", connection.id);
    if (runId) {
      await db
        .from("property_scan_runs")
        .update({ status: "failed", error_summary: message, finished_at: new Date().toISOString() })
        .eq("id", runId);
    }
    throw error;
  }
}

export async function syncAllAuthorizedFeeds(limit = 20) {
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("property_source_connections")
    .select("id")
    .in("status", ["connected", "error"])
    .like("connection_type", "authorized_%_feed")
    .order("last_sync_at", { ascending: true, nullsFirst: true })
    .limit(Math.max(1, Math.min(limit, 50)));
  if (error) throw new Error(error.message);

  const results: Array<{ id: string; success: boolean; count?: number; error?: string }> = [];
  for (const row of data ?? []) {
    try {
      const result = await syncAuthorizedFeedConnection(row.id);
      results.push({ id: row.id, success: true, count: result.count });
    } catch (syncError) {
      results.push({
        id: row.id,
        success: false,
        error:
          syncError instanceof Error ? syncError.message.slice(0, 200) : "Falha de sincronização",
      });
    }
  }
  return results;
}
