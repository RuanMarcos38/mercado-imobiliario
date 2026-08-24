const MERCADOIMOBI_SUPABASE_PROJECT_ID = "uwzfgksmnqgaxtscwxow";
const MERCADOIMOBI_SUPABASE_URL = "https://uwzfgksmnqgaxtscwxow.supabase.co";
const MERCADOIMOBI_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_mZUNYHM3JeRZXR8vWfVECA_7gCgTp7i";

// MercadoImobi production authentication is intentionally pinned to its existing
// Supabase project. EasyPanel may still contain stale VITE_* build arguments from
// an older deployment; those values must never redirect the browser auth client to
// another Supabase project.
export const PUBLIC_SUPABASE_URL = MERCADOIMOBI_SUPABASE_URL;
export const PUBLIC_SUPABASE_PUBLISHABLE_KEY = MERCADOIMOBI_SUPABASE_PUBLISHABLE_KEY;
export const PUBLIC_SUPABASE_PROJECT_ID = MERCADOIMOBI_SUPABASE_PROJECT_ID;
