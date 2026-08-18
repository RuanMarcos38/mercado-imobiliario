import { createFileRoute, Link } from "@tanstack/react-router";
import { Calculator } from "lucide-react";
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
  return (
    <>
      <div className="border-b border-[var(--mi-border)] bg-[var(--mi-surface)] px-4 py-3 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-black text-[var(--mi-text)]">Simulador de financiamento imobiliário</p>
            <p className="mt-0.5 text-xs text-[var(--mi-text-muted)]">Calcule pelo sistema PRICE e confirme a proposta no simulador oficial da CAIXA.</p>
          </div>
          <Link
            to="/simulador-financiamento"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-black text-white hover:bg-blue-700"
          >
            <Calculator className="h-4 w-4" /> Simular financiamento
          </Link>
        </div>
      </div>
      <PropertyWorkspaceAtendimento initialMarket="all" />
    </>
  );
}
