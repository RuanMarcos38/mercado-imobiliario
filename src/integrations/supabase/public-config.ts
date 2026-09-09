const MERCADOIMOBI_SUPABASE_PROJECT_ID = "uwzfgksmnqgaxtscwxow";
const MERCADOIMOBI_SUPABASE_URL = `https://${MERCADOIMOBI_SUPABASE_PROJECT_ID}.supabase.co`;

// Supabase publishable keys are intentionally public and are safe to ship in browser code.
// This binding is authoritative for MercadoImobi so stale EasyPanel VITE_* variables cannot
// redirect authentication or browser queries to another Supabase project.
const MERCADOIMOBI_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_mZUNYHM3JeRZXR8vWfVECA_7gCgTp7i";

export const PUBLIC_SUPABASE_PROJECT_ID = MERCADOIMOBI_SUPABASE_PROJECT_ID;
export const PUBLIC_SUPABASE_URL = MERCADOIMOBI_SUPABASE_URL;
export const PUBLIC_SUPABASE_PUBLISHABLE_KEY = MERCADOIMOBI_SUPABASE_PUBLISHABLE_KEY;
