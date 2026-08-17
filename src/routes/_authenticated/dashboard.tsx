import { createFileRoute } from "@tanstack/react-router";
import { PropertyWorkspaceAtendimento } from "@/components/property/PropertyWorkspaceAtendimento";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
  head: () => ({
    title: "Imóveis | MercadoImobi",
    meta: [
      {
        name: "description",
        content:
          "Pesquise imóveis, oportunidades CAIXA, leilões e fontes imobiliárias conectadas em todo o Brasil.",
      },
    ],
  }),
});

function DashboardPage() {
  return <PropertyWorkspaceAtendimento initialMarket="all" />;
}
