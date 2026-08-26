import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiParameters } from "@/lib/platform-parameters.server";
import {
  dedupeAndRankProspectLeads,
  isNetworkUrl,
  networkDomainHint,
  safePublicUrl,
  sanitizeProspectLead,
  SOCIAL_NETWORKS,
  type ProspectLead,
  type ProspectProfileType,
  type SocialNetwork,
} from "@/lib/prospect-leads.core";
import { requireTenantId } from "@/lib/tenant.server";

const searchSchema = z.object({
  query: z.string().trim().min(3).max(600),
  location: z.string().trim().max(140).optional(),
  intent: z.enum(["qualquer", "comprar", "alugar", "investir"]).default("qualquer"),
  propertyType: z.string().trim().max(100).optional(),
  networks: z.array(z.enum(SOCIAL_NETWORKS)).min(1).max(SOCIAL_NETWORKS.length),
  limit: z.number().int().min(5).max(30).default(20),
});

type RawProspectLead = {
  displayName: string;
  profileHandle: string | null;
  profileUrl: string | null;
  profileType: ProspectProfileType;
  contactIsProfessional: boolean;
  publicPhone: string | null;
  publicEmail: string | null;
  publicWebsite: string | null;
  location: string | null;
  intentScore: number;
  intentSignals: string[];
  evidence: string | null;
  publishedAt: string | null;
  sourceUrls: string[];
};

type RawPayload = { leads: RawProspectLead[] };

type NetworkResult = {
  network: SocialNetwork;
  leads: ProspectLead[];
  warning?: string;
  operational: boolean;
};

function openAiConfig() {
  const apiKey = process.env["OPENAI_API_KEY"]?.trim();
  if (!apiKey) return null;
  const parameters = aiParameters();
  const searchModel = process.env["OPENAI_SEARCH_MODEL"]?.trim();
  const models = [...new Set([searchModel, parameters.model, "gpt-5.4"].filter(Boolean) as string[])];
  return {
    apiKey,
    models,
    timeoutMs: Math.max(parameters.requestTimeoutMs, 45_000),
  };
}

function leadSchema(maxItems: number) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      leads: {
        type: "array",
        maxItems,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            displayName: { type: "string" },
            profileHandle: { type: ["string", "null"] },
            profileUrl: { type: ["string", "null"] },
            profileType: { type: "string", enum: ["consumidor", "profissional"] },
            contactIsProfessional: { type: "boolean" },
            publicPhone: { type: ["string", "null"] },
            publicEmail: { type: ["string", "null"] },
            publicWebsite: { type: ["string", "null"] },
            location: { type: ["string", "null"] },
            intentScore: { type: "integer", minimum: 0, maximum: 100 },
            intentSignals: { type: "array", items: { type: "string" }, maxItems: 6 },
            evidence: { type: ["string", "null"] },
            publishedAt: { type: ["string", "null"] },
            sourceUrls: { type: "array", items: { type: "string" }, maxItems: 8 },
          },
          required: [
            "displayName",
            "profileHandle",
            "profileUrl",
            "profileType",
            "contactIsProfessional",
            "publicPhone",
            "publicEmail",
            "publicWebsite",
            "location",
            "intentScore",
            "intentSignals",
            "evidence",
            "publishedAt",
            "sourceUrls",
          ],
        },
      },
    },
    required: ["leads"],
  };
}

function extractOutputText(payload: Record<string, unknown>) {
  const output = Array.isArray(payload["output"])
    ? (payload["output"] as Record<string, unknown>[])
    : [];
  return output
    .flatMap((item) =>
      Array.isArray(item["content"]) ? (item["content"] as Record<string, unknown>[]) : [],
    )
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
      const safe = safePublicUrl(object["url"]);
      if (safe) urls.add(safe);
    }
    Object.values(object).forEach(visit);
  };
  visit(payload["output"]);
  return [...urls];
}

function samePublicSource(candidate: string, sources: string[]) {
  try {
    const url = new URL(candidate);
    return sources.some((source) => {
      try {
        const allowed = new URL(source);
        return url.href === allowed.href || url.hostname === allowed.hostname;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function firstNetworkSource(sources: string[], network: SocialNetwork) {
  return sources.find((url) => isNetworkUrl(url, network)) ?? null;
}

function searchPhrase(data: z.infer<typeof searchSchema>, network: SocialNetwork) {
  const intent =
    data.intent === "comprar"
      ? "quer comprar imóvel"
      : data.intent === "alugar"
        ? "quer alugar imóvel"
        : data.intent === "investir"
          ? "quer investir em imóveis"
          : "demonstra interesse real em comprar, alugar ou investir em imóveis";
  const location = data.location ? ` em ${data.location}` : "";
  const property = data.propertyType ? ` ${data.propertyType}` : "";
  return `site:${networkDomainHint(network)} ${data.query} ${intent}${property}${location}`.trim();
}

async function callNetworkSearch(
  config: NonNullable<ReturnType<typeof openAiConfig>>,
  data: z.infer<typeof searchSchema>,
  network: SocialNetwork,
  maxItems: number,
) {
  const query = searchPhrase(data, network);
  const instructions = [
    "Você está executando prospecção imobiliária responsável usando apenas conteúdo público e indexável da web.",
    `Pesquise exclusivamente sinais públicos na rede social ${network}.`,
    "Encontre perfis ou publicações que demonstrem intenção imobiliária explícita e recente, como procurar imóvel, perguntar preço, financiamento, entrada, visita, localização, compra, aluguel ou investimento.",
    "Priorize sinais dos últimos 90 dias quando a data estiver publicamente disponível.",
    "Não infira interesse somente por curtida genérica, seguidores ou características pessoais. O sinal deve estar explícito em texto ou contexto público.",
    "Não procure nem revele dados privados, dados de login, dados de data broker, endereço residencial, documentos, informações de menores ou qualquer dado que não esteja publicamente disponível.",
    "Para perfis de consumidores, retorne somente nome/identificador público, URL do perfil e evidência pública; telefone e e-mail devem ser null.",
    "Telefone, e-mail e site só podem ser retornados quando o perfil for profissional/empresarial e o contato estiver claramente publicado para finalidade comercial. Nessa situação marque contactIsProfessional=true.",
    "Não invente nome, telefone, e-mail, perfil, cidade, data ou evidência. Se não estiver publicado, use null.",
    "Não use categorias sensíveis ou atributos protegidos para classificar ou priorizar pessoas.",
    "intentScore deve refletir somente a força do sinal público de intenção imobiliária: 90-100 pedido direto/urgente; 75-89 interesse claro com detalhes; 45-74 pesquisa ou comparação ainda inicial.",
    "evidence deve ser uma paráfrase curta do sinal observado, sem copiar longos trechos da publicação.",
    "Em sourceUrls inclua somente URLs efetivamente consultadas.",
    `Retorne no máximo ${maxItems} leads; se não houver sinal confiável, retorne leads vazio.`,
  ].join("\n");

  const bodyBase = {
    instructions,
    input: [{ role: "user", content: `Busca pública: ${query}` }],
    include: ["web_search_call.action.sources"],
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: `mercadoimobi_prospect_${network}`,
        strict: true,
        schema: leadSchema(maxItems),
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
        throw new Error(`PROSPECT_SEARCH_${network}_${response.status}`);
      }
      return (await response.json()) as Record<string, unknown>;
    }
  }
  throw new Error(`PROSPECT_SEARCH_${network}_${lastStatus || 500}`);
}

async function searchNetwork(
  config: NonNullable<ReturnType<typeof openAiConfig>>,
  data: z.infer<typeof searchSchema>,
  network: SocialNetwork,
  maxItems: number,
): Promise<NetworkResult> {
  try {
    const payload = await callNetworkSearch(config, data, network, maxItems);
    const outputText = extractOutputText(payload);
    if (!outputText) {
      return { network, leads: [], operational: true, warning: `${network}: sem conteúdo público útil nesta busca.` };
    }
    const parsed = JSON.parse(outputText) as RawPayload;
    const webSources = extractWebSourceUrls(payload);
    const rawLeads = Array.isArray(parsed.leads) ? parsed.leads : [];
    const leads = rawLeads
      .map((lead, index) => {
        const requestedProfile = safePublicUrl(lead.profileUrl);
        const networkSource = firstNetworkSource(webSources, network);
        const profileUrl =
          requestedProfile && isNetworkUrl(requestedProfile, network) && samePublicSource(requestedProfile, webSources)
            ? requestedProfile
            : networkSource;
        if (!profileUrl) return null;
        const sourceUrls = (lead.sourceUrls ?? [])
          .map(safePublicUrl)
          .filter(Boolean)
          .filter((url) => samePublicSource(url as string, webSources)) as string[];
        const clean = sanitizeProspectLead({
          id: `${network}:${index}:${profileUrl}`,
          displayName: lead.displayName,
          profileHandle: lead.profileHandle,
          network,
          profileUrl,
          profileType: lead.profileType,
          contactIsProfessional: lead.contactIsProfessional,
          publicPhone: lead.publicPhone,
          publicEmail: lead.publicEmail,
          publicWebsite: lead.publicWebsite,
          location: lead.location,
          intentStage: lead.intentScore >= 75 ? "quente" : "morno",
          intentScore: lead.intentScore,
          intentSignals: lead.intentSignals ?? [],
          evidence: lead.evidence,
          publishedAt: lead.publishedAt,
          sourceUrls: sourceUrls.length ? sourceUrls : [profileUrl],
        });
        return clean;
      })
      .filter(Boolean) as ProspectLead[];

    return {
      network,
      leads,
      operational: true,
      warning: leads.length ? undefined : `${network}: nenhum sinal público de intenção imobiliária confiável localizado.`,
    };
  } catch {
    return {
      network,
      leads: [],
      operational: false,
      warning: `${network}: a fonte pública ficou indisponível ou não permitiu indexação nesta tentativa.`,
    };
  }
}

export type ProspectSearchResponse = {
  leads: ProspectLead[];
  networks: Array<{ network: SocialNetwork; operational: boolean; found: number }>;
  warnings: string[];
  searchedAt: string;
  assistantMessage: string;
};

export const getProspectRadarStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireTenantId(context.supabase, context.userId);
    return {
      configured: Boolean(openAiConfig()),
      networks: SOCIAL_NETWORKS,
      mode: "public_indexed_sources" as const,
    };
  });

export const searchHotRealEstateProspects = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => searchSchema.parse(input))
  .handler(async ({ data, context }): Promise<ProspectSearchResponse> => {
    await requireTenantId(context.supabase, context.userId);
    const config = openAiConfig();
    if (!config) throw new Error("PROSPECT_AI_NOT_CONFIGURED");

    const perNetwork = Math.max(2, Math.min(5, Math.ceil(data.limit / data.networks.length)));
    const results: NetworkResult[] = [];
    for (let index = 0; index < data.networks.length; index += 4) {
      const batch = data.networks.slice(index, index + 4);
      const batchResults = await Promise.all(
        batch.map((network) => searchNetwork(config, data, network, perNetwork)),
      );
      results.push(...batchResults);
    }

    const leads = dedupeAndRankProspectLeads(
      results.flatMap((result) => result.leads),
      data.limit,
    );
    const hot = leads.filter((lead) => lead.intentStage === "quente").length;
    const operationalNetworks = results.filter((result) => result.operational).length;
    const assistantMessage = leads.length
      ? `Encontrei ${leads.length} sinais públicos compatíveis com a busca, sendo ${hot} classificados como quentes. ${operationalNetworks} de ${results.length} redes selecionadas responderam à varredura pública. Revise a evidência e a fonte antes de qualquer abordagem.`
      : `Não encontrei sinais públicos suficientemente confiáveis nesta tentativa. ${operationalNetworks} de ${results.length} redes selecionadas responderam; tente ampliar a localização, o tipo de imóvel ou os termos de intenção.`;

    return {
      leads,
      networks: results.map((result) => ({
        network: result.network,
        operational: result.operational,
        found: result.leads.length,
      })),
      warnings: results.map((result) => result.warning).filter(Boolean) as string[],
      searchedAt: new Date().toISOString(),
      assistantMessage,
    };
  });
