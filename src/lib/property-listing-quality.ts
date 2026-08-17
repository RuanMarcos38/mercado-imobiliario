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
  if (!['http:', 'https:'].includes(url.protocol) || !hostAllowed(url.hostname)) return false;

  const context = normalize([input.property_type, input.title, input.description].filter(Boolean).join(" "));
  const hasPropertyContext = REAL_ESTATE_TERMS.some((term) => context.includes(term));
  if (!hasPropertyContext) return false;

  // OLX possui várias categorias; nela o contexto imobiliário é obrigatório e nunca é inferido só pelo domínio.
  if (url.hostname === "olx.com.br" || url.hostname.endsWith(".olx.com.br")) return hasPropertyContext;
  return true;
}

export function isFreshRealEstateListing(input: {
  source_url: string | null | undefined;
  title?: string | null;
  description?: string | null;
  property_type?: string | null;
  updated_at?: string | null;
}, nowMs = Date.now()) {
  return isRealEstateListing(input) && isFreshListing(input.updated_at, nowMs);
}
