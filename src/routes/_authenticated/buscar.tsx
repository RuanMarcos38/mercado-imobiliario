import { createFileRoute } from "@tanstack/react-router";
import { PropertyWorkspace } from "@/components/property/PropertyWorkspace";

export const Route = createFileRoute("/_authenticated/buscar")({
  component: BuscarImoveisPage,
  head: () => ({
    title: "Buscar imóveis | MercadoImobi",
    meta: [
      {
        name: "description",
        content: "Pesquise imóveis reais em toda a base conectada do MercadoImobi.",
      },
    ],
  }),
});

function BuscarImoveisPage() {
  return <PropertyWorkspace initialMarket="all" />;
}
