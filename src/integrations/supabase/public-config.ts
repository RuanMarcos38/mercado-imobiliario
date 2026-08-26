const FORBIDDEN_SUPABASE_PROJECT_IDS = new Set([
  "uwzfgksmnqga" + "xtscwxow", // RM NEGOCIO IMOBILIARIO
  "iqrnytsgwaie" + "gddfxfjs", // CRM R2 MARKETING DIGITAL
]);

const env = import.meta.env as Record<string, string | undefined>;

export const PUBLIC_SUPABASE_URL = String(env.VITE_SUPABASE_URL || "").trim();
export const PUBLIC_SUPABASE_PUBLISHABLE_KEY = String(
  env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
).trim();
export const PUBLIC_SUPABASE_PROJECT_ID = String(env.VITE_SUPABASE_PROJECT_ID || "").trim();

const hasAnySupabaseConfig = Boolean(
  PUBLIC_SUPABASE_URL || PUBLIC_SUPABASE_PUBLISHABLE_KEY || PUBLIC_SUPABASE_PROJECT_ID,
);
const hasCompleteSupabaseConfig = Boolean(
  PUBLIC_SUPABASE_URL && PUBLIC_SUPABASE_PUBLISHABLE_KEY && PUBLIC_SUPABASE_PROJECT_ID,
);

if (hasAnySupabaseConfig && !hasCompleteSupabaseConfig) {
  throw new Error("MercadoImobi Supabase configuration is incomplete");
}

if (FORBIDDEN_SUPABASE_PROJECT_IDS.has(PUBLIC_SUPABASE_PROJECT_ID)) {
  throw new Error("MercadoImobi must not use RM NEGOCIO IMOBILIARIO or CRM R2 MARKETING DIGITAL");
}

if (hasCompleteSupabaseConfig) {
  const expectedHost = `${PUBLIC_SUPABASE_PROJECT_ID}.supabase.co`;
  try {
    if (new URL(PUBLIC_SUPABASE_URL).hostname !== expectedHost) {
      throw new Error("MercadoImobi Supabase URL does not match VITE_SUPABASE_PROJECT_ID");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("does not match")) throw error;
    throw new Error("MercadoImobi Supabase URL is invalid");
  }
}
