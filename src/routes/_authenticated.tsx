import { createFileRoute, Link, Outlet, redirect, useLocation, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Bell,
  Bot,
  Building2,
  Gavel,
  LogOut,
  Menu,
  MessageCircle,
  Plug,
  Search,
  UserRound,
  Workflow,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveTenantContext, type TenantContext } from "@/lib/tenant";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      throw redirect({ to: "/auth", search: { next: location.href } });
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

    return { session, user: session.user, roles: userRoles, tenant };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const signOut = async () => {
    await supabase.auth.signOut();
    void navigate({ to: "/" });
  };

  const items = [
    { to: "/dashboard", label: "Buscar imóveis", icon: Search },
    { to: "/leiloes", label: "CAIXA / Leilões", icon: Gavel },
    { to: "/alertas", label: "Alertas de imóveis", icon: Bell },
    { to: "/atendimento", label: "Conversas", icon: MessageCircle },
    { to: "/atendimento/fluxos", label: "Fluxos", icon: Workflow },
    { to: "/atendimento/assistente", label: "Assistente IA", icon: Bot },
    { to: "/atendimento/integracoes", label: "Integrações", icon: Plug },
    { to: "/settings/security", label: "Minha conta", icon: UserRound },
  ] as const;

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-r border-white/10 bg-[#07111f] text-white">
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-300/10 text-cyan-200 ring-1 ring-cyan-300/20">
          <Building2 className="h-5 w-5" />
        </span>
        <div className="leading-tight">
          <div className="font-black tracking-tight">Mercado<span className="text-cyan-300">Imobi</span></div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Plataforma imobiliária</div>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="px-3 pb-2 pt-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-600">Imóveis</p>
        {items.slice(0, 3).map((item) => <SidebarLink key={item.to} item={item} pathname={location.pathname} onClick={() => setMobileOpen(false)} />)}

        <p className="px-3 pb-2 pt-6 text-[10px] font-black uppercase tracking-[0.18em] text-slate-600">Atendimento</p>
        {items.slice(3, 7).map((item) => <SidebarLink key={item.to} item={item} pathname={location.pathname} onClick={() => setMobileOpen(false)} />)}

        <p className="px-3 pb-2 pt-6 text-[10px] font-black uppercase tracking-[0.18em] text-slate-600">Conta</p>
        {items.slice(7).map((item) => <SidebarLink key={item.to} item={item} pathname={location.pathname} onClick={() => setMobileOpen(false)} />)}
      </nav>

      <div className="border-t border-white/10 p-3">
        <button
          onClick={() => void signOut()}
          className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold text-slate-400 transition hover:bg-rose-400/[0.07] hover:text-rose-200"
        >
          <LogOut className="h-4 w-4" /> Sair
        </button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-[#06101c]">
      <div className="fixed inset-y-0 left-0 z-50 hidden lg:block">{sidebar}</div>
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-white/10 bg-[#07111f]/95 px-4 text-white backdrop-blur-xl lg:hidden">
        <div className="flex items-center gap-2 font-black"><Building2 className="h-5 w-5 text-cyan-300" /> Mercado<span className="-ml-2 text-cyan-300">Imobi</span></div>
        <button onClick={() => setMobileOpen(true)} className="grid h-9 w-9 place-items-center rounded-xl border border-white/10"><Menu className="h-4 w-4" /></button>
      </div>
      {mobileOpen && (
        <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)}>
          <div className="h-full w-72 max-w-[88vw]" onClick={(event) => event.stopPropagation()}>
            <div className="relative h-full">{sidebar}<button onClick={() => setMobileOpen(false)} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-slate-300"><X className="h-4 w-4" /></button></div>
          </div>
        </div>
      )}
      <div className="min-h-screen lg:pl-64"><Outlet /></div>
    </div>
  );
}

function SidebarLink({ item, pathname, onClick }: { item: { to: string; label: string; icon: React.ComponentType<{ className?: string }> }; pathname: string; onClick: () => void }) {
  const Icon = item.icon;
  const active = pathname === item.to || (item.to !== "/dashboard" && pathname.startsWith(`${item.to}/`));
  return (
    <Link
      to={item.to}
      onClick={onClick}
      className={`mb-1 flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition ${active ? "bg-cyan-300/[0.10] text-cyan-100 ring-1 ring-cyan-300/15" : "text-slate-400 hover:bg-white/[0.045] hover:text-white"}`}
    >
      <Icon className={`h-4 w-4 ${active ? "text-cyan-300" : ""}`} />
      {item.label}
    </Link>
  );
}
