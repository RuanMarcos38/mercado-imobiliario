export async function resolvePlatformSecret(envName: string, vaultName: string) {
  const direct = process.env[envName]?.trim() || "";
  if (direct) return direct;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any).rpc("get_platform_secret", {
      p_name: vaultName,
    });
    if (!error && typeof data === "string" && data.trim()) return data.trim();
  } catch {
    // The caller decides whether an absent optional secret is fatal.
  }
  return "";
}

export async function hasPlatformSecret(envName: string, vaultName: string) {
  return Boolean(await resolvePlatformSecret(envName, vaultName));
}
