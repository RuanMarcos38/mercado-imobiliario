import { supabase } from "@/integrations/supabase/client";

export type TenantMemberRole = "owner" | "admin" | "member";

export interface TenantContext {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  memberRole: TenantMemberRole;
}

/**
 * Resolve o tenant (organização) do usuário autenticado.
 *
 * O isolamento real é garantido pelas policies de RLS: as leituras abaixo só
 * retornam linhas do tenant do próprio usuário. Retorna `null` quando o
 * vínculo ainda não existe (ex.: perfil recém-criado), permitindo que a UI
 * trate o estado sem quebrar a navegação.
 */
export async function resolveTenantContext(userId: string): Promise<TenantContext | null> {
  const { data, error } = await supabase
    .from("tenant_members")
    .select("member_role, tenant_id, tenants(id, name, slug)")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Falha ao resolver tenant do usuário:", error.message);
    return null;
  }

  const tenant = data?.tenants;
  if (!data || !tenant) return null;

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    memberRole: (data.member_role as TenantMemberRole) ?? "member",
  };
}
