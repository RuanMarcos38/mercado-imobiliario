import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  Clock3,
  Filter,
  LineChart as LineChartIcon,
  PieChart as PieChartIcon,
} from "lucide-react";
import { getCrmOperationsWorkspace } from "@/lib/crm-operations.functions";

const PIE_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#8b5cf6", "#ef4444", "#0891b2", "#64748b"];

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function weekLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(date);
}

function avgDays(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function CrmReportsPanel() {
  const workspaceFn = useServerFn(getCrmOperationsWorkspace);
  const workspace = useQuery({
    queryKey: ["crm-reporting-workspace"],
    queryFn: () => workspaceFn(),
  });

  const report = useMemo(() => {
    const opportunities = workspace.data?.opportunities ?? [];
    const stages = [...(workspace.data?.stages ?? [])].sort((a, b) => a.position - b.position);
    const now = new Date();
    const weeks = Array.from({ length: 8 }, (_, index) => {
      const start = startOfWeek(
        new Date(now.getFullYear(), now.getMonth(), now.getDate() - (7 - index) * 7),
      );
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      const inside = (value: string | null | undefined) => {
        if (!value) return false;
        const date = new Date(value);
        return date >= start && date < end;
      };
      return {
        week: weekLabel(start),
        Novas: opportunities.filter((item) => inside(item.created_at)).length,
        Ganhas: opportunities.filter((item) => inside(item.won_at)).length,
        Perdidas: opportunities.filter((item) => inside(item.lost_at)).length,
        Abertas: opportunities.filter((item) => item.status === "open" && inside(item.updated_at))
          .length,
      };
    });
    const stageData = stages.map((stage) => ({
      name: stage.name,
      quantidade: opportunities.filter((item) => item.stage_id === stage.id).length,
    }));
    const sourceMap = new Map<string, number>();
    for (const opportunity of opportunities) {
      const source = opportunity.source?.trim() || "Não informado";
      sourceMap.set(source, (sourceMap.get(source) ?? 0) + 1);
    }
    const sources = [...sourceMap.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 7);
    const won = opportunities.filter((item) => item.status === "won");
    const lost = opportunities.filter((item) => item.status === "lost");
    const open = opportunities.filter((item) => item.status === "open");
    const leadTimes = [...won, ...lost]
      .map((item) => {
        const end = item.won_at || item.lost_at;
        if (!end) return null;
        const days = (new Date(end).getTime() - new Date(item.created_at).getTime()) / 86_400_000;
        return Number.isFinite(days) && days >= 0 ? days : null;
      })
      .filter((value): value is number => value != null);
    const gantt = open.slice(0, 12).map((item) => {
      const start = new Date(item.created_at);
      let end = item.expected_close_date
        ? new Date(`${item.expected_close_date}T23:59:59`)
        : item.next_action_at
          ? new Date(item.next_action_at)
          : new Date(start.getTime() + 30 * 86_400_000);
      if (end <= start) end = new Date(start.getTime() + 7 * 86_400_000);
      return { item, start, end };
    });
    const minGantt = gantt.length
      ? Math.min(...gantt.map((item) => item.start.getTime()))
      : now.getTime();
    const maxGantt = gantt.length
      ? Math.max(...gantt.map((item) => item.end.getTime()))
      : now.getTime() + 1;
    return {
      opportunities,
      weeks,
      stageData,
      sources,
      open,
      won,
      lost,
      leadTime: avgDays(leadTimes),
      conversion: won.length + lost.length ? (won.length / (won.length + lost.length)) * 100 : 0,
      gantt,
      minGantt,
      maxGantt,
    };
  }, [workspace.data]);

  if (workspace.isLoading)
    return <div className="p-8 text-sm text-[var(--mi-text-soft)]">Carregando relatórios...</div>;
  if (workspace.error || !workspace.data)
    return (
      <div className="m-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
        Não foi possível carregar os relatórios.
      </div>
    );

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8">
      <header>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">
          Inteligência comercial
        </p>
        <h1 className="mt-2 text-3xl font-black">Relatórios do Pipeline</h1>
        <p className="mt-2 max-w-4xl text-sm text-[var(--mi-text-muted)]">
          Visão executiva com gráficos de linhas, barras, pizza, Gantt e funil para acompanhar
          volume, conversão, origem, ciclo comercial e capacidade do time.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Novas oportunidades" value={String(report.opportunities.length)} />
        <Metric label="Em aberto" value={String(report.open.length)} />
        <Metric label="Ganhas" value={String(report.won.length)} />
        <Metric label="Perdidas" value={String(report.lost.length)} />
        <Metric label="Conversão" value={`${report.conversion.toFixed(1)}%`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard
          icon={LineChartIcon}
          title="Oportunidades por período (semanal)"
          description="Novas, ganhas, perdidas e oportunidades atualizadas em aberto."
        >
          <div className="h-[330px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={report.weeks} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis dataKey="week" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="Novas" stroke="#f59e0b" strokeWidth={2} />
                <Line type="monotone" dataKey="Ganhas" stroke="#16a34a" strokeWidth={2} />
                <Line type="monotone" dataKey="Perdidas" stroke="#ef4444" strokeWidth={2} />
                <Line type="monotone" dataKey="Abertas" stroke="#2563eb" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          icon={BarChart3}
          title="Oportunidades por etapa"
          description="Comparação do volume atual em cada fase do Pipeline."
        >
          <div className="h-[330px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={report.stageData}
                margin={{ top: 10, right: 20, left: 0, bottom: 50 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis
                  dataKey="name"
                  angle={-25}
                  textAnchor="end"
                  interval={0}
                  height={80}
                  fontSize={10}
                />
                <YAxis allowDecimals={false} fontSize={11} />
                <Tooltip />
                <Bar dataKey="quantidade" fill="#2563eb" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          icon={PieChartIcon}
          title="Origem das oportunidades"
          description="Distribuição dos contatos por canal de entrada."
        >
          <div className="h-[330px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={report.sources} dataKey="value" nameKey="name" outerRadius={110} label>
                  {report.sources.map((entry, index) => (
                    <Cell
                      key={`${entry.name}-${index}`}
                      fill={PIE_COLORS[index % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          icon={Filter}
          title="Gráfico de funil"
          description="Volume por etapa para identificar gargalos e perdas de conversão."
        >
          <div className="space-y-3 py-3">
            {report.stageData.map((stage, index) => {
              const max = Math.max(1, ...report.stageData.map((item) => item.quantidade));
              const width = Math.max(18, (stage.quantidade / max) * 100);
              return (
                <div key={`${stage.name}-${index}`} className="text-center">
                  <div
                    className="mx-auto flex h-10 items-center justify-center rounded-lg bg-blue-600 px-3 text-xs font-black text-white"
                    style={{ width: `${width}%` }}
                  >
                    {stage.name} · {stage.quantidade}
                  </div>
                </div>
              );
            })}
          </div>
        </ChartCard>
      </div>

      <ChartCard
        icon={Clock3}
        title="Diagrama de Gantt comercial"
        description={`Planejamento das oportunidades abertas. Lead time médio encerrado: ${report.leadTime.toFixed(1)} dias.`}
      >
        <div className="space-y-3 overflow-x-auto py-2">
          {report.gantt.length ? (
            report.gantt.map(({ item, start, end }) => {
              const range = Math.max(1, report.maxGantt - report.minGantt);
              const left = ((start.getTime() - report.minGantt) / range) * 100;
              const width = Math.max(3, ((end.getTime() - start.getTime()) / range) * 100);
              return (
                <div
                  key={item.id}
                  className="grid min-w-[760px] grid-cols-[220px_1fr_110px] items-center gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black">{item.contact_name}</p>
                    <p className="truncate text-[10px] text-[var(--mi-text-soft)]">
                      {item.protocol_code}
                    </p>
                  </div>
                  <div className="relative h-8 rounded-lg bg-[var(--mi-bg)]">
                    <div
                      className="absolute top-1 h-6 rounded-md bg-blue-600"
                      style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                    />
                  </div>
                  <div className="text-right text-[10px] text-[var(--mi-text-soft)]">
                    {start.toLocaleDateString("pt-BR")} → {end.toLocaleDateString("pt-BR")}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-8 text-center text-sm text-[var(--mi-text-soft)]">
              Nenhuma oportunidade aberta para o Gantt.
            </div>
          )}
        </div>
      </ChartCard>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function ChartCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof BarChart3;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-600">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h2 className="font-black">{title}</h2>
          <p className="mt-1 text-xs text-[var(--mi-text-soft)]">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
