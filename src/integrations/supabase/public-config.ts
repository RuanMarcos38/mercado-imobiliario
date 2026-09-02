const MERCADOIMOBI_SUPABASE_PROJECT_ID = "uwzfgksmnqgaxtscwxow";
const MERCADOIMOBI_SUPABASE_URL = `https://${MERCADOIMOBI_SUPABASE_PROJECT_ID}.supabase.co`;

// Supabase publishable keys are intentionally public and are safe to ship in browser code.
// Keep this fallback aligned with the RM NEGOCIO IMOBILIARIO project so a stale EasyPanel
// VITE_* configuration cannot redirect authentication to another Supabase project.
const MERCADOIMOBI_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_mZUNYHM3JeRZXR8vWfVECA_7gCgTp7i";

const env = import.meta.env as Record<string, string | undefined>;

const configuredUrl = String(env.VITE_SUPABASE_URL || "").trim();
const configuredProjectId = String(env.VITE_SUPABASE_PROJECT_ID || "").trim();
const configuredPublishableKey = String(env.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim();

const envTargetsRmNegocio =
  configuredProjectId === MERCADOIMOBI_SUPABASE_PROJECT_ID &&
  configuredUrl === MERCADOIMOBI_SUPABASE_URL &&
  Boolean(configuredPublishableKey);

export const PUBLIC_SUPABASE_PROJECT_ID = MERCADOIMOBI_SUPABASE_PROJECT_ID;
export const PUBLIC_SUPABASE_URL = MERCADOIMOBI_SUPABASE_URL;
export const PUBLIC_SUPABASE_PUBLISHABLE_KEY = envTargetsRmNegocio
  ? configuredPublishableKey
  : MERCADOIMOBI_SUPABASE_PUBLISHABLE_KEY;
