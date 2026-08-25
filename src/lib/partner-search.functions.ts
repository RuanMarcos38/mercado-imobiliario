import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiParameters } from "@/lib/platform-parameters.server";
import {
  dedupeAndRankPartners,
  isOfficialCreciSource,
  safeHttpUrl,
  sanitizePartnerCandidate,
  type PartnerCandidate,
  type PartnerEntityType,
} from "@/lib/partner-search.core";
import { requireTenantId } from "@/lib/tenant.server";

const searchSchema = z.object({
  location: z.string().trim().min(2).max(140),
  entityType: z.enum(["todos", "corretor", "imobiliaria"]).default("todos"),
  specialty: z.string().trim().max(100).optional(),
  limit: z.number().int().min(5).max(30).default(20),
});

type OpenAIWebPartner = {
  name: string;
  entityType: PartnerEntityType;
  creciNumber: string | null;
  creciUf: string | null;
  creciType: "PF" | "PJ" | null;
  creciStatus: "verificado" | "informado" | "nao_localizado";
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  specialties: string[];
  summary: string | null;
  sourceUrls: string[];
};

type OpenAIWebPayload = {
  partners: OpenAIWebPartner[];
};

type ProviderResult = {
  candidates: PartnerCandidate[];
  warning?: string;
};

function googlePlacesApiKey() {
  return (
    process.env["GOOGLE_PLACES_API_KEY"]?.trim() ||
    process.env["GOOGLE_MAPS_API_KEY"]?.trim() ||
    ""
  );
}

function openAiConfig() {
  const apiKey = process.env["OPENAI_API_KEY"]?.trim();
  if (!apiKey) return null;
  const parameters = aiParameters();
  const searchModel = process.env["OPENAI_SEARCH_MODEL"]?.trim();
  const models = [...new Set([searchModel, parameters.model, "gpt-5.4"].filter(Boolean) as string[])];
  return { apiKey, models, timeoutMs: Math.max(parameters.requestTimeoutMs, 45_000) };
}

function providerQuery(
  location: string,
  entityType: "todos" | PartnerEntityType,
  specialty?: string,
) {
  const subject =
    entityType === "corretor"
      ? "corretores de imóveis com CRECI"
      : entityType === "imobiliaria"
        ? "imobiliárias com CRECI PJ"
        : "corretores de imóveis e imobiliárias com CRECI";
  return `${subject} em ${location}${specialty ? ` especializados em ${specialty}` : ""}`;
}

function googleCandidateId(placeId: string | null, name: string, index: number) {
  return `google:${placeId || `${name}:${index}`}`;
}

async function searchGooglePlaces(input: z.infer<typeof searchSchema>): Promise<ProviderResult> {
  const apiKey = googlePlacesApiKey();
  if (!apiKey) return { candidates: [], warning: "Google Places não configurado." };

  const types: PartnerEntityType[] =
    input.entityType === "todos" ? ["imobiliaria", "corretor"] : [input.entityType];
  const candidates: PartnerCandidate[] = [];
  const perQuery = Math.max(5, Math.min(15, Math.ceil(input.limit / types.length)));

  for (const entityType of types) {
    const textQuery = providerQuery(input.location, entityType, input.specialty);
    try {
      const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.primaryTypeDisplayName",
        },
        body: JSON.stringify({
          textQuery,
          pageSize: perQuery,
          languageCode: "pt-BR",
          regionCode: "BR",
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) continue;
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const places = Array.isArray(payload["places"]) ? (payload["places"] as Record<string, unknown>[]) : [];

      places.forEach((place, index) => {
        const displayName =
          place["displayName"] && typeof place["displayName"] === "object"
            ? String((place["displayName"] as Record<string, unknown>)["text"] ?? "")
            : "";
        if (!displayName.trim()) return;
        const phone = String(
          place["internationalPhoneNumber"] ?? place["nationalPhoneNumber"] ?? "",
        ).trim();
        const website = safeHttpUrl(place["websiteUri"]);
        const mapsUrl = safeHttpUrl(place["googleMapsUri"]);
        const sourceUrls = [website, mapsUrl].filter(Boolean) as string[];
        const primaryType =
          place["primaryTypeDisplayName"] && typeof place["primaryTypeDisplayName"] === "object"
            ? String((place["primaryTypeDisplayName"] as Record<string, unknown>)["text"] ?? "")
            : "";
        const address = String(place["formattedAddress"] ?? "").trim() || null;

        candidates.push(
          sanitizePartnerCandidate({
            id: googleCandidateId(
              typeof place["id"] === "string" ? (place["id"] as string) : null,
              displayName,
              index,
            ),
            name: displayName,
            entityType,
            creciNumber: null,
            creciUf: null,
            creciType: entityType === "imobiliaria" ? "PJ" : "PF",
            creciStatus: "nao_localizado",
            phone: phone || null,
            email: null,
            website,
            address,
            city: null,
            state: null,
            specialties: primaryType ? [primaryType] : [],
            summary: null,
            sourceUrls,
            googleMapsUrl: mapsUrl,
            sourceProviders: ["Google Places"],
          }),
        );
      });
    } catch {
      // One provider query must not prevent the second provider or OpenAI web search.
    }
  }

  return {
    candidates,
    warning: candidates.length ? undefined : "Google Places não retornou resultados nesta busca.",
  };
}

function webSearchJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      partners: {
        type: "array",
        maxItems: 30,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            entityType: { type: "string", enum: ["corretor", "imobiliaria"] },
            creciNumber: { type: ["string", "null"] },
            creciUf: { type: ["string", "null"] },
            creciType: { type: ["string", "null"], enum: ["PF", "PJ", null] },
            creciStatus: {
              type: "string",
              enum: ["verificado", "informado", "nao_localizado"],
            },
            phone: { type: ["string", "null"] },
            email: { type: ["string", "null"] },
            website: { type: ["string", "null"] },
            address: { type: ["string", "null"] },
            city: { type: ["string", "null"] },
            state: { type: ["string", "null"] },
            specialties: { type: "array", items: { type: "string" }, maxItems: 8 },
            summary: { type: ["string", "null"] },
            sourceUrls: { type: "array", items: { type: "string" }, maxItems: 8 },
          },
          required: [
            "name",
            "entityType",
            "creciNumber",
            "creciUf",
            "creciType",
            "creciStatus",
            "phone",
            "email",
            "website",
            "address",
            "city",
            "state",
            "specialties",
            "summary",
            "sourceUrls",
          ],
        },
      },
    },
    required: ["partners"],
  };
}

function extractOutputText(payload: Record<string, unknown>) {
  const output = Array.isArray(payload["output"]) ? (payload["output"] as Record<string, unknown>[]) : [];
  return output
    .flatMap((item) => (Array.isArray(item["content"]) ? (item["content"] as Record<string, unknown>[]) : []))
    .filter((item) => item["type"] === "output_text" && typeof item["text"] === "string")
    .map((item) => String(item["text"] ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractWebSourceUrls(payload: Record<string, unknown>) {
  const urls = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const object = value as Record<string, unknown>;
    if (typeof object["url"] === "string") {
      const safe = safeHttpUrl(object["url"]);
      if (safe) urls.add(safe);
    }
    Object.values(object).forEach(visit);
  };
  const output = Array.isArray(payload["output"]) ? payload["output"] : [];
  visit(output);
  return [...urls];
}

function sourceMatchesAllowed(url: string, allowed: string[]) {
  if (!allowed.length) return true;
  try {
    const candidate = new URL(url);
    return allowed.some((source) => {
      try {
        const allowedUrl = new URL(source);
        return candidate.href === allowedUrl.href || candidate.hostname === allowedUrl.hostname;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

async function callOpenAiWebSearch(
  config: NonNullable<ReturnType<typeof openAiConfig>>,
  input: z.infer<typeof searchSchema>,
) {
  const query = providerQuery(input.location, input.entityType, input.specialty);
  const instructions = [
    "Pesquise parceiros imobiliários reais e publicamente identificáveis no Brasil.",
    "Use a web para encontrar corretores de imóveis e imobiliárias na localidade solicitada.",
    "Priorize fontes oficiais do CRECI/COFECI para confirmar inscrição profissional, depois site oficial da empresa/profissional, Google, portais e perfis públicos profissionais.",
    "Nunca invente telefone, e-mail, endereço, CRECI, especialidade ou site. Se não estiver publicado, use null.",
    "Considere apenas contatos publicados para finalidade profissional/comercial. Não procure dados privados ou pessoais não publicados como contato profissional.",
    "creciStatus deve ser 'verificado' somente quando a fonte consultada for um domínio oficial de CRECI ou COFECI; se o número aparecer apenas em site/perfil público, use 'informado'.",
    "Em sourceUrls inclua somente URLs realmente consultadas na pesquisa.",
    "Evite duplicados e priorize resultados com telefone, e-mail e CRECI.",
    `Retorne no máximo ${input.limit} parceiros relevantes.`,
  ].join("\n");

  const bodyBase = {
    instructions,
    input: [{ role: "user", content: `Busca: ${query}` }],
    include: ["web_search_call.action.sources"],
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "mercadoimobi_partner_search",
        strict: true,
        schema: webSearchJsonSchema(),
      },
    },
  };

  let lastStatus = 0;
  for (const model of config.models) {
    for (const toolType of ["web_search", "web_search_preview"] as const) {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...bodyBase,
          model,
          tools: [{ type: toolType, search_context_size: "high" }],
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      lastStatus = response.status;
      if (!response.ok) {
        if ([400, 404, 422].includes(response.status)) continue;
        throw new Error(`OPENAI_PARTNER_SEARCH_FAILED_${response.status}`);
      }
      return (await response.json()) as Record<string, unknown>;
    }
  }
  throw new Error(`OPENAI_PARTNER_SEARCH_FAILED_${lastStatus || 500}`);
}

async function searchOpenAiWeb(input: z.infer<typeof searchSchema>): Promise<ProviderResult> {
  const config = openAiConfig();
  if (!config) return { candidates: [], warning: "Pesquisa web por IA não configurada." };

  try {
    const payload = await callOpenAiWebSearch(config, input);
    const text = extractOutputText(payload);
    if (!text) return { candidates: [], warning: "Pesquisa web por IA não retornou conteúdo." };
    const parsed = JSON.parse(text) as OpenAIWebPayload;
    const allowedSources = extractWebSourceUrls(payload);
    const partners = Array.isArray(parsed.partners) ? parsed.partners : [];

    const candidates = partners
      .filter((partner) => partner?.name?.trim())
      .map((partner, index) => {
        const sourceUrls = (partner.sourceUrls ?? [])
          .map(safeHttpUrl)
          .filter(Boolean)
          .filter((url) => sourceMatchesAllowed(url as string, allowedSources)) as string[];
        const officialSource = sourceUrls.some(isOfficialCreciSource);
        return sanitizePartnerCandidate({
          id: `web:${index}:${partner.name}`,
          name: partner.name,
          entityType: partner.entityType,
          creciNumber: partner.creciNumber,
          creciUf: partner.creciUf,
          creciType: partner.creciType,
          creciStatus:
            partner.creciNumber && officialSource
              ? "verificado"
              : partner.creciNumber
                ? "informado"
                : "nao_localizado",
          phone: partner.phone,
          email: partner.email,
          website: partner.website,
          address: partner.address,
          city: partner.city,
          state: partner.state,
          specialties: partner.specialties ?? [],
          summary: partner.summary,
          sourceUrls,
          googleMapsUrl: null,
          sourceProviders: ["OpenAI Web Search"],
        });
      });

    return { candidates };
  } catch {
    return {
      candidates: [],
      warning: "A pesquisa web por IA ficou indisponível nesta tentativa. Tente novamente.",
    };
  }
}

export type PartnerSearchResponse = {
  partners: PartnerCandidate[];
  providers: {
    openaiWeb: boolean;
    googlePlaces: boolean;
  };
  warnings: string[];
  searchedAt: string;
  query: string;
};

export const getPartnerSearchStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireTenantId(context.supabase, context.userId);
    return {
      openaiWeb: Boolean(openAiConfig()),
      googlePlaces: Boolean(googlePlacesApiKey()),
    };
  });

export const searchRealEstatePartners = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => searchSchema.parse(data))
  .handler(async ({ data, context }): Promise<PartnerSearchResponse> => {
    await requireTenantId(context.supabase, context.userId);

    const [google, openai] = await Promise.all([searchGooglePlaces(data), searchOpenAiWeb(data)]);
    const partners = dedupeAndRankPartners([...openai.candidates, ...google.candidates], data.limit);
    const warnings = [google.warning, openai.warning].filter(Boolean) as string[];

    if (!partners.length && !googlePlacesApiKey() && !openAiConfig()) {
      throw new Error("PARTNER_SEARCH_NOT_CONFIGURED");
    }

    return {
      partners,
      providers: {
        openaiWeb: Boolean(openAiConfig()),
        googlePlaces: Boolean(googlePlacesApiKey()),
      },
      warnings,
      searchedAt: new Date().toISOString(),
      query: providerQuery(data.location, data.entityType, data.specialty),
    };
  });
