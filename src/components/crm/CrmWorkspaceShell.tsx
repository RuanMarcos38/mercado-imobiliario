import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  BarChart3,
  Columns3,
  FileSignature,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Mail,
  MessageCircle,
  Users,
} from "lucide-react";
import { CrmDashboardOverview } from "@/components/crm/CrmDashboardOverview";
import { CrmLeadInboxPanel } from "@/components/crm/CrmLeadInboxPanel";
import { CrmPipelineWorkspace } from "@/components/crm/CrmPipelineWorkspace";
import { CrmOperationsHub } from "@/components/crm/CrmOperationsHub";
import { CrmReportsPanel } from "@/components/crm/CrmReportsPanel";
import { CrmAutomationLayer } from "@/components/crm/CrmAutomationLayer";

const modules = [
  { id: "dashboard", label: "Visão geral", icon: LayoutDashboard },
  { id: "leads", label: "Leads", icon: Users },
  { id: "pipeline", label: "Pipeline", icon: Columns3 },
  { id: "proposals", label: "Propostas", icon: FileText },
  { id: "emails", label: "E-mails", icon: Mail },
  { id: "documents", label: "Documentos", icon: FolderOpen },
  { id: "signatures", label: "Assinaturas", icon: FileSignature },
  { id: "reports", label: "Relatórios", icon: BarChart3 },
] as const;
type Module = (typeof modules)[number]["id"];

export function CrmWorkspaceShell() {
  const [module, setModule] = useState<Module>("dashboard");

  // The platform header owns search; CRM modules keep their existing search event.
  useEffect(() => {
    const onSearch = (event: Event) => {
      window.dispatchEvent(
        new CustomEvent("mercadoimobi:crm-search", {
          detail: String((event as CustomEvent<string>).detail ?? ""),
        }),
      );
    };
    window.addEventListener("mercadoimobi:crm-global-search", onSearch);
    return () => window.removeEventListener("mercadoimobi:crm-global-search", onSearch);
  }, []);

  return (
    <section className="mi-workspace-page crm-salespro-shell" aria-label="CRM e oportunidades">
      <nav className="mi-workspace-tabs" aria-label="Módulos do CRM">
        {modules.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={module === id ? "page" : undefined}
            onClick={() => setModule(id)}
            className={module === id ? "is-active" : ""}
          >
            <Icon aria-hidden="true" />
            {label}
          </button>
        ))}
        <Link to="/atendimento">
          <MessageCircle aria-hidden="true" />
          Atendimento
        </Link>
      </nav>
      <CrmAutomationLayer />
      <div className="crm-salespro-module" id="crm-module-content">
        {module === "dashboard" && <CrmDashboardOverview onNavigate={setModule} />}
        {module === "leads" && <CrmLeadInboxPanel />}
        {module === "pipeline" && <CrmPipelineWorkspace />}
        {module === "proposals" && <CrmOperationsHub mode="proposals" />}
        {module === "emails" && <CrmOperationsHub mode="emails" />}
        {module === "documents" && <CrmOperationsHub mode="documents" />}
        {module === "signatures" && <CrmOperationsHub mode="signatures" />}
        {module === "reports" && <CrmReportsPanel />}
      </div>
    </section>
  );
}
