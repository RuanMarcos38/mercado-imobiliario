import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { resolveTenantContext, type TenantContext } from "@/lib/tenant";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      throw redirect({
        to: "/auth",
        search: {
          next: location.href,
        },
      });
    }

    // Bypass temporário de verificação de permissões no beforeLoad para permitir entrada
    // se o banco estiver retornando erro de schema durante o handshake
    let userRoles: string[] = [];
    try {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);
      userRoles = data?.map((r) => r.role) || [];
    } catch (e) {
      console.warn("Aviso: Falha ao carregar roles no middleware, permitindo acesso básico.");
    }

    // Login multi-tenant: resolve a organização do usuário para escopo de dados
    let tenant: TenantContext | null = null;
    try {
      tenant = await resolveTenantContext(session.user.id);
    } catch (e) {
      console.warn("Aviso: Falha ao resolver tenant do usuário.");
    }

    return {
      session,
      user: session.user,
      roles: userRoles,
      tenant,
    };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return <Outlet />;
}
