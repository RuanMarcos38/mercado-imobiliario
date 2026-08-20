import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type JsonObject = Record<string, unknown>;
type Coordinates = { lat: number; lng: number };
type LocationPrecision = "address" | "neighborhood" | "city";
type ResolvedCoordinates = Coordinates & {
  provider: "google" | "openstreetmap";
  precision: LocationPrecision;
  query: string;
};
type AmenityCounts = {
  schools: number;
  health: number;
  supermarkets: number;
  parks: number;
  transit: number;
};

const EMPTY_AMENITIES: AmenityCounts = {
  schools: 0,
  health: 0,
  supermarkets: 0,
  parks: 0,
  transit: 0,
};

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

const analysisSchema = z.object({
  address: z.string().trim().max(250).optional(),
  neighborhood: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2).max(120),
  state: z.string().trim().length(2),
  requestNonce: z.number().int().nonnegative().optional(),
});

export interface LocationAnalysisResult {
  query: { address: string; neighborhood: string; city: string; state: string };
  analyzedAt: string;
  coordinates: { lat: number; lng: number } | null;
  score: number;
  classification: string;
  summary: string;
  infrastructure: {
    available: boolean;
    provider: "google" | "openstreetmap" | "none";
    radiusMeters: number;
    schools: number;
    health: number;
    supermarkets: number;
    parks: number;
    transit: number;
  };
  demographics: {
    municipalityCode: string | null;
    municipalityName: string | null;
    population2022: number | null;
  };
  market: {
    sampleSize: number;
    medianPrice: number | null;
    medianPricePerSqm: number | null;
    averagePrice: number | null;
    p25Price: number | null;
    p75Price: number | null;
    recentListings90d: number;
    sourceCount: number;
    latestSeenAt: string | null;
    scope: "bairro" | "cidade";
  };
  components: {
    infrastructure: number;
    liquidity: number;
    marketEvidence: number;
    dataConfidence: number;
  };
  sources: string[];
  caveat: string;
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function finiteOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildLocationGeocodeCandidates(input: {
  address?: string;
  neighborhood?: string;
  city: string;
  state: string;
}): Array<{ query: string; precision: LocationPrecision }> {
  const address = input.address?.trim() ?? "";
  const neighborhood = input.neighborhood?.trim() ?? "";
  const city = input.city.trim();
  const state = input.state.trim().toUpperCase();
  const seen = new Set<string>();
  const candidates: Array<{ query: string; precision: LocationPrecision }> = [];
  const push = (parts: string[], precision: LocationPrecision) => {
    const query = parts.filter(Boolean).join(", ");
    const key = normalizeText(query);
    if (!query || seen.has(key)) return;
    seen.add(key);
    candidates.push({ query, precision });
  };

  if (address && neighborhood) push([address, neighborhood, city, state, "Brasil"], "address");
  if (address) push([address, city, state, "Brasil"], "address");
  if (neighborhood) push([neighborhood, city, state, "Brasil"], "neighborhood");
  if (!address && !neighborhood) push(["Centro", city, state, "Brasil"], "city");
  push([city, state, "Brasil"], "city");
  return candidates;
}

export function hasAmenitySignal(amenities: AmenityCounts) {
  return (
    amenities.schools +
      amenities.health +
      amenities.supermarkets +
      amenities.parks +
      amenities.transit >
    0
  );
}

async function googleGeocode(query: string, key: string): Promise<Coordinates | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("key", key);
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("region", "br");
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!response.ok) return null;
  const payload = object(await response.json().catch(() => ({})));
  const results = Array.isArray(payload["results"]) ? payload["results"] : [];
  const first = object(results[0]);
  const geometry = object(first["geometry"]);
  const location = object(geometry["location"]);
  const lat = Number(location["lat"]);
  const lng = Number(location["lng"]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

async function osmGeocode(query: string): Promise<Coordinates | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "br");
  const response = await fetch(url, {
    headers: { "User-Agent": "MercadoImobi/1.0 location-analysis" },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => [])) as unknown;
  if (!Array.isArray(payload) || !payload.length) return null;
  const first = object(payload[0]);
  const lat = Number(first["lat"]);
  const lng = Number(first["lon"]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

async function resolveCoordinates(
  candidates: Array<{ query: string; precision: LocationPrecision }>,
  googleKey: string | undefined,
): Promise<ResolvedCoordinates | null> {
  if (googleKey) {
    for (const candidate of candidates) {
      const coordinates = await googleGeocode(candidate.query, googleKey).catch(() => null);
      if (coordinates) return { ...coordinates, ...candidate, provider: "google" };
    }
  }

  for (const candidate of candidates) {
    const coordinates = await osmGeocode(candidate.query).catch(() => null);
    if (coordinates) return { ...coordinates, ...candidate, provider: "openstreetmap" };
  }

  return null;
}

async function googleNearbyCount(
  key: string,
  coordinates: Coordinates,
  types: string[],
  radius = 2200,
) {
  const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id",
      "Cache-Control": "no-cache",
    },
    body: JSON.stringify({
      includedTypes: types,
      maxResultCount: 20,
      languageCode: "pt-BR",
      regionCode: "BR",
      locationRestriction: {
        circle: {
          center: { latitude: coordinates.lat, longitude: coordinates.lng },
          radius,
        },
      },
    }),
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (!response.ok) return 0;
  const payload = object(await response.json().catch(() => ({})));
  return Array.isArray(payload["places"]) ? payload["places"].length : 0;
}

function countOsmAmenities(elements: unknown[]): AmenityCounts {
  const unique = new Set<string>();
  const counts = { ...EMPTY_AMENITIES };
  for (const raw of elements) {
    const item = object(raw);
    const key = `${String(item["type"] ?? "")}:${String(item["id"] ?? "")}`;
    if (unique.has(key)) continue;
    unique.add(key);
    const tags = object(item["tags"]);
    const amenity = String(tags["amenity"] ?? "");
    if (["school", "college", "university"].includes(amenity)) counts.schools += 1;
    if (["hospital", "clinic", "doctors", "pharmacy"].includes(amenity)) counts.health += 1;
    if (String(tags["shop"] ?? "") === "supermarket") counts.supermarkets += 1;
    if (String(tags["leisure"] ?? "") === "park") counts.parks += 1;
    if (
      tags["public_transport"] ||
      ["bus_stop", "platform"].includes(String(tags["highway"] ?? "")) ||
      ["station", "halt", "tram_stop"].includes(String(tags["railway"] ?? ""))
    )
      counts.transit += 1;
  }
  return counts;
}

async function fetchOverpassCounts(
  endpoint: string,
  coordinates: Coordinates,
  radius: number,
): Promise<AmenityCounts | null> {
  const { lat, lng } = coordinates;
  const query = `[out:json][timeout:12];(
    nwr(around:${radius},${lat},${lng})[amenity~"school|college|university"];
    nwr(around:${radius},${lat},${lng})[amenity~"hospital|clinic|doctors|pharmacy"];
    nwr(around:${radius},${lat},${lng})[shop="supermarket"];
    nwr(around:${radius},${lat},${lng})[leisure="park"];
    nwr(around:${radius},${lat},${lng})[public_transport];
    nwr(around:${radius},${lat},${lng})[highway="bus_stop"];
    nwr(around:${radius},${lat},${lng})[railway~"station|halt|tram_stop"];
  );out tags center qt;`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": "MercadoImobi/1.0 location-analysis",
      "Cache-Control": "no-cache",
    },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const payload = object(await response.json().catch(() => ({})));
  const remark = String(payload["remark"] ?? "").toLowerCase();
  if (remark.includes("runtime error") || remark.includes("rate_limited")) return null;
  const elements = Array.isArray(payload["elements"]) ? payload["elements"] : [];
  return countOsmAmenities(elements);
}

async function osmNearbyCounts(coordinates: Coordinates, radius = 2200) {
  let emptyResult: AmenityCounts | null = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const counts = await fetchOverpassCounts(endpoint, coordinates, radius).catch(() => null);
    if (!counts) continue;
    if (hasAmenitySignal(counts)) return counts;
    emptyResult ??= counts;
  }
  return emptyResult;
}

async function getMunicipality(city: string, state: string) {
  const response = await fetch(
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(state.toUpperCase())}/municipios`,
    { signal: AbortSignal.timeout(12_000), cache: "no-store" },
  );
  if (!response.ok) return null;
  const municipalities = (await response.json().catch(() => [])) as unknown;
  if (!Array.isArray(municipalities)) return null;
  const wanted = normalizeText(city);
  const match = municipalities.find(
    (item) => normalizeText(String(object(item)["nome"] ?? "")) === wanted,
  );
  if (!match) return null;
  const row = object(match);
  return { id: String(row["id"] ?? ""), name: String(row["nome"] ?? city) };
}

async function getPopulation2022(municipalityId: string) {
  if (!municipalityId) return null;
  const url = `https://servicodados.ibge.gov.br/api/v3/agregados/4714/periodos/2022/variaveis/93?localidades=N6[${encodeURIComponent(municipalityId)}]`;
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => [])) as unknown;
  if (!Array.isArray(payload) || !payload.length) return null;
  const result = object(payload[0]);
  const resultados = Array.isArray(result["resultados"]) ? result["resultados"] : [];
  for (const resultado of resultados) {
    const series = Array.isArray(object(resultado)["series"]) ? object(resultado)["series"] : [];
    for (const item of series) {
      const serie = object(object(item)["serie"]);
      const value = Number(serie["2022"]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

async function getMarketEvidence(db: any, city: string, state: string, neighborhood: string) {
  let result = await db.rpc("location_market_evidence", {
    p_city: city,
    p_neighborhood: neighborhood || null,
    p_state: state || null,
  });
  if (result.error && String(result.error.message ?? "").includes("p_state")) {
    result = await db.rpc("location_market_evidence", {
      p_city: city,
      p_neighborhood: neighborhood || null,
    });
  }
  const { data, error } = result;
  if (error) throw new Error(error.message);
  const row = object(Array.isArray(data) ? data[0] : data);
  return {
    sampleSize: Number(row["sample_size"] ?? 0),
    medianPrice: finiteOrNull(row["median_price"]),
    medianPricePerSqm: finiteOrNull(row["median_price_per_sqm"]),
    averagePrice: finiteOrNull(row["average_price"]),
    p25Price: finiteOrNull(row["p25_price"]),
    p75Price: finiteOrNull(row["p75_price"]),
    recentListings90d: Number(row["recent_listings_90d"] ?? 0),
    sourceCount: Number(row["source_count"] ?? 0),
    latestSeenAt: row["latest_seen_at"] ? String(row["latest_seen_at"]) : null,
    scope: row["scope"] === "bairro" ? ("bairro" as const) : ("cidade" as const),
  };
}

function potentialScore(input: {
  amenities: {
    schools: number;
    health: number;
    supermarkets: number;
    parks: number;
    transit: number;
  };
  market: { sampleSize: number; recentListings90d: number; sourceCount: number };
  hasInfrastructure: boolean;
  hasIbge: boolean;
}) {
  const infrastructure = Math.min(
    40,
    Math.round(
      Math.min(input.amenities.schools / 8, 1) * 9 +
        Math.min(input.amenities.health / 5, 1) * 8 +
        Math.min(input.amenities.supermarkets / 8, 1) * 8 +
        Math.min(input.amenities.parks / 5, 1) * 6 +
        Math.min(input.amenities.transit / 6, 1) * 9,
    ),
  );
  const liquidity = Math.min(25, Math.round(Math.min(input.market.recentListings90d / 80, 1) * 25));
  const marketEvidence = Math.min(
    20,
    Math.round(
      Math.min(input.market.sampleSize / 120, 1) * 14 +
        Math.min(input.market.sourceCount / 4, 1) * 6,
    ),
  );
  const dataConfidence = (input.hasInfrastructure ? 8 : 0) + (input.hasIbge ? 7 : 0);
  return {
    infrastructure,
    liquidity,
    marketEvidence,
    dataConfidence,
    total: Math.min(100, infrastructure + liquidity + marketEvidence + dataConfidence),
  };
}

export const analyzePropertyLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => analysisSchema.parse(data))
  .handler(async ({ data, context }): Promise<LocationAnalysisResult> => {
    const db = context.supabase as any;
    const address = data.address?.trim() ?? "";
    const neighborhood = data.neighborhood?.trim() ?? "";
    const state = data.state.toUpperCase();
    const googleKey = process.env["GOOGLE_MAPS_API_KEY"]?.trim();
    const coordinateCandidates = buildLocationGeocodeCandidates({
      address,
      neighborhood,
      city: data.city,
      state,
    });

    const emptyMarket = {
      sampleSize: 0,
      medianPrice: null,
      medianPricePerSqm: null,
      averagePrice: null,
      p25Price: null,
      p75Price: null,
      recentListings90d: 0,
      sourceCount: 0,
      latestSeenAt: null,
      scope: "cidade" as const,
    };

    const [municipality, market, resolvedCoordinates] = await Promise.all([
      getMunicipality(data.city, state).catch(() => null),
      getMarketEvidence(db, data.city, state, neighborhood).catch(() => emptyMarket),
      resolveCoordinates(coordinateCandidates, googleKey || undefined),
    ]);
    const population = municipality
      ? await getPopulation2022(municipality.id).catch(() => null)
      : null;

    const amenities = { ...EMPTY_AMENITIES };
    let infrastructureProvider: "google" | "openstreetmap" | "none" = "none";

    if (googleKey && resolvedCoordinates?.provider === "google") {
      const [schools, health, supermarkets, parks, transit] = await Promise.all([
        googleNearbyCount(googleKey, resolvedCoordinates, ["school", "university"]).catch(() => 0),
        googleNearbyCount(googleKey, resolvedCoordinates, ["hospital", "doctor"]).catch(() => 0),
        googleNearbyCount(googleKey, resolvedCoordinates, ["supermarket"]).catch(() => 0),
        googleNearbyCount(googleKey, resolvedCoordinates, ["park"]).catch(() => 0),
        googleNearbyCount(googleKey, resolvedCoordinates, ["transit_station", "bus_station"]).catch(
          () => 0,
        ),
      ]);
      const googleAmenities = { schools, health, supermarkets, parks, transit };
      if (hasAmenitySignal(googleAmenities)) {
        Object.assign(amenities, googleAmenities);
        infrastructureProvider = "google";
      }
    }

    if (infrastructureProvider === "none" && resolvedCoordinates) {
      const osmAmenities = await osmNearbyCounts(resolvedCoordinates).catch(() => null);
      if (osmAmenities && hasAmenitySignal(osmAmenities)) {
        Object.assign(amenities, osmAmenities);
        infrastructureProvider = "openstreetmap";
      }
    }

    const components = potentialScore({
      amenities,
      market,
      hasInfrastructure: infrastructureProvider !== "none",
      hasIbge: Boolean(municipality),
    });
    const classification =
      components.total >= 75
        ? "Potencial alto para investigação"
        : components.total >= 55
          ? "Potencial moderado"
          : components.total >= 35
            ? "Potencial em desenvolvimento"
            : "Dados insuficientes ou região que exige cautela";

    const scopeLabel = market.scope === "bairro" ? "bairro informado" : `município de ${data.city}`;
    const infrastructureLabel =
      infrastructureProvider === "none"
        ? "a infraestrutura próxima não foi confirmada pelo provedor cartográfico neste ciclo"
        : "infraestrutura próxima validada por mapa público/API";
    const summary = `${classification}. A leitura usa ${market.sampleSize} anúncios do ${scopeLabel}, ${infrastructureLabel} e dados oficiais do município. Os valores são evidências observadas na base e não garantia de valorização futura.`;
    const sources = ["MercadoImobi — estatística agregada do índice de anúncios"];
    if (municipality) sources.push("IBGE — Localidades e Censo 2022");
    if (infrastructureProvider === "google")
      sources.push("Google Maps Platform — Geocoding e Places");
    if (infrastructureProvider === "openstreetmap")
      sources.push("OpenStreetMap — Nominatim e Overpass");

    return {
      query: { address, neighborhood, city: data.city, state },
      analyzedAt: new Date().toISOString(),
      coordinates: resolvedCoordinates
        ? { lat: resolvedCoordinates.lat, lng: resolvedCoordinates.lng }
        : null,
      score: components.total,
      classification,
      summary,
      infrastructure: {
        available: infrastructureProvider !== "none",
        provider: infrastructureProvider,
        radiusMeters: 2200,
        ...amenities,
      },
      demographics: {
        municipalityCode: municipality?.id ?? null,
        municipalityName: municipality?.name ?? null,
        population2022: population,
      },
      market,
      components: {
        infrastructure: components.infrastructure,
        liquidity: components.liquidity,
        marketEvidence: components.marketEvidence,
        dataConfidence: components.dataConfidence,
      },
      sources,
      caveat:
        "Índice indicativo baseado nas evidências disponíveis. Preços anunciados não equivalem necessariamente a preços de transação. Valorização depende de oferta, demanda, obras, zoneamento, crédito, economia e outros fatores. Confirme decisões relevantes com avaliação técnica local.",
    };
  });
