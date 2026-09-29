import { useEffect, useState, type ComponentType } from "react";
import {
  BarChart3,
  ChevronRight,
  Columns3,
  FileSignature,
  FileText,
  FolderOpen,
  Mail,
  MessageCircle,
  Search,
  Users,
} from "lucide-react";
import { CrmLeadInboxPanel } from "@/components/crm/CrmLeadInboxPanel";
import { CrmPipelineWorkspace } from "@/components/crm/CrmPipelineWorkspace";
import { CrmOperationsHub, type CrmOperationsMode } from "@/components/crm/CrmOperationsHub";
import { CrmReportsPanel } from "@/components/crm/CrmReportsPanel";
import { CrmDiagnosticsPanel } from "@/components/crm/CrmDiagnosticsPanel";
import { AtendimentoPage } from "@/routes/_authenticated/atendimento";

type Module = "leads" | "pipeline" | "attendance" | CrmOperationsMode | "reports" | "diagnostics";

type CrmModuleItem = {
  id: Module;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const modules: CrmModuleItem[] = [
  { id: "leads", label: "Leads", icon: Users },
  { id: "pipeline", label: "Pipeline", icon: Columns3 },
  { id: "attendance", label: "Atendimento", icon: MessageCircle },
  { id: "proposals", label: "Propostas", icon: FileText },
  { id: "emails", label: "E-mails", icon: Mail },
  { id: "documents", label: "Documentos", icon: FolderOpen },
  { id: "signatures", label: "Assinaturas", icon: FileSignature },
  { id: "reports", label: "Relatórios", icon: BarChart3 },
  { id: "diagnostics", label: "Diagnóstico", icon: FileText },
];

const visibleModules = modules.filter((item) => item.id !== "diagnostics");

export function CrmWorkspaceShell() {
  const [module, setModule] = useState<Module>("leads");
  const [search, setSearch] = useState("");

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

  const currentModule = visibleModules.find((item) => item.id === module);

  return (
    <section className="crm-corporate-workspace crm-medcare-workspace crm-aligno-workspace">
      <header className="crm-medcare-header crm-aligno-header">
        <div className="crm-aligno-heading">
          <div className="crm-aligno-breadcrumb" aria-label="Localização no CRM">
            <span>CRM</span>
            <ChevronRight aria-hidden="true" />
            <span>Oportunidades</span>
            <ChevronRight aria-hidden="true" />
            <strong>{currentModule?.label ?? "CRM"}</strong>
          </div>
          <h1>{currentModule?.label ?? "CRM"}</h1>
        </div>

        <div className="crm-aligno-header-actions">
          <label className="crm-medcare-search crm-aligno-search">
            <Search />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar..."
            />
          </label>
        </div>
      </header>

      <nav className="crm-medcare-nav crm-aligno-nav" aria-label="Módulos do CRM">
        {visibleModules.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setModule(item.id)}
              className={module === item.id ? "is-active" : ""}
            >
              <Icon />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="crm-corporate-content crm-medcare-content crm-aligno-content">
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
    </section>
  );
}
