import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Bot,
  Calculator,
  ChevronDown,
  CreditCard,
  Gavel,
  Handshake,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  Plug,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserRound,
  Users,
  WalletCards,
  Workflow,
  X,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { ThemeToggle } from "@/components/ThemeToggle";
import { supabase } from "@/integrations/supabase/client";
import { resolveTenantContext, type TenantContext } from "@/lib/tenant";
import { recordUserActivity, touchUserPresence } from "@/lib/user-activity.functions";

const routeFeatureMap = [
  ["/dashboard", "dashboard"],
  ["/buscar", "buscar"],
  ["/parcerias", "buscar"],
  ["/leiloes", "leiloes"],
  ["/alertas", "alertas"],
  ["/atendimento", "atendimento"],
  ["/crm", "crm"],
  ["/afiliados", "afiliados"],
  ["/analise-localizacao", "analise_localizacao"],
  ["/simulador-financiamento", "simulador"],
  ["/assistente", "assistente"],
  ["/central-integracoes", "central_integracoes"],
  ["/discador", "discador"],
  ["/midias-sociais", "midias"],
] as const;

function featureForPath(pathname: string) {
  return routeFeatureMap.find(
    ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )?.[1];
}

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

    let profileActive = true;
    let subscriptionStatus: string | null = null;
    let subscriptionPlanId: string | null = null;
    let planName: string | null = null;
    let planSlug: string | null = null;
    let planFeatures: string[] = [];
    let entitlementLoaded = false;
    let featureOverrides = new Map<string, boolean>();

    try {
      const [{ data: profile }, { data: subscription }, { data: overrides }] = await Promise.all([
        supabase.from("profiles").select("is_active").eq("id", session.user.id).maybeSingle(),
        supabase
          .from("subscriptions")
          .select("status,plan_id")
          .eq("user_id", session.user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("user_feature_access")
          .select("feature_key,allowed")
          .eq("user_id", session.user.id),
      ]);
      profileActive = profile?.is_active !== false;
      subscriptionStatus = subscription?.status ? String(subscription.status) : null;
      subscriptionPlanId = subscription?.plan_id ? String(subscription.plan_id) : null;
      featureOverrides = new Map(
        (overrides ?? []).map((row: any) => [String(row.feature_key), Boolean(row.allowed)]),
      );

      if (subscriptionPlanId) {
        const { data: plan, error: planError } = await supabase
          .from("subscription_plans")
          .select("slug,name,feature_keys")
          .eq("id", subscriptionPlanId)
          .maybeSingle();
        if (planError) throw planError;
        if (plan) {
          planName = String(plan.name ?? "");
          planSlug = String(plan.slug ?? "");
          planFeatures = Array.isArray(plan.feature_keys) ? plan.feature_keys.map(String) : [];
        }
      }
      entitlementLoaded = true;
    } catch {
      // Fail closed for subscriber features: temporary billing metadata failures must not grant a larger plan.
      planFeatures = [];
      entitlementLoaded = false;
    }

    const isPlatformAdmin = userRoles.includes("admin");
    const billingBlocked = ["past_due", "canceled", "unpaid"].includes(subscriptionStatus ?? "");
    const accountBlocked = !isPlatformAdmin && (!profileActive || billingBlocked);
    if (accountBlocked && location.pathname !== "/assinatura") {
      throw redirect({ to: "/assinatura" });
    }

    const adminOnlyPaths = ["/admin", "/diagnostico", "/integracoes", "/fluxos"];
    if (
      !isPlatformAdmin &&
      adminOnlyPaths.some(
        (path) => location.pathname === path || location.pathname.startsWith(`${path}/`),
      )
    ) {
      throw redirect({ to: "/atendimento" });
    }

    const hasPlanEntitlement =
      entitlementLoaded &&
      ["active", "trialing"].includes(subscriptionStatus ?? "") &&
      Boolean(subscriptionPlanId);
    const allowedFeatures = new Set<string>(hasPlanEntitlement ? planFeatures : []);
    for (const [featureKey, allowed] of featureOverrides) {
      if (allowed) allowedFeatures.add(featureKey);
      else allowedFeatures.delete(featureKey);
    }
    if (isPlatformAdmin) {
      for (const [, featureKey] of routeFeatureMap) allowedFeatures.add(featureKey);
    }

    const requestedFeature = featureForPath(location.pathname);
    if (
      requestedFeature &&
      !isPlatformAdmin &&
      !allowedFeatures.has(requestedFeature) &&
      location.pathname !== "/assinatura"
    ) {
      throw redirect({ to: "/assinatura" });
    }

    return {
      session,
      user: session.user,
      roles: userRoles,
      tenant,
      access: {
        profileActive,
        subscriptionStatus,
        accountBlocked,
        planId: subscriptionPlanId,
        planName,
        planSlug,
        allowedFeatures: Array.from(allowedFeatures),
      },
    };
  },
  component: AuthenticatedLayout,
});

const primaryItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, feature: "dashboard" },
  { to: "/buscar", label: "Buscar imóveis", icon: Search, feature: "buscar" },
  { to: "/leiloes", label: "Leilões CAIXA", icon: Gavel, feature: "leiloes" },
  { to: "/alertas", label: "Alertas", icon: Bell, feature: "alertas" },
] as const;

const toolItems = [
  {
    to: "/atendimento",
    label: "Atendimento WhatsApp",
    icon: MessageCircle,
    feature: "atendimento",
  },
  { to: "/crm", label: "CRM / Oportunidades", icon: Users, feature: "crm" },
  { to: "/parcerias", label: "Parcerias imobiliárias", icon: Handshake, feature: "buscar" },
  { to: "/afiliados", label: "Afiliados / Wallet", icon: WalletCards, feature: "afiliados" },
  {
    to: "/analise-localizacao",
    label: "Análise de localização",
    icon: MapPin,
    feature: "analise_localizacao",
  },
  {
    to: "/simulador-financiamento",
    label: "Simulador financiamento",
    icon: Calculator,
    feature: "simulador",
  },
  { to: "/fluxos", label: "Fluxos", icon: Workflow, adminOnly: true },
  { to: "/assistente", label: "Assistente IA", icon: Bot, feature: "assistente" },
  { to: "/diagnostico", label: "Diagnóstico", icon: ShieldCheck, adminOnly: true },
  { to: "/integracoes", label: "Fontes de imóveis", icon: Plug, adminOnly: true },
] as const;

function AuthenticatedLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { roles, tenant, user, access } = Route.useRouteContext();
  const isAdmin = roles.includes("admin");
  const allowedFeatures = new Set(access.allowedFeatures ?? []);
  const isFeatureAllowed = (feature?: string) =>
    !feature || isAdmin || allowedFeatures.has(feature);
  const visiblePrimaryItems = primaryItems.filter((item) => isFeatureAllowed(item.feature));
  const visibleToolItems = toolItems.filter(
    (item) =>
      (!("adminOnly" in item) || item.adminOnly !== true || isAdmin) &&
      (!("feature" in item) || isFeatureAllowed(item.feature)),
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const touchPresenceFn = useServerFn(touchUserPresence);
  const recordActivityFn = useServerFn(recordUserActivity);
  const presenceSessionId = useRef("");

  useEffect(() => {
    const existing = sessionStorage.getItem("mercadoimobi:presenceSessionId");
    const sessionId = existing || crypto.randomUUID();
    sessionStorage.setItem("mercadoimobi:presenceSessionId", sessionId);
    presenceSessionId.current = sessionId;
    const heartbeat = () =>
      touchPresenceFn({
        data: { sessionId, path: window.location.pathname, userAgent: navigator.userAgent },
      }).catch(() => undefined);
    void heartbeat();
    if (!sessionStorage.getItem(`mercadoimobi:sessionLogged:${sessionId}`)) {
      sessionStorage.setItem(`mercadoimobi:sessionLogged:${sessionId}`, "1");
      void recordActivityFn({
        data: { sessionId, eventType: "session_start", path: window.location.pathname },
      }).catch(() => undefined);
    }
    const interval = window.setInterval(() => void heartbeat(), 30_000);
    return () => window.clearInterval(interval);
  }, [recordActivityFn, touchPresenceFn]);

  useEffect(() => {
    const sessionId = presenceSessionId.current;
    if (!sessionId) return;
    void touchPresenceFn({
      data: { sessionId, path: location.pathname, userAgent: navigator.userAgent },
    }).catch(() => undefined);
    void recordActivityFn({
      data: { sessionId, eventType: "route_view", path: location.pathname },
    }).catch(() => undefined);
  }, [location.pathname, recordActivityFn, touchPresenceFn]);

  const signOut = async () => {
    if (presenceSessionId.current) {
      await recordActivityFn({
        data: {
          sessionId: presenceSessionId.current,
          eventType: "sign_out",
          path: location.pathname,
        },
      }).catch(() => undefined);
    }
    await supabase.auth.signOut();
    void navigate({ to: "/" });
  };

  const runGlobalSearch = () => {
    if (!isFeatureAllowed("buscar")) {
      void navigate({ to: "/assinatura" });
      return;
    }
    const value = globalSearch.trim();
    if (!value) return;
    sessionStorage.setItem("mercadoimobi:globalSearch", value);
    void navigate({ to: "/buscar" }).then(() => {
      window.dispatchEvent(new CustomEvent("mercadoimobi:global-search", { detail: value }));
    });
  };

  const displayName =
    typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()
      ? user.user_metadata.full_name.trim()
      : user.email?.split("@")[0] || "Minha conta";
  const initials =
    displayName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "MI";

  return (
    <div className="mi-shell min-h-screen">
      <nav className="mi-appbar sticky top-0 z-50 border-b">
        <div className="mx-auto flex h-14 max-w-[1720px] items-center gap-3 px-3 sm:px-5 lg:px-6">
          <Link
            to={isFeatureAllowed("dashboard") ? "/dashboard" : "/assinatura"}
            className="mi-brand flex shrink-0 items-center gap-2.5"
            aria-label="MercadoImobi"
          >
            <span className="mi-brand-mark grid h-9 w-9 place-items-center">
              <TrendingUp className="h-5 w-5" strokeWidth={2.5} />
            </span>
            <span className="hidden flex-col leading-none sm:flex">
              <span className="text-[15px] font-black tracking-[-0.025em] text-[var(--mi-text)]">
                MercadoImobi<span className="text-[var(--mi-accent)]">.</span>
              </span>
              <span className="mt-[3px] text-[8px] font-bold uppercase tracking-[0.22em] text-[var(--mi-text-soft)]">
                Plataforma imobiliária
              </span>
            </span>
          </Link>

          <span className="hidden h-4 w-px bg-[var(--mi-border)] lg:block" />

          <div className="hidden items-center gap-1 lg:flex">
            {visiblePrimaryItems.map((item) => (
              <TopNavLink key={item.to} item={item} pathname={location.pathname} />
            ))}
          </div>

          {isFeatureAllowed("buscar") && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                runGlobalSearch();
              }}
              className="mi-global-search ml-auto hidden h-9 min-w-0 max-w-[430px] flex-1 items-center gap-2 rounded-lg border px-3 xl:flex"
            >
              <Search className="h-3.5 w-3.5 shrink-0 text-[var(--mi-text-soft)]" />
              <input
                value={globalSearch}
                onChange={(event) => setGlobalSearch(event.target.value)}
                placeholder="Buscar cidade, bairro ou imóvel..."
                className="min-w-0 flex-1 bg-transparent text-xs text-[var(--mi-text)] outline-none placeholder:text-[var(--mi-text-soft)]"
              />
              <span className="rounded-md border border-[var(--mi-border)] px-1.5 py-0.5 text-[8px] font-bold text-[var(--mi-text-soft)]">
                Enter
              </span>
            </form>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-1.5 xl:ml-0">
            {isFeatureAllowed("atendimento") && (
              <Link to="/atendimento" className="mi-icon-button hidden sm:grid" title="Atendimento">
                <MessageCircle className="h-4 w-4" />
              </Link>
            )}
            {isFeatureAllowed("alertas") && (
              <Link
                to="/alertas"
                className="mi-icon-button relative hidden sm:grid"
                title="Alertas"
              >
                <Bell className="h-4 w-4" />
              </Link>
            )}
            <ThemeToggle compact />

            <div className="relative hidden lg:block">
              <button
                onClick={() => {
                  setToolsOpen((value) => !value);
                  setAccountOpen(false);
                }}
                className={`mi-toolbar-button ${toolsOpen ? "mi-toolbar-button-active" : ""}`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span className="hidden 2xl:inline">Ferramentas</span>
                <ChevronDown className="h-3 w-3" />
              </button>
              {toolsOpen && (
                <div className="mi-nav-popover absolute right-0 top-full mt-2 w-72 overflow-hidden rounded-xl border p-1.5 shadow-xl">
                  {visibleToolItems.map((item) => (
                    <PopoverLink
                      key={item.to}
                      item={item}
                      pathname={location.pathname}
                      onClick={() => setToolsOpen(false)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="relative hidden sm:block">
              <button
                onClick={() => {
                  setAccountOpen((value) => !value);
                  setToolsOpen(false);
                }}
                className="mi-account-button flex h-9 items-center gap-2 rounded-lg px-2 transition"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--mi-text)] text-[9px] font-black text-[var(--mi-bg)]">
                  {initials}
                </span>
                <span className="hidden max-w-[150px] text-left 2xl:block">
                  <span className="block truncate text-[10px] font-black text-[var(--mi-text)]">
                    {displayName}
                  </span>
                  <span className="block truncate text-[8px] text-[var(--mi-text-soft)]">
                    {access.planName && access.planSlug !== "legacy_full"
                      ? access.planName
                      : tenant?.tenantName || "MercadoImobi"}
                  </span>
                </span>
                <ChevronDown className="hidden h-3 w-3 text-[var(--mi-text-soft)] 2xl:block" />
              </button>
              {accountOpen && (
                <div className="mi-nav-popover absolute right-0 top-full mt-2 w-64 overflow-hidden rounded-xl border p-1.5 shadow-xl">
                  <PopoverLink
                    item={{ to: "/settings/security", label: "Minha conta", icon: UserRound }}
                    pathname={location.pathname}
                    onClick={() => setAccountOpen(false)}
                  />
                  <PopoverLink
                    item={{ to: "/assinatura", label: "Assinatura", icon: CreditCard }}
                    pathname={location.pathname}
                    onClick={() => setAccountOpen(false)}
                  />
                  {isAdmin && (
                    <>
                      <PopoverLink
                        item={{
                          to: "/admin/usuarios",
                          label: "Usuários e assinantes",
                          icon: Users,
                        }}
                        pathname={location.pathname}
                        onClick={() => setAccountOpen(false)}
                      />
                      <PopoverLink
                        item={{
                          to: "/admin/parametros",
                          label: "Parâmetros do sistema",
                          icon: Settings,
                        }}
                        pathname={location.pathname}
                        onClick={() => setAccountOpen(false)}
                      />
                    </>
                  )}
                  {isAdmin && (
                    <Link
                      to="/settings/security"
                      onClick={() => setAccountOpen(false)}
                      className="mi-popover-link"
                    >
                      <Settings className="h-4 w-4" /> Configurações
                    </Link>
                  )}
                  <div className="my-1 h-px bg-[var(--mi-border)]" />
                  <button
                    onClick={() => void signOut()}
                    className="mi-popover-link w-full text-rose-600"
                  >
                    <LogOut className="h-4 w-4" /> Sair
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={() => setMobileOpen(true)}
              className="mi-icon-button lg:hidden"
              aria-label="Abrir menu"
            >
              <Menu className="h-4 w-4" />
            </button>
          </div>
        </div>
      </nav>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-[70] bg-black/45 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="mi-mobile-menu ml-auto flex h-full w-[310px] max-w-[88vw] flex-col border-l p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--mi-border)] pb-4">
              <div className="flex items-center gap-2.5">
                <span className="mi-brand-mark grid h-9 w-9 place-items-center">
                  <TrendingUp className="h-5 w-5" strokeWidth={2.5} />
                </span>
                <div>
                  <p className="text-sm font-black tracking-tight">
                    MercadoImobi<span className="text-[var(--mi-accent)]">.</span>
                  </p>
                  <p className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.18em] text-[var(--mi-text-soft)]">
                    Plataforma imobiliária
                  </p>
                </div>
              </div>
              <button onClick={() => setMobileOpen(false)} className="mi-icon-button">
                <X className="h-4 w-4" />
              </button>
            </div>

            {isFeatureAllowed("buscar") && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  runGlobalSearch();
                  setMobileOpen(false);
                }}
                className="mi-global-search mt-4 flex h-10 items-center gap-2 rounded-lg border px-3"
              >
                <Search className="h-4 w-4 text-[var(--mi-text-soft)]" />
                <input
                  value={globalSearch}
                  onChange={(event) => setGlobalSearch(event.target.value)}
                  placeholder="Buscar imóveis..."
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                />
              </form>
            )}

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
              <p className="px-2 pb-2 text-[9px] font-black uppercase tracking-[0.18em] text-[var(--mi-text-soft)]">
                Navegação
              </p>
              {[...visiblePrimaryItems, ...visibleToolItems].map((item) => (
                <MobileNavLink
                  key={item.to}
                  item={item}
                  pathname={location.pathname}
                  onClick={() => setMobileOpen(false)}
                />
              ))}
              <MobileNavLink
                item={{ to: "/assinatura", label: "Assinatura", icon: CreditCard }}
                pathname={location.pathname}
                onClick={() => setMobileOpen(false)}
              />
              {isAdmin && (
                <>
                  <MobileNavLink
                    item={{ to: "/admin/usuarios", label: "Usuários e assinantes", icon: Users }}
                    pathname={location.pathname}
                    onClick={() => setMobileOpen(false)}
                  />
                  <MobileNavLink
                    item={{
                      to: "/admin/parametros",
                      label: "Parâmetros do sistema",
                      icon: Settings,
                    }}
                    pathname={location.pathname}
                    onClick={() => setMobileOpen(false)}
                  />
                </>
              )}
              <MobileNavLink
                item={{ to: "/settings/security", label: "Minha conta", icon: UserRound }}
                pathname={location.pathname}
                onClick={() => setMobileOpen(false)}
              />
              {isAdmin && (
                <Link
                  to="/settings/security"
                  onClick={() => setMobileOpen(false)}
                  className="mi-mobile-link"
                >
                  <Settings className="h-4 w-4" /> Configurações
                </Link>
              )}
            </div>

            <div className="border-t border-[var(--mi-border)] pt-4">
              <ThemeToggle />
              <button
                onClick={() => void signOut()}
                className="mi-mobile-link mt-2 w-full text-rose-600"
              >
                <LogOut className="h-4 w-4" /> Sair
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="mi-app-content min-h-[calc(100vh-56px)]">
        <Outlet />
      </main>
    </div>
  );
}

function TopNavLink({
  item,
  pathname,
}: {
  item: { to: string; label: string; icon: React.ComponentType<{ className?: string }> };
  pathname: string;
}) {
  const Icon = item.icon;
  const active = pathname === item.to;
  return (
    <Link to={item.to} className={`mi-topnav-link ${active ? "mi-topnav-link-active" : ""}`}>
      <Icon className="h-3.5 w-3.5" />
      <span>{item.label}</span>
    </Link>
  );
}

function PopoverLink({
  item,
  pathname,
  onClick,
}: {
  item: { to: string; label: string; icon: React.ComponentType<{ className?: string }> };
  pathname: string;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      onClick={onClick}
      className={`mi-popover-link ${pathname === item.to ? "mi-popover-link-active" : ""}`}
    >
      <Icon className="h-4 w-4" /> {item.label}
    </Link>
  );
}

function MobileNavLink({
  item,
  pathname,
  onClick,
}: {
  item: { to: string; label: string; icon: React.ComponentType<{ className?: string }> };
  pathname: string;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      onClick={onClick}
      className={`mi-mobile-link ${pathname === item.to ? "mi-mobile-link-active" : ""}`}
    >
      <Icon className="h-4 w-4" /> {item.label}
    </Link>
  );
}
