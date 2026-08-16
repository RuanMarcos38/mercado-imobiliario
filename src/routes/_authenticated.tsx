import { createFileRoute, Link, Outlet, redirect, useLocation, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Bell,
  Bot,
  Building2,
  Gavel,
  Heart,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Plug,
  Search,
  Settings,
  Sparkles,
  UserRound,
  Workflow,
  X,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
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
  const [globalSearch, setGlobalSearch] = useState("");

  const signOut = async () => {
    await supabase.auth.signOut();
    void navigate({ to: "/" });
  };

  const runGlobalSearch = () => {
    const value = globalSearch.trim();
    if (!value) return;
    sessionStorage.setItem("mercadoimobi:globalSearch", value);
    void navigate({ to: "/dashboard" }).then(() => {
      window.dispatchEvent(new CustomEvent("mercadoimobi:global-search", { detail: value }));
    });
  };

  const items = [
    { to: "/dashboard", label: "Buscar imóveis", icon: Search },
    { to: "/leiloes", label: "Leilões CAIXA", icon: Gavel },
    { to: "/alertas", label: "Alertas", icon: Bell },
    { to: "/atendimento", label: "Atendimento", icon: MessageCircle },
    { to: "/fluxos", label: "Fluxos", icon: Workflow },
    { to: "/assistente", label: "Assistente IA", icon: Bot },
    { to: "/integracoes", label: "Fontes de imóveis", icon: Plug },
    { to: "/settings/security", label: "Minha conta", icon: UserRound },
  ] as const;

  const sidebar = (
    <aside className="mi-sidebar flex h-full w-[224px] flex-col border-r">
      <div className="flex h-[72px] items-center gap-3 border-b border-[var(--mi-border)] px-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-600/20">
          <Building2 className="h-5 w-5" />
        </span>
        <div className="leading-tight">
          <div className="text-[17px] font-black tracking-tight text-[var(--mi-text)]">
            Mercado<span className="text-blue-600">Imobi</span>
          </div>
          <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--mi-text-soft)]">
            Plataforma imobiliária
          </div>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="mb-5">
          <p className="px-3 pb-2 text-[9px] font-black uppercase tracking-[0.18em] text-[var(--mi-text-soft)]">Imóveis</p>
          <SidebarStatic active={location.pathname === "/dashboard"} icon={LayoutDashboard} label="Dashboard" to="/dashboard" onClick={() => setMobileOpen(false)} />
          {items.slice(0, 3).map((item) => (
            <SidebarLink key={item.to} item={item} pathname={location.pathname} onClick={() => setMobileOpen(false)} />
          ))}
        </div>

        <div className="mb-5">
          <p className="px-3 pb-2 text-[9px] font-black uppercase tracking-[0.18em] text-[var(--mi-text-soft)]">Relacionamento</p>
          {items.slice(3, 6).map((item) => (
            <SidebarLink key={item.to} item={item} pathname={location.pathname} onClick={() => setMobileOpen(false)} />
          ))}
        </div>

        <div>
          <p className="px-3 pb-2 text-[9px] font-black uppercase tracking-[0.18em] text-[var(--mi-text-soft)]">Gestão</p>
          {items.slice(6).map((item) => (
            <SidebarLink key={item.to} item={item} pathname={location.pathname} onClick={() => setMobileOpen(false)} />
          ))}
          <Link
            to="/settings/security"
            onClick={() => setMobileOpen(false)}
            className="mi-sidebar-link"
          >
            <Settings className="h-4 w-4" /> Configurações
          </Link>
        </div>
      </nav>

      <div className="border-t border-[var(--mi-border)] p-3">
        <div className="mi-plan-card mb-3 rounded-2xl border p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-black text-[var(--mi-text)]">MercadoImobi</p>
              <p className="mt-1 text-[10px] leading-4 text-[var(--mi-text-muted)]">Busca, alertas e atendimento em um único ambiente.</p>
            </div>
            <Sparkles className="h-4 w-4 shrink-0 text-blue-600" />
          </div>
        </div>
        <div className="mb-2 px-1 text-[9px] font-black uppercase tracking-[0.14em] text-[var(--mi-text-soft)]">Aparência</div>
        <ThemeToggle />
        <button
          onClick={() => void signOut()}
          className="mt-2 flex h-10 w-full items-center gap-3 rounded-xl px-3 text-xs font-semibold text-[var(--mi-text-muted)] transition hover:bg-rose-500/10 hover:text-rose-600"
        >
          <LogOut className="h-4 w-4" /> Sair
        </button>
      </div>
    </aside>
  );

  return (
    <div className="mi-shell min-h-screen">
      <div className="fixed inset-y-0 left-0 z-50 hidden lg:block">{sidebar}</div>

      <header className="mi-topbar sticky top-0 z-40 hidden h-[64px] items-center justify-between gap-5 border-b px-6 lg:ml-[224px] lg:flex">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            runGlobalSearch();
          }}
          className="mi-global-search flex h-10 w-full max-w-2xl items-center gap-2 rounded-xl border px-3"
        >
          <Search className="h-4 w-4 text-[var(--mi-text-soft)]" />
          <input
            value={globalSearch}
            onChange={(event) => setGlobalSearch(event.target.value)}
            placeholder="Buscar imóveis, cidades, bairros ou referências..."
            className="min-w-0 flex-1 bg-transparent text-xs text-[var(--mi-text)] outline-none placeholder:text-[var(--mi-text-soft)]"
          />
          <span className="rounded-md border border-[var(--mi-border)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--mi-text-soft)]">Enter</span>
        </form>

        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle compact />
          <Link to="/alertas" className="mi-icon-button relative" title="Alertas">
            <Bell className="h-4 w-4" />
          </Link>
          <Link to="/settings/security" className="flex h-10 items-center gap-2 rounded-xl px-2.5 transition hover:bg-[var(--mi-hover)]">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-blue-600 text-xs font-black text-white">MI</span>
            <span className="hidden text-left xl:block">
              <span className="block text-[11px] font-black text-[var(--mi-text)]">Minha conta</span>
              <span className="block text-[9px] text-[var(--mi-text-muted)]">MercadoImobi</span>
            </span>
          </Link>
        </div>
      </header>

      <div className="mi-topbar sticky top-0 z-40 flex h-14 items-center justify-between border-b px-4 lg:hidden">
        <div className="flex items-center gap-2 font-black text-[var(--mi-text)]">
          <Building2 className="h-5 w-5 text-blue-600" /> Mercado<span className="-ml-2 text-blue-600">Imobi</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle compact />
          <button onClick={() => setMobileOpen(true)} className="mi-icon-button"><Menu className="h-4 w-4" /></button>
        </div>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)}>
          <div className="h-full w-[260px] max-w-[88vw]" onClick={(event) => event.stopPropagation()}>
            <div className="relative h-full">
              {sidebar}
              <button onClick={() => setMobileOpen(false)} className="mi-icon-button absolute right-3 top-3"><X className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
      )}

      <div className="min-h-[calc(100vh-64px)] lg:ml-[224px]">
        <Outlet />
      </div>
    </div>
  );
}

function SidebarStatic({
  active,
  icon: Icon,
  label,
  to,
  onClick,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  to: string;
  onClick: () => void;
}) {
  return (
    <Link to={to} onClick={onClick} className={`mi-sidebar-link ${active ? "mi-sidebar-link-active" : ""}`}>
      <Icon className="h-4 w-4" /> {label}
    </Link>
  );
}

function SidebarLink({
  item,
  pathname,
  onClick,
}: {
  item: { to: string; label: string; icon: React.ComponentType<{ className?: string }> };
  pathname: string;
  onClick: () => void;
}) {
  const Icon = item.icon;
  const active = pathname === item.to;
  return (
    <Link to={item.to} onClick={onClick} className={`mi-sidebar-link ${active ? "mi-sidebar-link-active" : ""}`}>
      <Icon className="h-4 w-4" /> {item.label}
    </Link>
  );
}
