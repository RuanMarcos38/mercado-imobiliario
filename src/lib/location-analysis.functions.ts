import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type JsonObject = Record<string, unknown>;

const analysisSchema = z.object({
  address: z.string().trim().max(250).optional(),
  neighborhood: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2).max(120),
  state: z.string().trim().length(2),
});

export interface LocationAnalysisResult {
  query: { address: string; neighborhood: string; city: string; state: string };
  coordinates: { lat: number; lng: number } | null;
  score: number;
  classification: string;
  summary: string;
  infrastructure: {
    available: boolean;
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
    recentListings90d: number;
    sourceCount: number;
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

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function googleGeocode(query: string, key: string) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("key", key);
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("region", "br");
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
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

async function nearbyCount(
  key: string,
  coordinates: { lat: number; lng: number },
  types: string[],
  radius = 2200,
) {
  const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id",
    },
    body: JSON.stringify({
      includedTypes: types,
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: { latitude: coordinates.lat, longitude: coordinates.lng },
          radius,
        },
      },
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return 0;
  const payload = object(await response.json().catch(() => ({})));
  return Array.isArray(payload["places"]) ? payload["places"].length : 0;
}

async function getMunicipality(city: string, state: string) {
  const response = await fetch(
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(state.toUpperCase())}/municipios`,
    { signal: AbortSignal.timeout(12_000) },
  );
  if (!response.ok) return null;
  const municipalities = (await response.json().catch(() => [])) as unknown;
  if (!Array.isArray(municipalities)) return null;
  const wanted = normalizeText(city);
  const match = municipalities.find((item) => normalizeText(String(object(item)["nome"] ?? "")) === wanted);
  if (!match) return null;
  const row = object(match);
  return { id: String(row["id"] ?? ""), name: String(row["nome"] ?? city) };
}

async function getPopulation2022(municipalityId: string) {
  if (!municipalityId) return null;
  const url = `https://servicodados.ibge.gov.br/api/v3/agregados/4714/periodos/2022/variaveis/93?localidades=N6[${encodeURIComponent(municipalityId)}]`;
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
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

async function getMarketEvidence(db: any, city: string, neighborhood: string) {
  let query = db
    .from("property_search_index")
    .select("price,area_sqm,scanned_at,source_portal,location_address")
    .ilike("location_city", `%${city}%`)
    .not("price", "is", null)
    .limit(500);
  if (neighborhood.trim()) query = query.ilike("location_address", `%${neighborhood.trim()}%`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const prices = rows
    .map((row) => Number(row.price))
    .filter((value) => Number.isFinite(value) && value > 0);
  const priceSqm = rows
    .map((row) => {
      const price = Number(row.price);
      const area = Number(row.area_sqm);
      return Number.isFinite(price) && Number.isFinite(area) && price > 0 && area > 10
        ? price / area
        : null;
    })
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const threshold = Date.now() - 90 * 86_400_000;
  const recent = rows.filter((row) => {
    if (!row.scanned_at) return false;
    const time = new Date(String(row.scanned_at)).getTime();
    return Number.isFinite(time) && time >= threshold;
  }).length;
  const sources = new Set(rows.map((row) => String(row.source_portal ?? "")).filter(Boolean));
  return {
    sampleSize: rows.length,
    medianPrice: median(prices),
    medianPricePerSqm: median(priceSqm),
    recentListings90d: recent,
    sourceCount: sources.size,
  };
}

function potentialScore(input: {
  amenities: { schools: number; health: number; supermarkets: number; parks: number; transit: number };
  market: { sampleSize: number; recentListings90d: number; sourceCount: number };
  hasGoogle: boolean;
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
    Math.round(Math.min(input.market.sampleSize / 120, 1) * 14 + Math.min(input.market.sourceCount / 4, 1) * 6),
  );
  const dataConfidence = (input.hasGoogle ? 8 : 0) + (input.hasIbge ? 7 : 0);
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
    const queryText = [address, neighborhood, data.city, state, "Brasil"].filter(Boolean).join(", ");
    const googleKey = process.env["GOOGLE_MAPS_API_KEY"]?.trim();

    const emptyMarket = {
      sampleSize: 0,
      medianPrice: null,
      medianPricePerSqm: null,
      recentListings90d: 0,
      sourceCount: 0,
    };
    const [municipality, market, coordinates] = await Promise.all([
      getMunicipality(data.city, state).catch(() => null),
      getMarketEvidence(db, data.city, neighborhood).catch(() => emptyMarket),
      googleKey ? googleGeocode(queryText, googleKey).catch(() => null) : Promise.resolve(null),
    ]);
    const population = municipality ? await getPopulation2022(municipality.id).catch(() => null) : null;

    const amenities = { schools: 0, health: 0, supermarkets: 0, parks: 0, transit: 0 };
    if (googleKey && coordinates) {
      const [schools, health, supermarkets, parks, transit] = await Promise.all([
        nearbyCount(googleKey, coordinates, ["school", "university"]).catch(() => 0),
        nearbyCount(googleKey, coordinates, ["hospital", "doctor"]).catch(() => 0),
        nearbyCount(googleKey, coordinates, ["supermarket"]).catch(() => 0),
        nearbyCount(googleKey, coordinates, ["park"]).catch(() => 0),
        nearbyCount(googleKey, coordinates, ["transit_station", "bus_station"]).catch(() => 0),
      ]);
      Object.assign(amenities, { schools, health, supermarkets, parks, transit });
    }

    const components = potentialScore({
      amenities,
      market,
      hasGoogle: Boolean(coordinates),
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

    const summary = `${classification}. A leitura combina infraestrutura próxima, atividade dos anúncios disponíveis no MercadoImobi e dados oficiais do município. O índice serve para apoiar a decisão e não representa garantia de valorização futura.`;
    const sources = ["MercadoImobi — índice interno de anúncios"];
    if (municipality) sources.push("IBGE — Localidades e Censo 2022");
    if (coordinates) sources.push("Google Maps Platform — Geocoding e Places");

    return {
      query: { address, neighborhood, city: data.city, state },
      coordinates,
      score: components.total,
      classification,
      summary,
      infrastructure: {
        available: Boolean(googleKey && coordinates),
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
        "Índice indicativo. Valorização imobiliária depende de oferta, demanda, obras, zoneamento, crédito, economia e outros fatores que podem mudar. Confirme decisões relevantes com avaliação técnica e dados locais atualizados.",
    };
  });
