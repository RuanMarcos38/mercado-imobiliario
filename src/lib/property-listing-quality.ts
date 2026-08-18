export const PROPERTY_FRESHNESS_SLA_MINUTES = 120;

const REAL_ESTATE_TERMS = [
  "imovel",
  "apartamento",
  "casa",
  "terreno",
  "lote",
  "sobrado",
  "kitnet",
  "studio",
  "loft",
  "cobertura",
  "chacara",
  "sitio",
  "fazenda",
  "galpao",
  "sala comercial",
  "loja",
  "predio",
  "condominio",
];

const EDITORIAL_PATH_TERMS = [
  "/blog",
  "/noticia",
  "/noticias",
  "/news",
  "/artigo",
  "/artigos",
  "/conteudo",
  "/conteudos",
  "/institucional",
  "/imprensa",
  "/dicas",
  "/guia",
];

const EDITORIAL_TITLE_TERMS = [
  "mercado imobiliario",
  "noticias do mercado",
  "saiba como",
  "entenda como",
  "veja como",
  "confira as dicas",
  "dicas para",
  "guia para",
  "tendencias do mercado",
  "a escolha dos nossos",
  "protecao do seu investimento",
];

const SALE_INTENT_TERMS = [
  "venda",
  "vende-se",
  "comprar",
  "compre",
  "a venda",
  "à venda",
  "lancamento",
  "lançamento",
  "pronto para morar",
  "leilao",
  "leilão",
];

const ALLOWED_PROPERTY_HOSTS = [
  "venda-imoveis.caixa.gov.br",
  "zapimoveis.com.br",
  "vivareal.com.br",
  "olx.com.br",
  "imovelweb.com.br",
  "quintoandar.com.br",
  "chavesnamao.com.br",
  "netimoveis.com",
  "orulo.com.br",
  "mrv.com.br",
  "rogga.com.br",
  "rottasconstrutora.com.br",
  "inicioempreendimentos.com.br",
];

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function hostAllowed(hostname: string) {
  const host = hostname.toLowerCase();
  return ALLOWED_PROPERTY_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function hasValidImage(images: string[] | null | undefined) {
  return (images ?? []).some((image) => /^https?:\/\//i.test(image));
}

export function isFreshListing(timestamp: string | null | undefined, nowMs = Date.now()) {
  if (!timestamp) return false;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return false;
  const ageMs = nowMs - parsed;
  if (ageMs < -5 * 60 * 1000) return false;
  return ageMs <= PROPERTY_FRESHNESS_SLA_MINUTES * 60 * 1000;
}

export function isRealEstateListing(input: {
  source_url: string | null | undefined;
  title?: string | null;
  description?: string | null;
  property_type?: string | null;
  price?: number | null;
  location_address?: string | null;
  location_city?: string | null;
  location_state?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  area_sqm?: number | null;
  images?: string[] | null;
  listing_market?: string | null;
  is_auction?: boolean | null;
  sale_mode?: string | null;
}) {
  if (!input.source_url) return false;
  let url: URL;
  try {
    url = new URL(input.source_url);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(url.protocol) || !hostAllowed(url.hostname)) return false;

  const normalizedPath = normalize(`${url.pathname} ${url.search}`);
  if (EDITORIAL_PATH_TERMS.some((term) => normalizedPath.includes(term))) return false;

  const title = normalize(input.title);
  const description = normalize(input.description);
  const propertyType = normalize(input.property_type);
  const context = normalize([propertyType, title, description].filter(Boolean).join(" "));

  if (EDITORIAL_TITLE_TERMS.some((term) => title.includes(normalize(term)))) return false;

  const hasPropertyContext = REAL_ESTATE_TERMS.some((term) => context.includes(term));
  if (!hasPropertyContext) return false;

  const isCaixaOrAuction = input.listing_market === "caixa" || Boolean(input.is_auction);
  const hasPrice = typeof input.price === "number" && Number.isFinite(input.price) && input.price > 1000;
  const hasLocation = Boolean(input.location_city || input.location_address || input.location_state);
  const hasPropertyDetails =
    (typeof input.area_sqm === "number" && input.area_sqm > 0) ||
    (typeof input.bedrooms === "number" && input.bedrooms > 0) ||
    (typeof input.bathrooms === "number" && input.bathrooms > 0);
  const hasImage = hasValidImage(input.images);
  const hasSaleIntent = SALE_INTENT_TERMS.some((term) => context.includes(normalize(term))) || Boolean(input.sale_mode);

  // Bases oficiais da CAIXA e leilões já representam unidades efetivamente ofertadas.
  if (isCaixaOrAuction) return true;

  // Portais generalistas (especialmente OLX) precisam de evidência concreta de anúncio imobiliário.
  // Uma simples menção a casa/apartamento em matéria, institucional ou conteúdo comercial não basta.
  const hostname = url.hostname.toLowerCase();
  const isMarketplace = [
    "zapimoveis.com.br",
    "vivareal.com.br",
    "olx.com.br",
    "imovelweb.com.br",
    "quintoandar.com.br",
    "chavesnamao.com.br",
    "netimoveis.com",
    "orulo.com.br",
  ].some((host) => hostname === host || hostname.endsWith(`.${host}`));

  if (isMarketplace) {
    return hasPrice || (hasLocation && hasPropertyDetails && hasImage);
  }

  // Sites de construtoras também publicam notícias, institucional e páginas de marketing.
  // Só aceitamos a página quando houver sinais de uma unidade/empreendimento realmente à venda.
  const evidenceScore = [hasPrice, hasLocation, hasPropertyDetails, hasImage, hasSaleIntent].filter(Boolean).length;
  return evidenceScore >= 3 && (hasPrice || hasPropertyDetails) && (hasLocation || hasSaleIntent);
}

export function isFreshRealEstateListing(
  input: {
    source_url: string | null | undefined;
    title?: string | null;
    description?: string | null;
    property_type?: string | null;
    price?: number | null;
    location_address?: string | null;
    location_city?: string | null;
    location_state?: string | null;
    bedrooms?: number | null;
    bathrooms?: number | null;
    area_sqm?: number | null;
    images?: string[] | null;
    listing_market?: string | null;
    is_auction?: boolean | null;
    sale_mode?: string | null;
    updated_at?: string | null;
  },
  nowMs = Date.now(),
) {
  return isRealEstateListing(input) && isFreshListing(input.updated_at, nowMs);
}
