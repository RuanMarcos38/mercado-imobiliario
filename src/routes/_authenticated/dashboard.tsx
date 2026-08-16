import { createFileRoute } from "@tanstack/react-router";
import { PropertyWorkspace } from "@/components/property/PropertyWorkspace";

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
  return <PropertyWorkspace initialMarket="all" />;
}
