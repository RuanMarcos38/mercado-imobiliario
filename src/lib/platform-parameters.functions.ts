import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requirePlatformAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("FORBIDDEN_ADMIN");
}

export const getPlatformParameterOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context);
    const {
      integrationReadiness,
      platformBaseUrl,
      platformParameterDefinitions,
    } = await import("@/lib/platform-parameters.server");

    const definitions = platformParameterDefinitions();
    return {
      checkedAt: new Date().toISOString(),
      baseUrl: platformBaseUrl(),
      parameters: definitions.map((parameter) => ({
        ...parameter,
        isDefault: parameter.value === parameter.defaultValue,
      })),
      integrations: integrationReadiness(),
    };
  });
