import { BarChart3, Building2, Gavel, Radio, TrendingUp } from "lucide-react";

interface PropertySearchSummaryPanelProps {
  total: number;
  opportunities: number;
  activeSources: number;
  auctions: number;
  marketProperties: number;
  caixaProperties: number;
  marketLabel: string;
}

export function PropertySearchSummaryPanel({
  total,
  opportunities,
  activeSources,
  auctions,
  marketProperties,
  caixaProperties,
  marketLabel,
}: PropertySearchSummaryPanelProps) {
  const base = Math.max(1, marketProperties + caixaProperties);
  const marketPct = Math.max(0, Math.min(100, (marketProperties / base) * 100));
  const caixaPct = 100 - marketPct;

  return (
    <aside
      className="relative hidden overflow-hidden rounded-3xl p-6 text-white shadow-lift ring-1 ring-white/5 sm:p-7 lg:sticky lg:top-20 lg:self-start lg:block"
      style={{ background: "var(--gradient-results)" }}
    >
      <div className="mb-5 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/55">
          Resultados da busca
        </span>
        <BarChart3 className="h-4 w-4 text-white/40" />
      </div>

      <div className="mb-7 flex gap-1 rounded-xl bg-white/[0.04] p-1 ring-1 ring-white/[0.06]">
        <div className="flex-1 rounded-lg bg-white/[0.08] px-3 py-2 text-center ring-1 ring-white/10">
          <span className="block text-[10px] font-semibold text-white">{marketLabel}</span>
          <span className="mt-0.5 block font-mono text-[8px] uppercase tracking-wider text-white/45">
            filtro ativo
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-3 text-[10px] font-medium text-white/55">
          <Radio className="h-3 w-3 text-emerald-300" /> Ao vivo
        </div>
      </div>

      <div className="mb-7 text-center">
        <div className="flex items-baseline justify-center">
          <span className="text-5xl font-bold tracking-tighter tabular-nums sm:text-6xl">
            {formatInteger(total)}
          </span>
        </div>
        <p className="mt-1 text-xs text-white/55">Imóveis encontrados na base selecionada</p>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <Metric icon={<TrendingUp className="h-3.5 w-3.5" />} label="Oportunidades" value={opportunities} accent />
        <Metric icon={<Building2 className="h-3.5 w-3.5" />} label="Fontes ativas" value={activeSources} />
      </div>

      <div className="mb-5 flex items-center justify-between rounded-xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06]">
        <div>
          <span className="font-mono text-[9px] uppercase tracking-wider text-white/50">Leilões CAIXA</span>
          <p className="mt-1.5 text-xl font-bold tabular-nums text-white">{formatInteger(auctions)}</p>
        </div>
        <span className="grid h-9 w-9 place-items-center rounded-full bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/20">
          <Gavel className="h-4 w-4" />
        </span>
      </div>

      <div>
        <div className="mb-2 flex justify-between font-mono text-[9px] uppercase tracking-wider text-white/50">
          <span>Mercado</span>
          <span>CAIXA</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full bg-white/30" style={{ width: `${marketPct}%` }} />
          <div className="h-full bg-indigo-400" style={{ width: `${caixaPct}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-white/45">
          <span>{formatInteger(marketProperties)}</span>
          <span>{formatInteger(caixaProperties)}</span>
        </div>
        <p className="mt-4 text-center text-[11px] italic text-white/45">
          Dados reais da base MercadoImobi e fontes sincronizadas.
        </p>
      </div>
    </aside>
  );
}

function Metric({
  icon,
  label,
  value,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06]">
      <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-white/50">
        {icon} {label}
      </span>
      <p className={`mt-1.5 text-xl font-bold tabular-nums ${accent ? "text-indigo-300" : "text-white"}`}>
        {formatInteger(value)}
      </p>
    </div>
  );
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value || 0);
}
