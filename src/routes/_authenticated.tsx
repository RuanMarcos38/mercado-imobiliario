import { createFileRoute, Link, Outlet, redirect, useLocation } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
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

    let userRoles: string[] = [];
    try {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);
      userRoles = data?.map((role) => role.role) || [];
    } catch {
      console.warn("Não foi possível carregar as permissões da conta neste momento.");
    }

    let tenant: TenantContext | null = null;
    try {
      tenant = await resolveTenantContext(session.user.id);
    } catch {
      console.warn("Não foi possível carregar a organização da conta neste momento.");
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
  const location = useLocation();
  const insideAtendimento = location.pathname === "/atendimento";

  return (
    <>
      <Outlet />
      {!insideAtendimento && (
        <Link
          to="/atendimento"
          className="fixed bottom-5 right-5 z-40 inline-flex h-12 items-center gap-2 rounded-2xl border border-cyan-200/20 bg-[#0b1727]/95 px-4 text-sm font-bold text-cyan-100 shadow-2xl shadow-black/30 backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-cyan-200/35 hover:bg-[#102238]"
          aria-label="Abrir Atendimento"
        >
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-cyan-300 text-[#06101c]">
            <MessageCircle className="h-4 w-4" />
          </span>
          Atendimento
        </Link>
      )}
    </>
  );
}
