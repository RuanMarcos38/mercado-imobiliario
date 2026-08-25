import { useState } from "react";
import { BarChart3, FileText, Layers3, Mail, Paperclip, PenLine, SearchCheck } from "lucide-react";
import { CrmPipelineWorkspace } from "@/components/crm/CrmPipelineWorkspace";
import { CrmOperationsHub, type CrmOperationsMode } from "@/components/crm/CrmOperationsHub";
import { CrmReportsPanel } from "@/components/crm/CrmReportsPanel";
import { CrmDiagnosticsPanel } from "@/components/crm/CrmDiagnosticsPanel";

type Module = "pipeline" | CrmOperationsMode | "reports" | "diagnostics";

const modules: Array<{ id: Module; label: string; icon: typeof Layers3 }> = [
  { id: "pipeline", label: "Pipeline", icon: Layers3 },
  { id: "proposals", label: "Propostas", icon: FileText },
  { id: "emails", label: "E-mails", icon: Mail },
  { id: "documents", label: "Documentos", icon: Paperclip },
  { id: "signatures", label: "Assinaturas", icon: PenLine },
  { id: "reports", label: "Relatórios", icon: BarChart3 },
  { id: "diagnostics", label: "Diagnóstico", icon: SearchCheck },
];

export function CrmWorkspaceShell() {
  const [module, setModule] = useState<Module>("pipeline");
  return (
    <div className="min-h-screen bg-[var(--mi-bg)] text-[var(--mi-text)]">
      <div className="sticky top-0 z-20 border-b border-[var(--mi-border)] bg-[var(--mi-surface)]/95 px-3 py-2 backdrop-blur sm:px-5">
        <nav
          className="mx-auto flex max-w-[1900px] gap-1 overflow-x-auto"
          aria-label="Módulos do CRM"
        >
          {modules.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setModule(item.id)}
                className={`flex min-w-[92px] items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-black transition ${
                  module === item.id
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-[var(--mi-text-muted)] hover:bg-[var(--mi-surface-soft)] hover:text-[var(--mi-text)]"
                }`}
              >
                <Icon className="h-4 w-4" /> {item.label}
              </button>
            );
          })}
        </nav>
      </div>
      {module === "pipeline" && <CrmPipelineWorkspace />}
      {module === "proposals" && <CrmOperationsHub mode="proposals" />}
      {module === "emails" && <CrmOperationsHub mode="emails" />}
      {module === "documents" && <CrmOperationsHub mode="documents" />}
      {module === "signatures" && <CrmOperationsHub mode="signatures" />}
      {module === "reports" && <CrmReportsPanel />}
      {module === "diagnostics" && <CrmDiagnosticsPanel />}
    </div>
  );
}
