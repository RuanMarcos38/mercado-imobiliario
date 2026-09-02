const env = import.meta.env as Record<string, string | undefined>;

const projectId = String(env.VITE_SUPABASE_PROJECT_ID ?? "").trim();
const configuredUrl = String(env.VITE_SUPABASE_URL ?? "").trim();
const publishableKey = String(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();

const forbiddenProjectIds = new Set([
  "uwzfgksmnqga" + "xtscwxow", // RM NEGOCIO IMOBILIARIO
  "iqrnytsgwaie" + "gddfxfjs", // CRM R2 MARKETING DIGITAL
]);

if (!projectId) {
  throw new Error("MercadoImobi Supabase project is not configured.");
}
if (forbiddenProjectIds.has(projectId)) {
  throw new Error("MercadoImobi cannot use a Supabase project reserved for another system.");
}
if (!/^[a-z0-9]{20}$/.test(projectId)) {
  throw new Error("MercadoImobi Supabase project ref is invalid.");
}

const expectedUrl = `https://${projectId}.supabase.co`;
if (configuredUrl && configuredUrl !== expectedUrl) {
  throw new Error("MercadoImobi Supabase URL does not match its configured project ref.");
}

export const PUBLIC_SUPABASE_PROJECT_ID = projectId;
export const PUBLIC_SUPABASE_URL = configuredUrl || expectedUrl;
export const PUBLIC_SUPABASE_PUBLISHABLE_KEY = publishableKey;
