import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Resolve o tenant do usuário autenticado usando o próprio client com RLS.
 *
 * Lança erro quando não existe vínculo: sem tenant, qualquer escrita seria
 * recusada pelas policies (`is_tenant_member(tenant_id)`), então é melhor
 * falhar cedo com mensagem clara do que gravar dado órfão.
 */
export async function requireTenantId(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao resolver a organização do usuário: ${error.message}`);
  }
  if (!data?.tenant_id) {
    throw new Error("Usuário sem organização vinculada. Refaça o login ou contate o suporte.");
  }

  return data.tenant_id;
}
