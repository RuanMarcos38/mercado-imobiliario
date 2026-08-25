import { createFileRoute } from "@tanstack/react-router";
import { CrmWorkspaceShell } from "@/components/crm/CrmWorkspaceShell";

export const Route = createFileRoute("/_authenticated/crm")({
  component: CrmWorkspaceShell,
  head: () => ({ title: "CRM de Oportunidades | MercadoImobi" }),
});
