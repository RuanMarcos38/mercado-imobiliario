import { useEffect, useState } from "react";
import { CrmLeadInboxPanel } from "@/components/crm/CrmLeadInboxPanel";
import { CrmPipelineWorkspace } from "@/components/crm/CrmPipelineWorkspace";
import { CrmOperationsHub, type CrmOperationsMode } from "@/components/crm/CrmOperationsHub";
import { CrmReportsPanel } from "@/components/crm/CrmReportsPanel";
import { CrmDiagnosticsPanel } from "@/components/crm/CrmDiagnosticsPanel";
import { AtendimentoPage } from "@/routes/_authenticated/atendimento";

type Module = "leads" | "pipeline" | "attendance" | CrmOperationsMode | "reports" | "diagnostics";

const modules: Array<{ id: Module; label: string }> = [
  { id: "leads", label: "Leads" },
  { id: "pipeline", label: "Pipeline" },
  { id: "attendance", label: "Atendimento" },
  { id: "proposals", label: "Propostas" },
  { id: "emails", label: "E-mails" },
  { id: "documents", label: "Documentos" },
  { id: "signatures", label: "Assinaturas" },
  { id: "reports", label: "Relatórios" },
  { id: "diagnostics", label: "Diagnóstico" },
];

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
    <section className="crm-corporate-workspace">
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

      <nav className="crm-corporate-nav" aria-label="Módulos do CRM">
        {modules
          .filter((item) => item.id !== "diagnostics")
          .map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setModule(item.id)}
              className={module === item.id ? "is-active" : ""}
            >
              {item.label}
            </button>
          ))}
      </nav>

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
    </section>
  );
}
