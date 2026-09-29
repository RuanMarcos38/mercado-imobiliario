import { useEffect, useState, type ComponentType } from "react";
import {
  BarChart3,
  FileSignature,
  FileText,
  FolderOpen,
  KanbanSquare,
  Mail,
  MessageCircle,
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
  section: "main" | "other";
};

const modules: CrmModuleItem[] = [
  { id: "attendance", label: "Atendimento", icon: MessageCircle, section: "main" },
  { id: "leads", label: "Leads", icon: Users, section: "main" },
  { id: "pipeline", label: "Pipeline", icon: KanbanSquare, section: "main" },
  { id: "signatures", label: "Assinaturas", icon: FileSignature, section: "other" },
  { id: "documents", label: "Documentos", icon: FolderOpen, section: "other" },
  { id: "emails", label: "E-mails", icon: Mail, section: "other" },
  { id: "proposals", label: "Propostas", icon: FileText, section: "other" },
  { id: "reports", label: "Relatórios", icon: BarChart3, section: "other" },
  { id: "diagnostics", label: "Diagnóstico", icon: FileText, section: "other" },
];

const visibleModules = modules.filter((item) => item.id !== "diagnostics");
const mainModules = visibleModules.filter((item) => item.section === "main");
const otherModules = visibleModules.filter((item) => item.section === "other");

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

  return (
    <section className="crm-corporate-workspace crm-reference-workspace">
      <aside className="crm-reference-rail" aria-label="Módulos do CRM">
        <div className="crm-reference-rail-section">
          <span className="crm-reference-rail-label">Principal</span>
          {mainModules.map((item) => (
            <CrmModuleButton
              key={item.id}
              item={item}
              active={module === item.id}
              onSelect={() => setModule(item.id)}
            />
          ))}
        </div>

        <div className="crm-reference-rail-divider" />

        <div className="crm-reference-rail-section">
          <span className="crm-reference-rail-label">Outros</span>
          {otherModules.map((item) => (
            <CrmModuleButton
              key={item.id}
              item={item}
              active={module === item.id}
              onSelect={() => setModule(item.id)}
            />
          ))}
        </div>
      </aside>

      <div className="crm-reference-stage">
        <header className="crm-corporate-header">
          <div>
            <span className="crm-corporate-eyebrow">Gestão comercial</span>
            <h1>CRM e Oportunidades</h1>
            <p>Leads, atendimento, negociações e documentos em um único ambiente operacional.</p>
          </div>

          <label className="crm-corporate-search">
            <span>Buscar</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nome, telefone, protocolo ou oportunidade"
            />
          </label>
        </header>

        <div className="crm-reference-module-title">
          <div>
            <span>Módulo</span>
            <strong>{visibleModules.find((item) => item.id === module)?.label ?? "CRM"}</strong>
          </div>
        </div>

        <div className="crm-corporate-content">
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
    </section>
  );
}

function CrmModuleButton({
  item,
  active,
  onSelect,
}: {
  item: CrmModuleItem;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = item.icon;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={active ? "crm-reference-rail-button is-active" : "crm-reference-rail-button"}
      aria-label={item.label}
      title={item.label}
    >
      <Icon />
      <span>{item.label}</span>
    </button>
  );
}
