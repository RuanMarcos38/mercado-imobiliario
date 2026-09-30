import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  BarChart3,
  Bell,
  BriefcaseBusiness,
  Building2,
  Columns3,
  FileSignature,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Mail,
  Menu,
  MessageCircle,
  PlugZap,
  Search,
  Settings,
  Users,
  X,
} from "lucide-react";
import { CrmDashboardOverview } from "@/components/crm/CrmDashboardOverview";
import { CrmLeadInboxPanel } from "@/components/crm/CrmLeadInboxPanel";
import { CrmPipelineWorkspace } from "@/components/crm/CrmPipelineWorkspace";
import { CrmOperationsHub, type CrmOperationsMode } from "@/components/crm/CrmOperationsHub";
import { CrmReportsPanel } from "@/components/crm/CrmReportsPanel";
import { CrmDiagnosticsPanel } from "@/components/crm/CrmDiagnosticsPanel";
import { AtendimentoPage } from "@/routes/_authenticated/atendimento";
import { supabase } from "@/integrations/supabase/client";

type Module =
  | "dashboard"
  | "leads"
  | "pipeline"
  | "attendance"
  | CrmOperationsMode
  | "reports"
  | "diagnostics";

type CrmModuleItem = {
  id: Module;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const primaryModules: CrmModuleItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "leads", label: "Leads", icon: Users },
  { id: "pipeline", label: "Pipeline", icon: Columns3 },
  { id: "attendance", label: "Atendimento", icon: MessageCircle },
];

const businessModules: CrmModuleItem[] = [
  { id: "proposals", label: "Propostas", icon: FileText },
  { id: "emails", label: "E-mails", icon: Mail },
  { id: "documents", label: "Documentos", icon: FolderOpen },
  { id: "signatures", label: "Assinaturas", icon: FileSignature },
  { id: "reports", label: "Relatórios", icon: BarChart3 },
  { id: "diagnostics", label: "Diagnóstico", icon: FileText },
];

const visibleBusinessModules = businessModules.filter((item) => item.id !== "diagnostics");

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "MI";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function CrmWorkspaceShell() {
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const [module, setModule] = useState<Module>("dashboard");
  const [search, setSearch] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [account, setAccount] = useState({
    name: "Minha conta",
    subtitle: "CRM MercadoImobi",
    avatar: null as string | null,
  });

  useEffect(() => {
    const handler = (event: Event) => {
      setSearch(String((event as CustomEvent<string>).detail ?? ""));
    };
    window.addEventListener("mercadoimobi:crm-global-search", handler);
    return () => window.removeEventListener("mercadoimobi:crm-global-search", handler);
  }, []);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("mercadoimobi:crm-search", {
        detail: search,
      }),
    );
  }, [search]);

  useEffect(() => {
    const loadAccount = async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) return;

      const fullName =
        typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()
          ? user.user_metadata.full_name.trim()
          : user.email?.split("@")[0] || "Minha conta";
      const avatar =
        typeof user.user_metadata?.avatar_url === "string" && user.user_metadata.avatar_url
          ? user.user_metadata.avatar_url
          : typeof user.user_metadata?.picture === "string" && user.user_metadata.picture
            ? user.user_metadata.picture
            : null;

      setAccount({
        name: fullName,
        subtitle: user.email || "CRM MercadoImobi",
        avatar,
      });
    };

    void loadAccount().catch(() => undefined);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const currentModule = [...primaryModules, ...visibleBusinessModules].find(
    (item) => item.id === module,
  );

  const chooseModule = (next: Module) => {
    setModule(next);
    setMobileMenuOpen(false);
  };

  const renderNavItem = (item: CrmModuleItem) => {
    const Icon = item.icon;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => chooseModule(item.id)}
        className={module === item.id ? "is-active" : ""}
      >
        <Icon />
        <span>{item.label}</span>
      </button>
    );
  };

  return (
    <section className="crm-salespro-shell">
      <aside
        className={[
          "crm-salespro-sidebar",
          mobileMenuOpen ? "is-mobile-open" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="crm-salespro-brand">
          <span className="crm-salespro-brand-mark">
            <Building2 />
          </span>
          <div>
            <strong>MercadoImobi</strong>
            <small>CRM imobiliário</small>
          </div>
          <button
            type="button"
            className="crm-salespro-sidebar-close"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Fechar menu"
          >
            <X />
          </button>
        </div>

        <div className="crm-salespro-sidebar-scroll">
          <nav className="crm-salespro-nav" aria-label="Navegação principal do CRM">
            {primaryModules.map(renderNavItem)}
          </nav>

          <div className="crm-salespro-nav-separator" />

          <nav className="crm-salespro-nav" aria-label="Ferramentas comerciais do CRM">
            {visibleBusinessModules.map(renderNavItem)}
          </nav>

          <div className="crm-salespro-nav-separator" />

          <nav className="crm-salespro-nav" aria-label="Configurações do CRM">
            <button
              type="button"
              onClick={() => void navigate({ to: "/central-integracoes" })}
            >
              <PlugZap />
              <span>Integrações</span>
            </button>
            <button
              type="button"
              onClick={() => void navigate({ to: "/settings/security" })}
            >
              <Settings />
              <span>Configurações</span>
            </button>
          </nav>
        </div>

        <div className="crm-salespro-sidebar-card">
          <span className="crm-salespro-sidebar-card-icon">
            <BriefcaseBusiness />
          </span>
          <strong>Operação comercial</strong>
          <p>Leads, atendimento, pipeline e relatórios no mesmo ambiente.</p>
          <button type="button" onClick={() => chooseModule("pipeline")}>
            Abrir pipeline
          </button>
        </div>
      </aside>

      {mobileMenuOpen && (
        <button
          type="button"
          className="crm-salespro-mobile-overlay"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Fechar menu"
        />
      )}

      <main className="crm-salespro-main">
        <header className="crm-salespro-topbar">
          <button
            type="button"
            className="crm-salespro-mobile-menu"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu />
          </button>

          <label className="crm-salespro-global-search">
            <Search />
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar leads, negócios, contatos..."
            />
            <kbd>Ctrl K</kbd>
          </label>

          <div className="crm-salespro-top-actions">
            <button type="button" className="crm-salespro-bell" aria-label="Notificações">
              <Bell />
              <span />
            </button>

            <button
              type="button"
              className="crm-salespro-profile"
              onClick={() => void navigate({ to: "/settings/security" })}
            >
              <span className="crm-salespro-profile-avatar">
                {account.avatar ? (
                  <img src={account.avatar} alt="" referrerPolicy="no-referrer" />
                ) : (
                  initials(account.name)
                )}
              </span>
              <span className="crm-salespro-profile-copy">
                <strong>{account.name}</strong>
                <small>{account.subtitle}</small>
              </span>
            </button>
          </div>
        </header>

        <div className="crm-salespro-content">
          <div className="crm-salespro-context-bar">
            <div>
              <span>CRM</span>
              <strong>{currentModule?.label ?? "Dashboard"}</strong>
            </div>
          </div>

          <div className="crm-salespro-module">
            {module === "dashboard" && (
              <CrmDashboardOverview
                onNavigate={(target) => chooseModule(target)}
              />
            )}
            {module === "leads" && <CrmLeadInboxPanel />}
            {module === "pipeline" && <CrmPipelineWorkspace />}
            {module === "attendance" && (
              <div className="crm-template-attendance">
                <AtendimentoPage embedded />
              </div>
            )}
            {module === "proposals" && <CrmOperationsHub mode="proposals" />}
            {module === "emails" && <CrmOperationsHub mode="emails" />}
            {module === "documents" && <CrmOperationsHub mode="documents" />}
            {module === "signatures" && <CrmOperationsHub mode="signatures" />}
            {module === "reports" && <CrmReportsPanel />}
            {module === "diagnostics" && <CrmDiagnosticsPanel />}
          </div>
        </div>
      </main>
    </section>
  );
}
