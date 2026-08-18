import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Calculator, ExternalLink, Home, Landmark, ShieldCheck, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CAIXA_SIMULATOR_URL = "https://simuladorhabitacao.caixa.gov.br/";

export const Route = createFileRoute("/_authenticated/simulador-financiamento")({
  component: FinancingSimulatorPage,
  head: () => ({ title: "Simulador de Financiamento | MercadoImobi" }),
});

function FinancingSimulatorPage() {
  const [propertyValue, setPropertyValue] = useState(350000);
  const [downPayment, setDownPayment] = useState(70000);
  const [annualRate, setAnnualRate] = useState(10.5);
  const [months, setMonths] = useState(360);

  const simulation = useMemo(() => {
    const financed = Math.max(0, propertyValue - downPayment);
    const monthlyRate = Math.pow(1 + Math.max(0, annualRate) / 100, 1 / 12) - 1;
    const payment =
      financed <= 0
        ? 0
        : monthlyRate === 0
          ? financed / Math.max(1, months)
          : financed * (monthlyRate / (1 - Math.pow(1 + monthlyRate, -Math.max(1, months))));
    const totalPaid = payment * Math.max(1, months);
    const totalInterest = Math.max(0, totalPaid - financed);
    const suggestedIncome = payment / 0.3;
    return { financed, monthlyRate, payment, totalPaid, totalInterest, suggestedIncome };
  }, [annualRate, downPayment, months, propertyValue]);

  return (
    <div className="min-h-screen bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Crédito imobiliário</p>
            <h1 className="mt-2 text-3xl font-black">Simulador de Financiamento PRICE</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--mi-text-muted)]">
              Faça uma estimativa rápida pelo sistema PRICE e, em seguida, confirme as condições reais no Simulador Habitacional oficial da CAIXA.
            </p>
          </div>
          <a href={CAIXA_SIMULATOR_URL} target="_blank" rel="noopener noreferrer">
            <Button className="h-11 rounded-xl bg-blue-600 px-5 text-white hover:bg-blue-700">
              <Landmark className="mr-2 h-4 w-4" /> Abrir Simulador oficial CAIXA <ExternalLink className="ml-2 h-3.5 w-3.5" />
            </Button>
          </a>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.05fr]">
          <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-500/10 text-blue-600"><Calculator className="h-5 w-5" /></span>
              <div><h2 className="font-black">Dados da simulação</h2><p className="text-xs text-[var(--mi-text-muted)]">Altere os valores para recalcular automaticamente.</p></div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Field label="Valor do imóvel (R$)">
                <Input type="number" min={0} step={1000} value={propertyValue} onChange={(e) => setPropertyValue(Number(e.target.value) || 0)} />
              </Field>
              <Field label="Entrada / recursos próprios (R$)">
                <Input type="number" min={0} step={1000} value={downPayment} onChange={(e) => setDownPayment(Number(e.target.value) || 0)} />
              </Field>
              <Field label="Taxa efetiva anual (%)">
                <Input type="number" min={0} step={0.01} value={annualRate} onChange={(e) => setAnnualRate(Number(e.target.value) || 0)} />
              </Field>
              <Field label="Prazo (meses)">
                <Input type="number" min={1} max={420} step={12} value={months} onChange={(e) => setMonths(Math.min(420, Math.max(1, Number(e.target.value) || 1)))} />
              </Field>
            </div>

            <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-xs leading-5 text-[var(--mi-text-muted)]">
              Esta calculadora é uma estimativa matemática pelo sistema PRICE. Não inclui TR, seguros MIP/DFI, tarifas, CET, subsídios, FGTS, avaliação de risco ou regras específicas da CAIXA. A proposta oficial deve ser confirmada no simulador da instituição.
            </div>
          </section>

          <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600"><WalletCards className="h-5 w-5" /></span>
              <div><h2 className="font-black">Resultado estimado</h2><p className="text-xs text-[var(--mi-text-muted)]">Parcela fixa de principal + juros pelo PRICE.</p></div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Metric label="Valor financiado" value={money(simulation.financed)} icon={<Home className="h-4 w-4" />} />
              <Metric label="Parcela PRICE estimada" value={money(simulation.payment)} emphasis icon={<Calculator className="h-4 w-4" />} />
              <Metric label="Total das parcelas" value={money(simulation.totalPaid)} icon={<WalletCards className="h-4 w-4" />} />
              <Metric label="Juros totais estimados" value={money(simulation.totalInterest)} icon={<Landmark className="h-4 w-4" />} />
            </div>

            <div className="mt-4 rounded-2xl border border-blue-500/20 bg-blue-500/[0.05] p-4">
              <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" /><div><p className="text-sm font-black">Renda bruta de referência</p><p className="mt-1 text-2xl font-black text-blue-600">{money(simulation.suggestedIncome)}</p><p className="mt-1 text-xs leading-5 text-[var(--mi-text-muted)]">Referência calculada considerando prestação equivalente a 30% da renda bruta. A aprovação real depende da análise de crédito e das regras vigentes da CAIXA.</p></div></div>
            </div>

            <a href={CAIXA_SIMULATOR_URL} target="_blank" rel="noopener noreferrer" className="mt-5 block">
              <Button variant="outline" className="h-11 w-full rounded-xl">Confirmar no Simulador Habitacional CAIXA <ExternalLink className="ml-2 h-4 w-4" /></Button>
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}

function Metric({ label, value, icon, emphasis = false }: { label: string; value: string; icon: React.ReactNode; emphasis?: boolean }) {
  return <div className={`rounded-2xl border p-4 ${emphasis ? "border-blue-500/25 bg-blue-500/[0.06]" : "border-[var(--mi-border)] bg-[var(--mi-bg)]"}`}><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">{icon}{label}</div><p className={`mt-2 text-xl font-black ${emphasis ? "text-blue-600" : "text-[var(--mi-text)]"}`}>{value}</p></div>;
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0);
}
