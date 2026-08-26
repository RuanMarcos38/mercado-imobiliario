import {
  dedupeAndRankProspectLeads,
  safePublicUrl,
  sanitizeProspectLead,
  SOCIAL_NETWORKS,
  type ProspectLead,
  type SocialNetwork,
} from "@/lib/prospect-leads.core";
import {
  runPublicProspectSearch,
  type ProspectSearchResponse,
} from "@/lib/prospect-leads.functions";

const GOOGLE_PLACES_VAULT_SECRET = "mercadoimobi_google_places_api_key";
const AUTO_QUERY =
  "Localize comentários, posts e perfis públicos em páginas de venda de imóveis, corretores, imobiliárias, lançamentos e anúncios imobiliários onde pessoas demonstrem intenção real: perguntar preço ou valor, entrada, financiamento, parcelas, disponibilidade, localização, visita ou dizer que quer comprar, alugar ou investir.";

export type ProspectProviderStatus = {
  provider: "web_publica" | "google_places" | "youtube_api";
  label: string;
  configured: boolean;
  operational: boolean;
  found: number;
  detail: string;
};

export type ProspectRadarSnapshot = {
  result: ProspectSearchResponse;
  providers: ProspectProviderStatus[];
  searchedAt: string;
  nextRunAt: string;
  scope: "Brasil — todo território nacional";
};

type CacheState = {
  snapshot: ProspectRadarSnapshot | null;
  running: Promise<ProspectRadarSnapshot> | null;
  timerStarted: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

const globalState = globalThis as typeof globalThis & {
  __mercadoimobiProspectRadar?: CacheState;
};

function state(): CacheState {
  if (!globalState.__mercadoimobiProspectRadar) {
    globalState.__mercadoimobiProspectRadar = {
      snapshot: null,
      running: null,
      timerStarted: false,
      timer: null,
    };
  }
  return globalState.__mercadoimobiProspectRadar;
}

async function googleApiKey() {
  const env =
    process.env["YOUTUBE_API_KEY"]?.trim() ||
    process.env["GOOGLE_PLACES_API_KEY"]?.trim() ||
    process.env["GOOGLE_MAPS_API_KEY"]?.trim() ||
    "";
  if (env) return env;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any).rpc("get_platform_secret", {
      p_name: GOOGLE_PLACES_VAULT_SECRET,
    });
    if (!error && typeof data === "string" && data.trim()) return data.trim();
  } catch {
    // O Google é complementar; a pesquisa web continua disponível.
  }
  return "";
}

const REGION_CITY_POOLS = [
  ["Manaus AM", "Belém PA", "Palmas TO", "Porto Velho RO", "Macapá AP"],
  ["Salvador BA", "Recife PE", "Fortaleza CE", "São Luís MA", "Maceió AL"],
  ["Brasília DF", "Goiânia GO", "Cuiabá MT", "Campo Grande MS"],
  ["São Paulo SP", "Rio de Janeiro RJ", "Belo Horizonte MG", "Vitória ES"],
  ["Curitiba PR", "Florianópolis SC", "Porto Alegre RS", "Joinville SC"],
] as const;

async function discoverRealEstateAnchors(apiKey: string) {
  if (!apiKey) {
    return {
      anchors: [] as string[],
      status: {
        provider: "google_places" as const,
        label: "Google Places",
        configured: false,
        operational: false,
        found: 0,
        detail: "Chave Google não disponível no servidor.",
      },
    };
  }

  const hour = new Date().getUTCHours();
  const cities = REGION_CITY_POOLS.map((pool) => pool[hour % pool.length]);
  const anchors = new Set<string>();
  let successes = 0;
  const failures = new Set<number>();

  for (const city of cities) {
    try {
      const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "places.displayName,places.websiteUri",
        },
        body: JSON.stringify({
          textQuery: `imobiliária corretor de imóveis em ${city}`,
          pageSize: 4,
          languageCode: "pt-BR",
          regionCode: "BR",
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        failures.add(response.status);
        continue;
      }
      successes += 1;
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const places = Array.isArray(payload["places"])
        ? (payload["places"] as Record<string, unknown>[])
        : [];
      for (const place of places) {
        const display = place["displayName"] as Record<string, unknown> | undefined;
        const name = String(display?.["text"] ?? "").trim();
        if (name) anchors.add(name.slice(0, 100));
      }
    } catch {
      failures.add(0);
    }
  }

  const found = anchors.size;
  const detail = successes
    ? `Google Places consultado em ${successes} regiões/cidades; ${found} perfis profissionais usados como âncoras da varredura pública.`
    : failures.has(403)
      ? "Google Places respondeu 403. Verifique Places API (New), faturamento e restrições da chave."
      : failures.has(429)
        ? "Google Places atingiu a cota disponível."
        : "Google Places não respondeu nesta execução; a varredura web continuou.";

  return {
    anchors: [...anchors].slice(0, 12),
    status: {
      provider: "google_places" as const,
      label: "Google Places",
      configured: true,
      operational: successes > 0,
      found,
      detail,
    },
  };
}

const DIRECT_INTENT: Array<[RegExp, string, number]> = [
  [/\bquero comprar\b/i, "quer comprar", 98],
  [/\btenho interesse\b/i, "declarou interesse", 92],
  [/\bquero (?:ver|visitar|conhecer)\b/i, "quer visitar", 92],
  [/\bcomo (?:faço|faco) para comprar\b/i, "perguntou como comprar", 94],
  [/\bme chama\b|\bme chame\b/i, "pediu contato", 88],
  [/\bqual (?:o )?valor\b|\bquanto custa\b|\bpre[cç]o\b/i, "perguntou preço", 80],
  [/\bfinanciamento\b|\bfinancia\b/i, "perguntou financiamento", 82],
  [/\bentrada\b|\bparcelas?\b/i, "perguntou entrada/parcelas", 78],
  [/\bdispon[ií]vel\b|\bdisponibilidade\b/i, "perguntou disponibilidade", 78],
  [/\bonde fica\b|\blocaliza[cç][aã]o\b/i, "perguntou localização", 72],
];

function classifyPublicComment(text: string) {
  const compact = text.replace(/\s+/g, " ").trim().slice(0, 800);
  const hits = DIRECT_INTENT.filter(([pattern]) => pattern.test(compact));
  if (!hits.length) return null;
  const strongest = Math.max(...hits.map(([, , score]) => score));
  const score = Math.min(100, strongest + Math.min(8, Math.max(0, hits.length - 1) * 3));
  return {
    score,
    signals: [...new Set(hits.map(([, label]) => label))].slice(0, 6),
    evidence: `Comentário público recente demonstrou ${[...new Set(hits.map(([, label]) => label))]
      .slice(0, 3)
      .join(", ")}.`,
  };
}

const YOUTUBE_QUERIES = [
  "apartamento venda financiamento",
  "casa à venda financiamento",
  "lançamento imobiliário apartamento",
  "imóvel investimento comprar",
] as const;

async function searchYouTubeComments(apiKey: string) {
  const baseStatus: ProspectProviderStatus = {
    provider: "youtube_api",
    label: "YouTube Data API",
    configured: Boolean(apiKey),
    operational: false,
    found: 0,
    detail: apiKey ? "Aguardando consulta." : "Chave Google não disponível no servidor.",
  };
  if (!apiKey) return { leads: [] as ProspectLead[], status: baseStatus };

  const hour = new Date().getUTCHours();
  const query = YOUTUBE_QUERIES[hour % YOUTUBE_QUERIES.length];
  const after = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const searchParams = new URLSearchParams({
      part: "snippet",
      type: "video",
      q: query,
      maxResults: "15",
      order: "date",
      regionCode: "BR",
      relevanceLanguage: "pt",
      safeSearch: "moderate",
      publishedAfter: after,
      key: apiKey,
    });
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      return {
        leads: [] as ProspectLead[],
        status: {
          ...baseStatus,
          operational: false,
          detail:
            response.status === 403
              ? "YouTube Data API v3 não está autorizada para esta chave Google ou a cota foi recusada."
              : `YouTube Data API respondeu HTTP ${response.status}.`,
        },
      };
    }
    const searchPayload = (await response.json()) as any;
    const videos = (searchPayload.items ?? [])
      .map((item: any) => String(item?.id?.videoId ?? ""))
      .filter(Boolean);
    const leads: ProspectLead[] = [];

    for (const videoId of videos.slice(0, 15)) {
      const params = new URLSearchParams({
        part: "snippet",
        videoId,
        maxResults: "50",
        order: "time",
        textFormat: "plainText",
        key: apiKey,
      });
      const commentsResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/commentThreads?${params}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!commentsResponse.ok) continue;
      const payload = (await commentsResponse.json()) as any;
      for (const item of payload.items ?? []) {
        const commentId = String(item?.snippet?.topLevelComment?.id ?? "");
        const snippet = item?.snippet?.topLevelComment?.snippet ?? {};
        const classification = classifyPublicComment(String(snippet.textDisplay ?? ""));
        if (!classification) continue;
        const publishedAt = String(snippet.publishedAt ?? "") || null;
        const sourceUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}${commentId ? `&lc=${encodeURIComponent(commentId)}` : ""}`;
        const profileUrl = safePublicUrl(snippet.authorChannelUrl) || sourceUrl;
        const clean = sanitizeProspectLead({
          id: `youtube:${commentId || `${videoId}:${leads.length}`}`,
          displayName: String(snippet.authorDisplayName ?? "Perfil público do YouTube"),
          profileHandle: null,
          network: "youtube",
          profileUrl,
          profileType: "consumidor",
          contactIsProfessional: false,
          publicPhone: null,
          publicEmail: null,
          publicWebsite: null,
          location: null,
          intentStage: classification.score >= 75 ? "quente" : "morno",
          intentScore: classification.score,
          intentSignals: classification.signals,
          evidence: classification.evidence,
          publishedAt,
          sourceUrls: [sourceUrl],
        });
        if (clean) leads.push(clean);
      }
      if (leads.length >= 20) break;
    }

    const ranked = dedupeAndRankProspectLeads(leads, 20);
    return {
      leads: ranked,
      status: {
        ...baseStatus,
        operational: true,
        found: ranked.length,
        detail: `${videos.length} vídeos imobiliários recentes consultados; ${ranked.length} comentários públicos com sinal de intenção.`,
      },
    };
  } catch {
    return {
      leads: [] as ProspectLead[],
      status: { ...baseStatus, detail: "YouTube Data API ficou indisponível nesta execução." },
    };
  }
}

function aggregateNetworks(base: ProspectSearchResponse, extra: ProspectLead[]) {
  return SOCIAL_NETWORKS.map((network) => {
    const current = base.networks.find((item) => item.network === network);
    const directFound = extra.filter((lead) => lead.network === network).length;
    return {
      network: network as SocialNetwork,
      operational: Boolean(current?.operational || directFound > 0),
      found: (current?.found ?? 0) + directFound,
    };
  });
}

export async function runScheduledProspectRadar(): Promise<ProspectRadarSnapshot> {
  const cache = state();
  if (cache.running) return cache.running;

  cache.running = (async () => {
    const googleKey = await googleApiKey();
    const [places, youtube] = await Promise.all([
      discoverRealEstateAnchors(googleKey),
      searchYouTubeComments(googleKey),
    ]);

    const anchorText = places.anchors.length
      ? ` Considere também interações públicas ligadas a imobiliárias e corretores reais identificados pelo Google, como: ${places.anchors.join(", ")}.`
      : "";
    const query = `${AUTO_QUERY}${anchorText}`.slice(0, 590);
    const web = await runPublicProspectSearch({
      query,
      location: "Brasil — todo território nacional",
      intent: "qualquer",
      propertyType: "imóveis residenciais, lançamentos, casas e apartamentos",
      networks: [...SOCIAL_NETWORKS],
      limit: 30,
    });

    const leads = dedupeAndRankProspectLeads([...youtube.leads, ...web.leads], 30);
    const hot = leads.filter((lead) => lead.intentStage === "quente").length;
    const result: ProspectSearchResponse = {
      ...web,
      leads,
      networks: aggregateNetworks(web, youtube.leads),
      searchedAt: new Date().toISOString(),
      assistantMessage: leads.length
        ? `Varredura nacional automática encontrou ${leads.length} sinais públicos, sendo ${hot} quentes. Foram combinadas pesquisa web pública, Google Places como fonte de contexto imobiliário e comentários públicos do YouTube quando a API oficial estava disponível.`
        : "A varredura automática foi executada, mas não encontrou sinais públicos suficientemente confiáveis nesta hora. As fontes disponíveis serão consultadas novamente na próxima execução.",
    };
    const now = new Date();
    const snapshot: ProspectRadarSnapshot = {
      result,
      providers: [
        {
          provider: "web_publica",
          label: "Pesquisa Web pública",
          configured: true,
          operational: web.networks.some((item) => item.operational),
          found: web.leads.length,
          detail:
            "Posts, páginas, perfis e trechos publicamente indexáveis nas redes selecionadas.",
        },
        places.status,
        youtube.status,
      ],
      searchedAt: now.toISOString(),
      nextRunAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      scope: "Brasil — todo território nacional",
    };
    cache.snapshot = snapshot;
    return snapshot;
  })();

  try {
    return await cache.running;
  } finally {
    cache.running = null;
  }
}

export function getScheduledProspectRadarSnapshot() {
  return state().snapshot;
}

export function ensureProspectRadarLoop() {
  const cache = state();
  if (cache.timerStarted) return;
  cache.timerStarted = true;

  const schedule = (delayMs: number) => {
    cache.timer = setTimeout(async () => {
      try {
        await runScheduledProspectRadar();
      } catch (error) {
        console.error(
          "[prospect-radar] automatic sweep failed",
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        schedule(60 * 60 * 1000);
      }
    }, delayMs);
    cache.timer.unref?.();
  };

  // Primeira execução logo após o processo Node carregar as rotas; depois repete a cada 1 hora.
  schedule(5_000);
}

export function getProspectRadarPublicStatus() {
  const cache = state();
  const snapshot = cache.snapshot;
  return {
    schedulerActive: cache.timerStarted,
    running: Boolean(cache.running),
    searchedAt: snapshot?.searchedAt ?? null,
    nextRunAt: snapshot?.nextRunAt ?? null,
    leads: snapshot?.result.leads.length ?? 0,
    hot: snapshot?.result.leads.filter((lead) => lead.intentStage === "quente").length ?? 0,
    providers: snapshot?.providers ?? [],
  };
}
