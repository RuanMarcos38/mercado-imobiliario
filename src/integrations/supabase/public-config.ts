const MERCADOIMOBI_SUPABASE_PROJECT_ID = "rjlqylmwenhzkzmqwris";
const MERCADOIMOBI_SUPABASE_URL = `https://${MERCADOIMOBI_SUPABASE_PROJECT_ID}.supabase.co`;

function runtimeEnv(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env[name] : undefined;
}

function configuredEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = runtimeEnv(name);
    if (value) return value;
  }
  return undefined;
}

export const PUBLIC_SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  configuredEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]) ||
  MERCADOIMOBI_SUPABASE_URL;

// Supabase publishable keys are intentionally public and safe to ship in browser applications.
// RLS remains responsible for protecting user data. Keep the key in environment config so
// builds cannot accidentally point MercadoImobi at another Supabase project.
export const PUBLIC_SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  configuredEnv(["SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"]) ||
  "";

export const PUBLIC_SUPABASE_PROJECT_ID =
  import.meta.env.VITE_SUPABASE_PROJECT_ID ||
  configuredEnv(["SUPABASE_PROJECT_ID", "VITE_SUPABASE_PROJECT_ID"]) ||
  MERCADOIMOBI_SUPABASE_PROJECT_ID;
