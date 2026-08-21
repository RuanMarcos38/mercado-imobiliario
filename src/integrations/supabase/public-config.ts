const MERCADOIMOBI_SUPABASE_PROJECT_ID = "uwzfgksmnqgaxtscwxow";
const MERCADOIMOBI_SUPABASE_URL = `https://${MERCADOIMOBI_SUPABASE_PROJECT_ID}.supabase.co`;

// MercadoImobi is intentionally pinned to the RM NEGOCIO IMOBILIARIO Supabase project.
// This target is also verified by the deployed MercadoImobi schema and admin authentication data.
// The publishable key is public by design; authorization remains enforced by Supabase Auth + RLS.
// Keeping this binding deterministic prevents stale EasyPanel/Lovable environment variables from
// silently authenticating users against another Supabase project.
export const PUBLIC_SUPABASE_URL = MERCADOIMOBI_SUPABASE_URL;
export const PUBLIC_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_mZUNYHM3JeRZXR8vWfVECA_7gCgTp7i";
export const PUBLIC_SUPABASE_PROJECT_ID = MERCADOIMOBI_SUPABASE_PROJECT_ID;
