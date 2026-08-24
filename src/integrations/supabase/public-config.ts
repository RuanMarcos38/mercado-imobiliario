const MERCADOIMOBI_SUPABASE_PROJECT_ID = "uwzfgksmnqgaxtscwxow";

const FORBIDDEN_SUPABASE_PROJECT_IDS = new Set([
  "iqrnytsgwaiegddfxfjs", // CRM R2 MARKETING DIGITAL — outro projeto, não alterar/usar aqui.
]);

function normalize(value: string | undefined): string {
  return (value ?? "").trim();
}

function projectIdFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.endsWith(".supabase.co") ? (host.split(".")[0] ?? "") : "";
  } catch {
    return "";
  }
}

const configuredUrl = normalize(import.meta.env.VITE_SUPABASE_URL);
const configuredProjectId =
  normalize(import.meta.env.VITE_SUPABASE_PROJECT_ID) || projectIdFromUrl(configuredUrl);
const configuredPublishableKey = normalize(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);

if (configuredProjectId && FORBIDDEN_SUPABASE_PROJECT_IDS.has(configuredProjectId)) {
  throw new Error("MercadoImobi cannot use the CRM R2 MARKETING DIGITAL Supabase project");
}

if (configuredProjectId && configuredProjectId !== MERCADOIMOBI_SUPABASE_PROJECT_ID) {
  throw new Error(
    `MercadoImobi must use its production Supabase project (${MERCADOIMOBI_SUPABASE_PROJECT_ID})`,
  );
}

export const PUBLIC_SUPABASE_URL = configuredUrl;
export const PUBLIC_SUPABASE_PUBLISHABLE_KEY = configuredPublishableKey;
export const PUBLIC_SUPABASE_PROJECT_ID = configuredProjectId;
