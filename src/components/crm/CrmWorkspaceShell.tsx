import { useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  Bell,
  CalendarDays,
  ChevronDown,
  FileText,
  Inbox,
  Layers3,
  Mail,
  Paperclip,
  PenLine,
  Search,
  SearchCheck,
  Settings2,
  UserRound,
  UsersRound,
} from "lucide-react";
import { CrmLeadInboxPanel } from "@/components/crm/CrmLeadInboxPanel";
import { CrmPipelineWorkspace } from "@/components/crm/CrmPipelineWorkspace";
import { CrmOperationsHub, type CrmOperationsMode } from "@/components/crm/CrmOperationsHub";
import { CrmReportsPanel } from "@/components/crm/CrmReportsPanel";
import { CrmDiagnosticsPanel } from "@/components/crm/CrmDiagnosticsPanel";

type Module = "leads" | "pipeline" | CrmOperationsMode | "reports" | "diagnostics";

const modules: Array<{ id: Module; label: string; icon: typeof Layers3 }> = [
  { id: "leads", label: "Leads", icon: Inbox },
  { id: "pipeline", label: "Pipeline", icon: Layers3 },
  { id: "proposals", label: "Propostas", icon: FileText },
  { id: "emails", label: "E-mails", icon: Mail },
  { id: "documents", label: "Documentos", icon: Paperclip },
  { id: "signatures", label: "Assinaturas", icon: PenLine },
  { id: "reports", label: "Relatórios", icon: BarChart3 },
  { id: "diagnostics", label: "Diagnóstico", icon: SearchCheck },
];

export function CrmWorkspaceShell() {
  const [module, setModule] = useState<Module>("leads");
  const [search, setSearch] = useState("");

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("mercadoimobi:crm-search", {
        detail: search,
      }),
    );
  }, [search]);

  return (
    <div className="crm-template-shell">
      <aside className="crm-template-sidebar">
        <div className="crm-template-brand">
          <span className="crm-template-brand-mark">
            <span />
          </span>
          <strong>CRM</strong>
        </div>

        <nav className="crm-template-nav" aria-label="Módulos do CRM">
          <button
            type="button"
            className={module === "pipeline" ? "crm-template-nav-item is-active" : "crm-template-nav-item"}
            onClick={() => setModule("pipeline")}
          >
            <Layers3 />
            <span>Dashboard</span>
            <ChevronDown />
          </button>

          <button
            type="button"
            className="crm-template-nav-item"
            onClick={() => setModule("pipeline")}
          >
            <UsersRound />
            <span>Contas</span>
            <ChevronDown />
          </button>

          <button
            type="button"
            className="crm-template-nav-item"
            onClick={() => setModule("leads")}
          >
            <UserRound />
            <span>Contatos</span>
            <ChevronDown />
          </button>

          <button
            type="button"
            className={module === "leads" ? "crm-template-nav-item is-active" : "crm-template-nav-item"}
            onClick={() => setModule("leads")}
          >
            <Inbox />
            <span>Leads</span>
            <ChevronDown />
          </button>

          {module === "leads" && (
            <button type="button" className="crm-template-subnav" onClick={() => setModule("leads")}>
              <span />
              <Settings2 />
              Configurações de leads
            </button>
          )}

          <button
            type="button"
            className="crm-template-nav-item"
            onClick={() => setModule("pipeline")}
          >
            <CalendarDays />
            <span>Calendário</span>
            <ChevronDown />
          </button>

          <button
            type="button"
            className="crm-template-nav-item"
            onClick={() => setModule("pipeline")}
          >
            <Activity />
            <span>Atividades</span>
            <ChevronDown />
          </button>

          <button
            type="button"
            className={module === "reports" ? "crm-template-nav-item is-active" : "crm-template-nav-item"}
            onClick={() => setModule("reports")}
          >
            <BarChart3 />
            <span>Relatórios</span>
            <ChevronDown />
          </button>
        </nav>

        <div className="crm-template-sidebar-divider" />

        <div className="crm-template-tools-label">Ferramentas</div>
        <nav className="crm-template-nav crm-template-nav-secondary">
          {modules
            .filter((item) => !["leads", "pipeline", "reports"].includes(item.id))
            .map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setModule(item.id)}
                  className={
                    module === item.id ? "crm-template-nav-item is-active" : "crm-template-nav-item"
                  }
                >
                  <Icon />
                  <span>{item.label}</span>
                </button>
              );
            })}
        </nav>
      </aside>

      <section className="crm-template-stage">
        <header className="crm-template-topbar">
          <label className="crm-template-global-search">
            <Search />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar no CRM..."
            />
          </label>

          <div className="crm-template-user-area">
            <button type="button" className="crm-template-top-icon" aria-label="Mensagens">
              <Mail />
            </button>
            <button type="button" className="crm-template-top-icon crm-template-bell" aria-label="Notificações">
              <Bell />
              <span />
            </button>
            <div className="crm-template-user">
              <div>
                <span>Olá,</span>
                <strong>MercadoImobi</strong>
              </div>
              <span className="crm-template-user-avatar">MI</span>
              <ChevronDown />
            </div>
          </div>
        </header>

        <main className="crm-template-main">
          {module === "leads" && <CrmLeadInboxPanel />}
          {module === "pipeline" && <CrmPipelineWorkspace />}
          {module === "proposals" && <CrmOperationsHub mode="proposals" />}
          {module === "emails" && <CrmOperationsHub mode="emails" />}
          {module === "documents" && <CrmOperationsHub mode="documents" />}
          {module === "signatures" && <CrmOperationsHub mode="signatures" />}
          {module === "reports" && <CrmReportsPanel />}
          {module === "diagnostics" && <CrmDiagnosticsPanel />}
        </main>
      </section>
    </div>
  );
}
