import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
  ArrowUpRight,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  DollarSign,
  UsersRound,
} from "lucide-react";
import { getCrmWorkspace } from "@/lib/crm-advanced.functions";
import { listCrmLeadInbox } from "@/lib/crm-lead-inbox.functions";

type DashboardTarget = "leads" | "pipeline" | "reports";

const chartPalette = ["#14b8a6", "#2dd4bf", "#38bdf8", "#60a5fa", "#34d399", "#a7f3d0"];

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
}

function shortDate(value: string | null | undefined) {
  if (!value) return "Sem prazo";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Sem prazo";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date);
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "MI";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { month: "short" })
    .format(date)
    .replace(".", "")
    .replace(/^./, (value) => value.toUpperCase());
}

export function CrmDashboardOverview({
  onNavigate,
}: {
  onNavigate: (target: DashboardTarget) => void;
}) {
  const workspaceFn = useServerFn(getCrmWorkspace);
  const leadsFn = useServerFn(listCrmLeadInbox);

  const workspace = useQuery({
    queryKey: ["crm-dashboard-workspace"],
    queryFn: () => workspaceFn(),
    refetchInterval: 60_000,
  });

  const leads = useQuery({
    queryKey: ["crm-dashboard-leads"],
    queryFn: () => leadsFn(),
    refetchInterval: 60_000,
  });

  const dashboard = useMemo(() => {
    const crm = workspace.data;
    const leadRows = leads.data ?? [];
    const opportunities = crm?.opportunities ?? [];
    const stages = [...(crm?.stages ?? [])]
      .filter((stage) => stage.is_active)
      .sort((a, b) => a.position - b.position);
    const activities = [...(crm?.activities ?? [])]
      .filter((activity) => activity.status === "pending")
      .sort((a, b) => {
        const left = a.due_at ? new Date(a.due_at).getTime() : Number.MAX_SAFE_INTEGER;
        const right = b.due_at ? new Date(b.due_at).getTime() : Number.MAX_SAFE_INTEGER;
        return left - right;
      });

    const open = opportunities.filter((item) => item.status === "open");
    const won = opportunities.filter((item) => item.status === "won");
    const lost = opportunities.filter((item) => item.status === "lost");
    const pipelineValue = open.reduce((sum, item) => sum + Number(item.value ?? 0), 0);
    const revenue = won.reduce((sum, item) => sum + Number(item.value ?? 0), 0);
    const qualifiedLeads = leadRows.filter((lead) =>
      ["qualified", "converted"].includes(lead.status),
    ).length;
    const conversion =
      won.length + lost.length ? (won.length / (won.length + lost.length)) * 100 : 0;

    const stageData = stages.map((stage) => {
      const stageOpportunities = opportunities.filter((item) => item.stage_id === stage.id);
      return {
        id: stage.id,
        name: stage.name,
        value: stageOpportunities.length,
        amount: stageOpportunities.reduce((sum, item) => sum + Number(item.value ?? 0), 0),
      };
    });

    const sourceMap = new Map<string, number>();
    for (const lead of leadRows) {
      const source = lead.source?.trim() || "Não informado";
      sourceMap.set(source, (sourceMap.get(source) ?? 0) + 1);
    }
    if (!sourceMap.size) {
      for (const opportunity of opportunities) {
        const source = opportunity.source?.trim() || "Não informado";
        sourceMap.set(source, (sourceMap.get(source) ?? 0) + 1);
      }
    }
    const sources = [...sourceMap.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    const now = new Date();
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
      const key = monthKey(date);
      const monthWon = won.filter((item) => item.won_at && monthKey(new Date(item.won_at)) === key);
      const monthLost = lost.filter(
        (item) => item.lost_at && monthKey(new Date(item.lost_at)) === key,
      );
      const closed = monthWon.length + monthLost.length;
      return {
        month: monthLabel(date),
        taxa: closed ? Math.round((monthWon.length / closed) * 100) : 0,
      };
    });

    const recentDeals = [...opportunities]
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 5);

    const sourcePerformance = [
      ...new Set(opportunities.map((item) => item.source || "Não informado")),
    ]
      .map((source) => {
        const sourceOpps = opportunities.filter(
          (item) => (item.source || "Não informado") === source,
        );
        const sourceWon = sourceOpps.filter((item) => item.status === "won");
        const sourceLost = sourceOpps.filter((item) => item.status === "lost");
        const closed = sourceWon.length + sourceLost.length;
        return {
          source,
          opportunities: sourceOpps.length,
          won: sourceWon.length,
          revenue: sourceWon.reduce((sum, item) => sum + Number(item.value ?? 0), 0),
          rate: closed ? (sourceWon.length / closed) * 100 : 0,
        };
      })
      .sort((a, b) => b.opportunities - a.opportunities)
      .slice(0, 5);

    const recentActivity = [
      ...leadRows.map((lead) => ({
        id: `lead-${lead.id}`,
        name: lead.contact_name,
        description:
          lead.status === "converted"
            ? "Lead convertido em oportunidade"
            : lead.last_message || "Lead atualizado",
        at: lead.last_activity_at || lead.updated_at,
        kind: "lead" as const,
      })),
      ...opportunities.map((item) => ({
        id: `opp-${item.id}`,
        name: item.contact_name,
        description:
          item.status === "won"
            ? "Negócio marcado como ganho"
            : item.status === "lost"
              ? "Negócio encerrado como perdido"
              : "Oportunidade atualizada",
        at: item.updated_at,
        kind: "opportunity" as const,
      })),
    ]
      .filter((item) => item.at)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 5);

    return {
      leadRows,
      opportunities,
      activities,
      open,
      won,
      lost,
      pipelineValue,
      revenue,
      qualifiedLeads,
      conversion,
      stageData,
      sources,
      months,
      recentDeals,
      sourcePerformance,
      recentActivity,
    };
  }, [leads.data, workspace.data]);

  if (workspace.isLoading || leads.isLoading) {
    return (
      <div className="crm-salespro-loading">
        <span className="crm-salespro-loading-dot" />
        Carregando dashboard do CRM...
      </div>
    );
  }

  if (workspace.error || leads.error || !workspace.data) {
    return (
      <div className="crm-salespro-error">
        Não foi possível carregar o dashboard agora. Os demais módulos do CRM continuam disponíveis.
      </div>
    );
  }

  const cards = [
    {
      label: "Total de leads",
      value: dashboard.leadRows.length.toLocaleString("pt-BR"),
      caption: "leads cadastrados",
      icon: UsersRound,
      tone: "teal",
    },
    {
      label: "Leads qualificados",
      value: dashboard.qualifiedLeads.toLocaleString("pt-BR"),
      caption: "qualificados ou convertidos",
      icon: CheckCircle2,
      tone: "green",
    },
    {
      label: "Negócios ganhos",
      value: dashboard.won.length.toLocaleString("pt-BR"),
      caption: "oportunidades concluídas",
      icon: BriefcaseBusiness,
      tone: "blue",
    },
    {
      label: "Receita ganha",
      value: money(dashboard.revenue),
      caption: "soma dos negócios ganhos",
      icon: DollarSign,
      tone: "mint",
    },
  ];

  return (
    <div className="crm-salespro-dashboard">
      <section className="crm-salespro-welcome">
        <div>
          <h1>Visão geral do CRM</h1>
          <p>Acompanhe leads, pipeline, negócios e atividade comercial em um só lugar.</p>
        </div>
        <div className="crm-salespro-date-range">
          <Clock3 />
          <span>Atualização automática a cada 60 segundos</span>
        </div>
      </section>

      <section className="crm-salespro-metrics">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <article key={card.label} className="crm-salespro-metric-card">
              <div className={`crm-salespro-metric-icon is-${card.tone}`}>
                <Icon />
              </div>
              <div className="crm-salespro-metric-copy">
                <span>{card.label}</span>
                <strong>{card.value}</strong>
                <small>{card.caption}</small>
              </div>
              <ArrowUpRight className="crm-salespro-metric-arrow" />
            </article>
          );
        })}
      </section>

      <section className="crm-salespro-grid crm-salespro-grid-primary">
        <article className="crm-salespro-card crm-salespro-pipeline-card">
          <div className="crm-salespro-card-head">
            <div>
              <h2>Pipeline de vendas</h2>
              <p>
                Valor total em aberto: <strong>{money(dashboard.pipelineValue)}</strong>
              </p>
            </div>
            <button type="button" onClick={() => onNavigate("pipeline")}>
              Ver pipeline
            </button>
          </div>

          <div className="crm-salespro-funnel">
            {dashboard.stageData.length ? (
              dashboard.stageData.slice(0, 6).map((stage, index) => {
                const max = Math.max(...dashboard.stageData.map((item) => item.value), 1);
                const width = Math.max(44, Math.round((stage.value / max) * 100));
                return (
                  <div key={stage.id} className="crm-salespro-funnel-row">
                    <div className="crm-salespro-funnel-shape" style={{ width: `${width}%` }}>
                      <span>{stage.value}</span>
                    </div>
                    <div className="crm-salespro-funnel-label">
                      <strong>{stage.name}</strong>
                      <span>{money(stage.amount)}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="crm-salespro-empty">Nenhuma etapa de pipeline disponível.</div>
            )}
          </div>
        </article>

        <article className="crm-salespro-card">
          <div className="crm-salespro-card-head">
            <div>
              <h2>Negócios por etapa</h2>
              <p>Distribuição atual das oportunidades</p>
            </div>
          </div>
          <div className="crm-salespro-chart crm-salespro-chart-stage">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dashboard.stageData}>
                <CartesianGrid stroke="#edf3f4" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip />
                <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                  {dashboard.stageData.map((entry, index) => (
                    <Cell key={entry.id} fill={chartPalette[index % chartPalette.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="crm-salespro-grid crm-salespro-grid-secondary">
        <article className="crm-salespro-card">
          <div className="crm-salespro-card-head">
            <div>
              <h2>Origem dos leads</h2>
              <p>Distribuição dos contatos por canal</p>
            </div>
          </div>
          <div className="crm-salespro-source-layout">
            <div className="crm-salespro-chart crm-salespro-chart-donut">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={dashboard.sources}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={54}
                    outerRadius={84}
                    paddingAngle={2}
                  >
                    {dashboard.sources.map((entry, index) => (
                      <Cell key={entry.name} fill={chartPalette[index % chartPalette.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="crm-salespro-donut-total">
                <strong>{dashboard.leadRows.length}</strong>
                <span>Total</span>
              </div>
            </div>
            <div className="crm-salespro-source-list">
              {dashboard.sources.map((source, index) => (
                <div key={source.name}>
                  <span
                    className="crm-salespro-source-dot"
                    style={{ backgroundColor: chartPalette[index % chartPalette.length] }}
                  />
                  <strong>{source.name}</strong>
                  <span>{source.value}</span>
                </div>
              ))}
            </div>
          </div>
        </article>

        <article className="crm-salespro-card">
          <div className="crm-salespro-card-head">
            <div>
              <h2>Taxa de conversão</h2>
              <p>Últimos seis meses por negócios encerrados</p>
            </div>
            <span className="crm-salespro-rate-chip">{dashboard.conversion.toFixed(1)}%</span>
          </div>
          <div className="crm-salespro-chart crm-salespro-chart-line">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dashboard.months}>
                <CartesianGrid stroke="#edf3f4" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(value) => `${value}%`}
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip formatter={(value) => [`${value}%`, "Conversão"]} />
                <Line
                  type="monotone"
                  dataKey="taxa"
                  stroke="#14b8a6"
                  strokeWidth={3}
                  dot={{ fill: "#14b8a6", r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="crm-salespro-grid crm-salespro-grid-lists">
        <article className="crm-salespro-card">
          <div className="crm-salespro-card-head">
            <div>
              <h2>Próximas tarefas</h2>
              <p>Atividades pendentes do pipeline</p>
            </div>
            <button type="button" onClick={() => onNavigate("pipeline")}>
              Ver todas
            </button>
          </div>
          <div className="crm-salespro-task-list">
            {dashboard.activities.slice(0, 5).map((activity) => (
              <div key={activity.id}>
                <span className="crm-salespro-task-check" />
                <div>
                  <strong>{activity.title}</strong>
                  <small>{activity.description || activity.kind}</small>
                </div>
                <time>{shortDate(activity.due_at)}</time>
              </div>
            ))}
            {!dashboard.activities.length && (
              <div className="crm-salespro-empty">Nenhuma tarefa pendente.</div>
            )}
          </div>
        </article>

        <article className="crm-salespro-card">
          <div className="crm-salespro-card-head">
            <div>
              <h2>Negócios recentes</h2>
              <p>Últimas oportunidades movimentadas</p>
            </div>
            <button type="button" onClick={() => onNavigate("pipeline")}>
              Ver todos
            </button>
          </div>
          <div className="crm-salespro-table-wrap">
            <table className="crm-salespro-table">
              <thead>
                <tr>
                  <th>Contato</th>
                  <th>Valor</th>
                  <th>Status</th>
                  <th>Fechamento</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.recentDeals.map((deal) => (
                  <tr key={deal.id}>
                    <td>
                      <strong>{deal.contact_name}</strong>
                      <small>{deal.source || "Sem origem"}</small>
                    </td>
                    <td>{money(Number(deal.value ?? 0))}</td>
                    <td>
                      <span className={`crm-salespro-status is-${deal.status}`}>
                        {deal.status === "won"
                          ? "Ganho"
                          : deal.status === "lost"
                            ? "Perdido"
                            : "Aberto"}
                      </span>
                    </td>
                    <td>{shortDate(deal.expected_close_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!dashboard.recentDeals.length && (
              <div className="crm-salespro-empty">Nenhuma oportunidade cadastrada.</div>
            )}
          </div>
        </article>
      </section>

      <section className="crm-salespro-grid crm-salespro-grid-footer">
        <article className="crm-salespro-card">
          <div className="crm-salespro-card-head">
            <div>
              <h2>Performance por origem</h2>
              <p>Volume, ganhos, receita e conversão por canal</p>
            </div>
            <button type="button" onClick={() => onNavigate("reports")}>
              Relatórios
            </button>
          </div>
          <div className="crm-salespro-table-wrap">
            <table className="crm-salespro-table crm-salespro-performance-table">
              <thead>
                <tr>
                  <th>Origem</th>
                  <th>Oportunidades</th>
                  <th>Ganhos</th>
                  <th>Receita</th>
                  <th>Conversão</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.sourcePerformance.map((row) => (
                  <tr key={row.source}>
                    <td>
                      <strong>{row.source}</strong>
                    </td>
                    <td>{row.opportunities}</td>
                    <td>{row.won}</td>
                    <td>{money(row.revenue)}</td>
                    <td>
                      <div className="crm-salespro-progress">
                        <span style={{ width: `${Math.min(100, row.rate)}%` }} />
                      </div>
                      <small>{row.rate.toFixed(0)}%</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!dashboard.sourcePerformance.length && (
              <div className="crm-salespro-empty">Sem dados suficientes para comparação.</div>
            )}
          </div>
        </article>

        <article className="crm-salespro-card">
          <div className="crm-salespro-card-head">
            <div>
              <h2>Atividade do cliente</h2>
              <p>Movimentações recentes de leads e oportunidades</p>
            </div>
            <button type="button" onClick={() => onNavigate("leads")}>
              Ver leads
            </button>
          </div>
          <div className="crm-salespro-activity-list">
            {dashboard.recentActivity.map((activity) => (
              <div key={activity.id}>
                <span className="crm-salespro-activity-avatar">{initials(activity.name)}</span>
                <div>
                  <strong>{activity.name}</strong>
                  <small>{activity.description}</small>
                </div>
                <time>
                  {new Intl.DateTimeFormat("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(activity.at))}
                </time>
              </div>
            ))}
            {!dashboard.recentActivity.length && (
              <div className="crm-salespro-empty">Nenhuma atividade recente.</div>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
