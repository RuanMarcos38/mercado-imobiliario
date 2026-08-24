import { createFileRoute } from "@tanstack/react-router";
import { CrmPipelineWorkspace } from "@/components/crm/CrmPipelineWorkspace";

export const Route = createFileRoute("/_authenticated/crm")({
  component: CrmPipelineWorkspace,
  head: () => ({ title: "CRM de Oportunidades | MercadoImobi" }),
});
