import { createFileRoute } from "@tanstack/react-router";
import { PropertyWorkspaceAtendimento } from "@/components/property/PropertyWorkspaceAtendimento";

export const Route = createFileRoute("/_authenticated/leiloes")({
  component: LeiloesPage,
  head: () => ({
    title: "CAIXA e Leilões | MercadoImobi",
    meta: [
      {
        name: "description",
        content:
          "Oportunidades oficiais da CAIXA com modalidade de venda identificada, incluindo leilões, licitações e venda online.",
      },
    ],
  }),
});

function LeiloesPage() {
  return <PropertyWorkspaceAtendimento initialMarket="caixa" />;
}
