import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const updateSchema = z.object({
  userId: z.string().uuid(),
  featureKey: z.string().trim().min(2).max(80),
  allowed: z.boolean(),
});

async function requireAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("FORBIDDEN_ADMIN");
}

export const getFeatureAccessAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const [{ data: profiles, error: profilesError }, { data: features }, { data: overrides }] =
      await Promise.all([
        db
          .from("profiles")
          .select("id,full_name,company_name,user_type,is_active,created_at")
          .order("created_at", { ascending: false })
          .limit(1000),
        db
          .from("platform_features")
          .select("feature_key,label,description,route_prefix,default_allowed,sort_order")
          .order("sort_order", { ascending: true }),
        db.from("user_feature_access").select("user_id,feature_key,allowed,updated_at"),
      ]);
    if (profilesError) throw new Error(profilesError.message);
    const map = new Map<string, boolean>();
    for (const row of overrides ?? [])
      map.set(`${row.user_id}:${row.feature_key}`, Boolean(row.allowed));
    return {
      features: (features ?? []).map((feature: any) => ({
        key: String(feature.feature_key),
        label: String(feature.label),
        description: String(feature.description || ""),
        routePrefix: feature.route_prefix ? String(feature.route_prefix) : null,
        defaultAllowed: feature.default_allowed !== false,
      })),
      users: (profiles ?? []).map((profile: any) => ({
        id: String(profile.id),
        name: String(profile.full_name || "Usuário"),
        company: profile.company_name ? String(profile.company_name) : null,
        userType: profile.user_type ? String(profile.user_type) : null,
        isActive: profile.is_active !== false,
        access: Object.fromEntries(
          (features ?? []).map((feature: any) => [
            String(feature.feature_key),
            map.has(`${profile.id}:${feature.feature_key}`)
              ? map.get(`${profile.id}:${feature.feature_key}`)
              : feature.default_allowed !== false,
          ]),
        ),
      })),
    };
  });

export const updateFeatureAccessAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateSchema.parse(data))
  .handler(async ({ context, data }) => {
    await requireAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: feature, error: featureError } = await (supabaseAdmin as any)
      .from("platform_features")
      .select("feature_key")
      .eq("feature_key", data.featureKey)
      .maybeSingle();
    if (featureError || !feature) throw new Error("Funcionalidade não encontrada.");
    const { error } = await (supabaseAdmin as any).from("user_feature_access").upsert(
      {
        user_id: data.userId,
        feature_key: data.featureKey,
        allowed: data.allowed,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,feature_key" },
    );
    if (error) throw new Error(error.message);
    return { success: true };
  });
