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
  Camera,
  CreditCard,
  Gavel,
  Handshake,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  Plug,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShieldCheck,
  Target,
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
  ["/prospectos", "buscar"],
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
  {
    to: "/central-integracoes",
    label: "Central de Integrações",
    icon: Settings,
    feature: "central_integracoes",
  },
  {
    to: "/midias-sociais",
    label: "Direct / Messenger",
    icon: Camera,
    feature: "midias",
  },
  { to: "/crm", label: "CRM / Oportunidades", icon: Users, feature: "crm" },
  { to: "/parcerias", label: "Parcerias imobiliárias", icon: Handshake, feature: "buscar" },
  { to: "/prospectos", label: "Prospecção IA", icon: Target, feature: "buscar" },
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
  const internalTechnicalPaths = new Set(["/fluxos", "/diagnostico", "/integracoes"]);
  const visibleToolItems = toolItems.filter(
    (item) =>
      !internalTechnicalPaths.has(item.to) &&
      (!("adminOnly" in item) || item.adminOnly !== true || isAdmin) &&
      (!("feature" in item) || isFeatureAllowed(item.feature)),
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const touchPresenceFn = useServerFn(touchUserPresence);
  const recordActivityFn = useServerFn(recordUserActivity);
  const presenceSessionId = useRef("");

  useEffect(() => {
    const saved = window.localStorage.getItem("mercadoimobi:sidebarCollapsed");
    if (saved === "1") setSidebarCollapsed(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("mercadoimobi:sidebarCollapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

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

  const accountItems = [
    { to: "/assinatura", label: "Assinatura", icon: CreditCard },
    { to: "/settings/security", label: "Minha conta", icon: UserRound },
    ...(isAdmin
      ? [
          { to: "/admin/usuarios", label: "Usuários e assinantes", icon: Users },
          { to: "/admin/parametros", label: "Parâmetros do sistema", icon: Settings },
        ]
      : []),
  ];
  const visibleAccountItems = accountItems.filter((item) => item.to !== "/admin/parametros");

  const allVisibleItems = [...visiblePrimaryItems, ...visibleToolItems];
  const currentItem = [...allVisibleItems, ...accountItems].find(
    (item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`),
  );
  const currentTitle = currentItem?.label || "MercadoImobi";
  const searchIsCrm = location.pathname === "/crm" || location.pathname.startsWith("/crm/");
  const profileImage =
    typeof user.user_metadata?.avatar_url === "string" && user.user_metadata.avatar_url
      ? user.user_metadata.avatar_url
      : typeof user.user_metadata?.picture === "string" && user.user_metadata.picture
        ? user.user_metadata.picture
        : null;

  return (
    <div className={sidebarCollapsed ? "mi-platform-shell is-sidebar-collapsed" : "mi-platform-shell"}>
      <aside
        className={sidebarCollapsed ? "mi-platform-sidebar is-collapsed" : "mi-platform-sidebar"}
      >
        <div className="mi-platform-brand-row">
          <Link
            to={isFeatureAllowed("dashboard") ? "/dashboard" : "/assinatura"}
            className="mi-platform-brand"
            aria-label="MercadoImobi"
          >
            <strong>
              <span className="mi-platform-brand-full">
                MercadoImobi<span>.</span>
              </span>
              <span className="mi-platform-brand-compact">MI</span>
            </strong>
            <small>Plataforma imobiliária</small>
          </Link>

          <button
            type="button"
            onClick={() => setSidebarCollapsed((current) => !current)}
            className="mi-platform-sidebar-toggle"
            aria-label={sidebarCollapsed ? "Abrir menu lateral" : "Ocultar menu lateral"}
            title={sidebarCollapsed ? "Abrir menu lateral" : "Ocultar menu lateral"}
          >
            {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        </div>

        <div className="mi-platform-sidebar-scroll">
          <PlatformNavSection
            label="Principal"
            items={visiblePrimaryItems}
            pathname={location.pathname}
          />
          <PlatformNavSection
            label="Operação"
            items={visibleToolItems}
            pathname={location.pathname}
          />
          <PlatformNavSection
            label="Conta"
            items={visibleAccountItems}
            pathname={location.pathname}
          />
        </div>

        <div className="mi-platform-sidebar-footer">
          <Link to="/settings/security" className="mi-platform-user-card">
            <span className="mi-platform-user-avatar">
              {profileImage ? (
                <img src={profileImage} alt="" referrerPolicy="no-referrer" />
              ) : (
                initials
              )}
            </span>
            <span>
              <strong>{displayName}</strong>
              <small>
                {access.planName && access.planSlug !== "legacy_full"
                  ? access.planName
                  : tenant?.tenantName || "MercadoImobi"}
              </small>
            </span>
          </Link>
          <button type="button" onClick={() => void signOut()} className="mi-platform-signout">
            <LogOut />
            Sair
          </button>
        </div>
      </aside>

      <section className="mi-platform-stage">
        <header className="mi-platform-topbar">
          <div className="mi-platform-topbar-title">
            {sidebarCollapsed && (
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                className="mi-platform-sidebar-reopen"
                aria-label="Reabrir menu lateral"
                title="Reabrir menu lateral"
              >
                <PanelLeftOpen />
              </button>
            )}
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="mi-platform-menu-button"
              aria-label="Abrir menu"
            >
              <Menu />
            </button>
            <div>
              <span>MercadoImobi</span>
              <strong>{currentTitle}</strong>
            </div>
          </div>

          {isFeatureAllowed("buscar") && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (searchIsCrm) {
                  window.dispatchEvent(
                    new CustomEvent("mercadoimobi:crm-global-search", {
                      detail: globalSearch.trim(),
                    }),
                  );
                  return;
                }
                runGlobalSearch();
              }}
              className="mi-platform-search"
            >
              <Search />
              <input
                value={globalSearch}
                onChange={(event) => setGlobalSearch(event.target.value)}
                placeholder={
                  searchIsCrm ? "Buscar no CRM..." : "Buscar cidade, bairro ou imóvel..."
                }
              />
              <button type="submit">Buscar</button>
            </form>
          )}

          <div className="mi-platform-topbar-actions">
            {isFeatureAllowed("atendimento") && (
              <Link to="/atendimento" className="mi-platform-action-link">
                <MessageCircle />
                <span>Atendimento</span>
              </Link>
            )}
            {isFeatureAllowed("alertas") && (
              <Link to="/alertas" className="mi-platform-action-icon" aria-label="Alertas">
                <Bell />
              </Link>
            )}
            <ThemeToggle compact />
            <Link to="/settings/security" className="mi-platform-top-user" aria-label="Minha conta">
              {profileImage ? (
                <img src={profileImage} alt="" referrerPolicy="no-referrer" />
              ) : (
                initials
              )}
            </Link>
          </div>
        </header>

        <main className="mi-platform-content">
          <Outlet />
        </main>
      </section>

      {mobileOpen && (
        <div className="mi-platform-mobile-overlay" onClick={() => setMobileOpen(false)}>
          <aside className="mi-platform-mobile-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="mi-platform-mobile-head">
              <div className="mi-platform-brand">
                <strong>
                  MercadoImobi<span>.</span>
                </strong>
                <small>Plataforma imobiliária</small>
              </div>
              <button type="button" onClick={() => setMobileOpen(false)} aria-label="Fechar menu">
                <X />
              </button>
            </div>

            <div className="mi-platform-mobile-scroll">
              <PlatformNavSection
                label="Principal"
                items={visiblePrimaryItems}
                pathname={location.pathname}
                onNavigate={() => setMobileOpen(false)}
              />
              <PlatformNavSection
                label="Operação"
                items={visibleToolItems}
                pathname={location.pathname}
                onNavigate={() => setMobileOpen(false)}
              />
              <PlatformNavSection
                label="Conta"
                items={visibleAccountItems}
                pathname={location.pathname}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>

            <div className="mi-platform-mobile-footer">
              <ThemeToggle />
              <button type="button" onClick={() => void signOut()}>
                <LogOut />
                Sair
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function platformNavigationLabel(item: { to: string; label: string }) {
  if (item.to === "/central-integracoes") return "Conexões";
  return item.label;
}

function PlatformNavSection({
  label,
  items,
  pathname,
  onNavigate,
}: {
  label: string;
  items: ReadonlyArray<{
    to: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }>;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <section className="mi-platform-nav-section">
      <h2>{label}</h2>
      <nav>
        {items.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={active ? "mi-platform-nav-link is-active" : "mi-platform-nav-link"}
              title={platformNavigationLabel(item)}
            >
              <Icon />
              <span>{platformNavigationLabel(item)}</span>
            </Link>
          );
        })}
      </nav>
    </section>
  );
}
