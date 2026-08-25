import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CalendarClock,
  Clock3,
  Download,
  Landmark,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAffiliateAdminOverview } from "@/lib/affiliate-live.functions";

export const Route = createFileRoute("/_authenticated/admin/comissoes")({
  component: AffiliateExecutiveDashboard,
  head: () => ({ title: "Painel Executivo de Afiliados | MercadoImobi" }),
});

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);

const dateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("pt-BR") : "—";

function escapeCsv(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Array<unknown>>) {
  const csv = rows.map((row) => row.map(escapeCsv).join(";")).join("\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function AffiliateExecutiveDashboard() {
  const overviewFn = useServerFn(getAffiliateAdminOverview);
  const overview = useQuery({
    queryKey: ["affiliate-admin-live"],
    queryFn: () => overviewFn(),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  if (overview.isLoading) {
    return (
      <div className="p-8 text-sm text-[var(--mi-text-muted)]">
        Carregando painel executivo de afiliados...
      </div>
    );
  }

  if (overview.error || !overview.data) {
    return (
      <div className="m-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
        Não foi possível carregar o painel executivo.{" "}
        {String((overview.error as Error)?.message ?? "")}
      </div>
    );
  }

  const data = overview.data;
  const metrics = data.metrics;
  const maxRevenue = Math.max(1, ...data.revenueDaily.map((item) => item.grossRevenue));

  const exportReport = () => {
    downloadCsv(`mercadoimobi-afiliados-${new Date().toISOString().slice(0, 10)}.csv`, [
      [
        "Usuário",
        "Empresa",
        "Código",
        "Status",
        "Indicações diretas",
        "Comissão total",
        "Em validação",
        "Disponível",
        "Pago",
        "Última comissão",
        "Último saque",
        "Próxima liberação",
      ],
      ...data.users.map((item) => [
        item.name,
        item.companyName ?? "",
        item.referralCode,
        item.isActive ? "Ativo" : "Inativo",
        item.directReferrals,
        item.commissionTotal.toFixed(2),
        item.commissionPending.toFixed(2),
        item.commissionAvailable.toFixed(2),
        item.commissionPaid.toFixed(2),
        dateTime(item.lastCommissionAt),
        dateTime(item.lastPayoutAt),
        dateTime(item.nextReleaseAt),
      ]),
    ]);
  };

  return (
    <div className="min-h-screen bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <header className="rounded-[28px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 shadow-sm sm:p-6">
          <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
            <div className="flex items-start gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
                <ShieldCheck className="h-6 w-6" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">
                    Administração · financeiro
                  </p>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-emerald-700">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Ao vivo
                  </span>
                </div>
                <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
                  Painel Executivo de Afiliados & Receita
                </h1>
                <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--mi-text-muted)]">
                  Visão exclusiva do administrador com faturamento rastreado, comissões, rede, datas
                  de liberação e saques. Os dados ao vivo são relidos automaticamente a cada 30
                  segundos; o controle executivo é consolidado a cada 12 horas.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <Link to="/afiliados">
                  <ArrowLeft className="h-4 w-4" /> Wallet
                </Link>
              </Button>
              <Button variant="outline" onClick={exportReport}>
                <Download className="h-4 w-4" /> Relatório CSV
              </Button>
              <Button onClick={() => void overview.refetch()} disabled={overview.isFetching}>
                <RefreshCw className={`h-4 w-4 ${overview.isFetching ? "animate-spin" : ""}`} />
                Atualizar agora
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 border-t border-[var(--mi-border)] pt-5 md:grid-cols-3">
            <LiveInfo
              icon={Activity}
              label="Leitura ao vivo"
              value={dateTime(data.liveUpdatedAt)}
              detail="Atualização automática a cada 30s"
            />
            <LiveInfo
              icon={CalendarClock}
              label="Próximo controle 12h"
              value={dateTime(data.nextControlAt)}
              detail="Snapshot para conferência e acompanhamento"
            />
            <LiveInfo
              icon={Clock3}
              label="Fechamento de comissão 24h"
              value={dateTime(data.nextDailyCloseAt)}
              detail="Rotina diária de liberação das comissões elegíveis"
            />
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={Landmark}
            label="Faturamento rastreado"
            value={money(metrics.grossRevenue)}
            detail={`${metrics.paymentsCount} pagamento(s) confirmado(s)`}
          />
          <MetricCard
            icon={TrendingUp}
            label="Faturamento últimas 24h"
            value={money(metrics.revenue24h)}
            detail={`30 dias: ${money(metrics.revenue30d)}`}
          />
          <MetricCard
            icon={WalletCards}
            label="Comissões geradas"
            value={money(metrics.commissionTotal)}
            detail={`Disponível: ${money(metrics.commissionAvailable)}`}
          />
          <MetricCard
            icon={Users}
            label="Afiliados ativos"
            value={String(metrics.affiliateCount)}
            detail={`${metrics.activeSubscribers} assinante(s) ativo(s)`}
          />
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <CompactMetric label="Em validação" value={money(metrics.commissionPending)} />
          <CompactMetric label="Disponível para saque" value={money(metrics.commissionAvailable)} />
          <CompactMetric label="Comissões pagas" value={money(metrics.commissionPaid)} />
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.45fr_0.85fr]">
          <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.12em] text-blue-600">
                  Receita da plataforma
                </p>
                <h2 className="mt-1 text-xl font-black">Últimos 14 dias</h2>
              </div>
              <p className="text-xs text-[var(--mi-text-muted)]">
                Último pagamento: {dateTime(metrics.lastPaymentAt)}
              </p>
            </div>

            <div className="mt-6 flex h-60 items-end gap-2 overflow-x-auto rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-4">
              {data.revenueDaily.map((item) => {
                const height = Math.max(8, Math.round((item.grossRevenue / maxRevenue) * 100));
                return (
                  <div
                    key={item.day}
                    className="flex min-w-12 flex-1 flex-col items-center justify-end gap-2"
                    title={`${new Date(`${item.day}T12:00:00`).toLocaleDateString("pt-BR")}: ${money(item.grossRevenue)}`}
                  >
                    <span className="text-[9px] font-bold text-[var(--mi-text-soft)]">
                      {item.grossRevenue > 0 ? money(item.grossRevenue) : ""}
                    </span>
                    <div
                      className="w-full max-w-14 rounded-t-lg bg-blue-600 shadow-sm"
                      style={{ height: `${height}%` }}
                    />
                    <span className="text-[9px] font-bold text-[var(--mi-text-muted)]">
                      {new Date(`${item.day}T12:00:00`).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                      })}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/10 text-violet-700">
                <BarChart3 className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.12em] text-violet-700">
                  Controle 12h
                </p>
                <h2 className="font-black">Último snapshot</h2>
              </div>
            </div>

            {data.snapshot ? (
              <div className="mt-5 space-y-3">
                <SnapshotRow label="Atualizado em" value={dateTime(data.snapshot.snapshotAt)} />
                <SnapshotRow label="Faturamento" value={money(data.snapshot.grossRevenue)} />
                <SnapshotRow label="Receita 24h" value={money(data.snapshot.revenue24h)} />
                <SnapshotRow label="Receita 30d" value={money(data.snapshot.revenue30d)} />
                <SnapshotRow label="Comissões" value={money(data.snapshot.commissionTotal)} />
                <SnapshotRow label="Disponível" value={money(data.snapshot.commissionAvailable)} />
                <SnapshotRow label="Afiliados" value={String(data.snapshot.affiliateCount)} />
                <SnapshotRow
                  label="Assinantes ativos"
                  value={String(data.snapshot.activeSubscribers)}
                />
              </div>
            ) : (
              <p className="mt-5 text-sm text-[var(--mi-text-muted)]">
                O primeiro snapshot será gerado no próximo ciclo de controle.
              </p>
            )}
          </section>
        </div>

        <section className="overflow-hidden rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)]">
          <div className="flex flex-col justify-between gap-2 border-b border-[var(--mi-border)] p-5 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-xl font-black">Comissões por usuário</h2>
              <p className="mt-1 text-xs text-[var(--mi-text-muted)]">
                Visão administrativa completa. Esta tabela não é exposta para usuários comuns.
              </p>
            </div>
            <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-black text-blue-700">
              {data.users.length} afiliado(s)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1250px] text-left text-sm">
              <thead className="bg-[var(--mi-bg)] text-[10px] font-black uppercase tracking-[0.1em] text-[var(--mi-text-soft)]">
                <tr>
                  <th className="px-4 py-3">Usuário</th>
                  <th className="px-4 py-3">Código</th>
                  <th className="px-4 py-3">Diretos</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Validação</th>
                  <th className="px-4 py-3">Disponível</th>
                  <th className="px-4 py-3">Pago</th>
                  <th className="px-4 py-3">Último saque</th>
                  <th className="px-4 py-3">Próxima liberação</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((item) => (
                  <tr key={item.userId} className="border-t border-[var(--mi-border)]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full ${item.isActive ? "bg-emerald-500" : "bg-slate-300"}`}
                        />
                        <div>
                          <p className="font-black">{item.name}</p>
                          <p className="text-[10px] text-[var(--mi-text-soft)]">
                            {item.companyName || "Conta individual"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{item.referralCode}</td>
                    <td className="px-4 py-3">{item.directReferrals}</td>
                    <td className="px-4 py-3 font-black">{money(item.commissionTotal)}</td>
                    <td className="px-4 py-3">{money(item.commissionPending)}</td>
                    <td className="px-4 py-3 font-black text-emerald-700">
                      {money(item.commissionAvailable)}
                    </td>
                    <td className="px-4 py-3">{money(item.commissionPaid)}</td>
                    <td className="px-4 py-3 text-xs">{dateTime(item.lastPayoutAt)}</td>
                    <td className="px-4 py-3 text-xs">{dateTime(item.nextReleaseAt)}</td>
                  </tr>
                ))}
                {!data.users.length && (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-[var(--mi-text-muted)]">
                      Nenhum afiliado cadastrado ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)]">
          <div className="border-b border-[var(--mi-border)] p-5">
            <h2 className="text-xl font-black">Pagamentos recentes da plataforma</h2>
            <p className="mt-1 text-xs text-[var(--mi-text-muted)]">
              Base do faturamento rastreado utilizado no painel executivo.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="bg-[var(--mi-bg)] text-[10px] font-black uppercase tracking-[0.1em] text-[var(--mi-text-soft)]">
                <tr>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Usuário</th>
                  <th className="px-4 py-3">Pagamento</th>
                  <th className="px-4 py-3">Valor</th>
                </tr>
              </thead>
              <tbody>
                {data.recentPayments.map((item) => (
                  <tr key={item.id} className="border-t border-[var(--mi-border)]">
                    <td className="px-4 py-3 text-xs">{dateTime(item.paidAt)}</td>
                    <td className="px-4 py-3 font-bold">{item.userName}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--mi-text-muted)]">
                      {item.paymentId}
                    </td>
                    <td className="px-4 py-3 font-black">{money(item.grossAmount)}</td>
                  </tr>
                ))}
                {!data.recentPayments.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-[var(--mi-text-muted)]">
                      Nenhum pagamento rastreado ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[24px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
            {label}
          </p>
          <p className="mt-2 text-2xl font-black tracking-tight">{value}</p>
          <p className="mt-2 text-xs text-[var(--mi-text-muted)]">{detail}</p>
        </div>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-700">
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] px-5 py-4">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
        {label}
      </p>
      <p className="mt-1 text-xl font-black">{value}</p>
    </div>
  );
}

function LiveInfo({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-[var(--mi-bg)] p-4">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.1em] text-[var(--mi-text-soft)]">
          {label}
        </p>
        <p className="mt-1 text-sm font-black">{value}</p>
        <p className="mt-1 text-[10px] leading-4 text-[var(--mi-text-muted)]">{detail}</p>
      </div>
    </div>
  );
}

function SnapshotRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--mi-border)] pb-2 text-sm last:border-0">
      <span className="text-[var(--mi-text-muted)]">{label}</span>
      <strong className="text-right">{value}</strong>
    </div>
  );
}
