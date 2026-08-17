import { createFileRoute } from "@tanstack/react-router";
import { PropertyWorkspaceAtendimento } from "@/components/property/PropertyWorkspaceAtendimento";

export const Route = createFileRoute("/_authenticated/leiloes")({
  component: LeiloesPage,
  head: () => ({
    title: "Leilões CAIXA | MercadoImobi",
    meta: [
      {
        name: "description",
        content:
          "Leilões oficiais da CAIXA separados da busca geral. As demais modalidades CAIXA continuam disponíveis em Todos e no filtro CAIXA.",
      },
    ],
  }),
});

function LeiloesPage() {
  return <PropertyWorkspaceAtendimento initialMarket="auction" />;
}
