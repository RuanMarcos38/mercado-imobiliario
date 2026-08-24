const FORBIDDEN_SUPABASE_PROJECT_IDS = new Set([
  "uwzfgksmnqgaxtscwxow", // RM NEGOCIO IMOBILIARIO
  "iqrnytsgwaiegddfxfjs", // CRM R2 MARKETING DIGITAL
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
  throw new Error(
    "MercadoImobi cannot use the RM NEGOCIO IMOBILIARIO or CRM R2 MARKETING DIGITAL Supabase project",
  );
}

export const PUBLIC_SUPABASE_URL = configuredUrl;
export const PUBLIC_SUPABASE_PUBLISHABLE_KEY = configuredPublishableKey;
export const PUBLIC_SUPABASE_PROJECT_ID = configuredProjectId;
