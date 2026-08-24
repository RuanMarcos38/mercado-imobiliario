export const PROPERTY_FRESHNESS_SLA_MINUTES = 90 * 24 * 60;

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
  "ayoshii.com.br",
  "tenda.com.br",
  "curyconstrutora.com.br",
  "cyrela.com.br",
  "even.com.br",
  "eztec.com.br",
  "gafisa.com.br",
  "grupodirecional.com",
  "direcional.com.br",
  "rivaincorporadora.com.br",
  "helbor.com.br",
  "mouradubeux.com.br",
  "patrimar.com.br",
  "plaenge.com.br",
  "planoeplano.com.br",
  "canalpro.grupozap.com",
];

const NON_LISTING_PATH_MARKERS = [
  "/blog",
  "/noticia",
  "/noticias",
  "/news",
  "/conteudo",
  "/artigo",
  "/artigos",
  "/fale-conosco",
  "/contato",
  "/institucional",
  "/sobre",
  "/quem-somos",
  "/trabalhe-conosco",
  "/politica-de-privacidade",
  "/privacidade",
  "/termos",
  "/categoria/",
  "/tag/",
  "/author/",
  "/search/",
  "/acompanhe-sua-obra",
  "/preview",
  "/canal-do-terreno",
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

function isNonListingPath(pathname: string) {
  const path = pathname.toLowerCase();
  return NON_LISTING_PATH_MARKERS.some((marker) => path.includes(marker));
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
}) {
  if (!input.source_url) return false;
  let url: URL;
  try {
    url = new URL(input.source_url);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(url.protocol) || !hostAllowed(url.hostname)) return false;
  if (isNonListingPath(url.pathname)) return false;

  const context = normalize(
    [input.property_type, input.title, input.description].filter(Boolean).join(" "),
  );
  const hasPropertyContext = REAL_ESTATE_TERMS.some((term) => context.includes(term));
  if (!hasPropertyContext) return false;

  if (url.hostname === "olx.com.br" || url.hostname.endsWith(".olx.com.br"))
    return hasPropertyContext;
  return true;
}

export function isQualifiedPropertyRecord(input: {
  listing_market?: string | null;
  is_auction?: boolean | null;
  price?: number | null;
  location_address?: string | null;
  location_city?: string | null;
  area_sqm?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
}) {
  if (input.listing_market === "caixa" || input.is_auction) return true;

  const hasStructuredCommercialFact =
    (typeof input.price === "number" && input.price > 0) ||
    Boolean(input.location_address?.trim()) ||
    Boolean(input.location_city?.trim()) ||
    (typeof input.area_sqm === "number" && input.area_sqm > 0) ||
    (typeof input.bedrooms === "number" && input.bedrooms > 0) ||
    (typeof input.bathrooms === "number" && input.bathrooms > 0);

  return hasStructuredCommercialFact;
}

export function isFreshRealEstateListing(
  input: {
    source_url: string | null | undefined;
    title?: string | null;
    description?: string | null;
    property_type?: string | null;
    updated_at?: string | null;
    listing_market?: string | null;
    is_auction?: boolean | null;
    price?: number | null;
    location_address?: string | null;
    location_city?: string | null;
    area_sqm?: number | null;
    bedrooms?: number | null;
    bathrooms?: number | null;
  },
  nowMs = Date.now(),
) {
  return (
    isRealEstateListing(input) &&
    isFreshListing(input.updated_at, nowMs) &&
    isQualifiedPropertyRecord(input)
  );
}
