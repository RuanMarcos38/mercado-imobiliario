import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BarChart3,
  CheckCheck,
  CircleAlert,
  Clock3,
  MessageCircle,
  ShieldCheck,
  Timer,
  TrendingUp,
  Users,
} from "lucide-react";
import { AttendanceHistoryReports } from "@/components/attendance/AttendanceHistoryReports";
import {
  getAttendanceIntelligence,
  type AttendanceOperationalState,
  type CriticalAttendanceConversation,
} from "@/lib/attendance-intelligence.functions";

type Props = {
  startIso: string;
  onOpenConversation: (conversationId: string, state: AttendanceOperationalState) => void;
};

function duration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds || 0));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}min` : `${hours}h`;
}

function toneClasses(tone: "neutral" | "good" | "warn" | "danger" | "info") {
  if (tone === "good")
    return "border-emerald-300/40 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300";
  if (tone === "warn")
    return "border-amber-300/40 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300";
  if (tone === "danger")
    return "border-rose-300/40 bg-rose-500/[0.06] text-rose-700 dark:text-rose-300";
  if (tone === "info")
    return "border-blue-300/40 bg-blue-500/[0.06] text-blue-700 dark:text-blue-300";
  return "border-[var(--mi-border)] bg-[var(--mi-surface-soft)] text-[var(--mi-text)]";
}

function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "good" | "warn" | "danger" | "info";
}) {
  return (
    <div className={`rounded-2xl border p-4 ${toneClasses(tone)}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.13em] opacity-75">{label}</p>
      <p className="mt-2 text-2xl font-black tracking-tight">{value}</p>
      <p className="mt-1 text-[10px] leading-4 opacity-75">{detail}</p>
    </div>
  );
}

function AgingBar({ label, count, total }: { label: string; count: number; total: number }) {
  const width = total > 0 ? Math.max(4, Math.round((count / total) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-bold">
        <span className="text-[var(--mi-text-muted)]">{label}</span>
        <span>{count}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--mi-border)]/60">
        <div
          className="h-full rounded-full bg-blue-600 transition-all"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function urgencyClasses(urgency: CriticalAttendanceConversation["urgency"]) {
  if (urgency === "breached") return "bg-rose-500/10 text-rose-700 dark:text-rose-300";
  if (urgency === "risk") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
}

function urgencyLabel(urgency: CriticalAttendanceConversation["urgency"]) {
  if (urgency === "breached") return "SLA ESTOURADO";
  if (urgency === "risk") return "SLA EM RISCO";
  return "SEM RESPOSTA";
}

export function AttendanceDecisionDashboard({ startIso, onOpenConversation }: Props) {
  const intelligenceFn = useServerFn(getAttendanceIntelligence);
  const intelligence = useQuery({
    queryKey: ["attendance-intelligence", startIso],
    queryFn: () => intelligenceFn({ data: { startIso } }),
    refetchInterval: 15_000,
  });
  const data = intelligence.data;
  const agingTotal = data
    ? data.aging.under5m + data.aging.from5to15m + data.aging.from15to30m + data.aging.over30m
    : 0;

  return (
    <div className="mb-7 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-black">Cockpit de decisão do atendimento</h3>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--mi-text-soft)]">
            Indicadores operacionais para priorizar conversas, reduzir perda de lead e acompanhar
            SLA sem sair da Central.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 self-start rounded-full border border-emerald-300/30 bg-emerald-500/[0.06] px-3 py-1 text-[10px] font-black text-emerald-700 dark:text-emerald-300">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Atualização a cada
          15s
        </span>
      </div>

      {intelligence.isLoading && !data ? (
        <div className="grid min-h-40 place-items-center rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] text-sm text-[var(--mi-text-soft)]">
          Calculando indicadores do atendimento...
        </div>
      ) : intelligence.isError ? (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-300/40 bg-rose-500/[0.06] p-4 text-sm text-rose-700 dark:text-rose-300">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          Não foi possível calcular o cockpit agora. O atendimento continua funcionando normalmente.
        </div>
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              label="Atendimentos"
              value={String(data.totalAttendances)}
              detail="conversas com atividade no período"
              tone="info"
            />
            <MetricCard
              label="Sem resposta"
              value={String(data.unansweredNow)}
              detail="cliente foi o último a falar"
              tone={data.unansweredNow > 0 ? "warn" : "good"}
            />
            <MetricCard
              label="SLA estourado"
              value={String(data.slaBreachedNow)}
              detail="exigem prioridade imediata"
              tone={data.slaBreachedNow > 0 ? "danger" : "good"}
            />
            <MetricCard
              label="SLA em risco"
              value={String(data.slaAtRiskNow)}
              detail={`acima de ${data.sla.riskThresholdPct}% da meta`}
              tone={data.slaAtRiskNow > 0 ? "warn" : "good"}
            />
            <MetricCard
              label="Saúde operacional"
              value={`${data.healthScore}/100`}
              detail={data.healthLabel}
              tone={data.healthScore >= 85 ? "good" : data.healthScore >= 65 ? "warn" : "danger"}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.35fr_.9fr]">
            <section className="overflow-hidden rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)]">
              <div className="flex items-start justify-between gap-3 border-b border-[var(--mi-border)] px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <CircleAlert className="h-4 w-4 text-rose-600" />
                    <p className="text-sm font-black">Radar de prioridade</p>
                  </div>
                  <p className="mt-1 text-[10px] text-[var(--mi-text-soft)]">
                    Ordenado automaticamente por estouro de SLA, risco e ausência de resposta.
                  </p>
                </div>
                <span className="rounded-full bg-[var(--mi-surface-soft)] px-2.5 py-1 text-[10px] font-black">
                  {data.criticalConversations.length} em atenção
                </span>
              </div>

              <div className="max-h-[360px] overflow-y-auto">
                {data.criticalConversations.map((conversation) => (
                  <button
                    type="button"
                    key={conversation.conversationId}
                    onClick={() =>
                      onOpenConversation(conversation.conversationId, conversation.state)
                    }
                    className="grid w-full gap-3 border-b border-[var(--mi-border)] px-4 py-3 text-left transition hover:bg-[var(--mi-surface-soft)] sm:grid-cols-[1fr_170px_90px] sm:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-xs font-black">{conversation.contactLabel}</p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[8px] font-black ${urgencyClasses(conversation.urgency)}`}
                        >
                          {urgencyLabel(conversation.urgency)}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[10px] text-[var(--mi-text-soft)]">
                        {conversation.phoneMasked} · {conversation.reason}
                      </p>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between text-[9px] font-bold text-[var(--mi-text-soft)]">
                        <span>Consumo do SLA</span>
                        <span>{conversation.slaPct}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--mi-border)]/70">
                        <div
                          className={`h-full rounded-full ${conversation.urgency === "breached" ? "bg-rose-500" : conversation.urgency === "risk" ? "bg-amber-500" : "bg-blue-500"}`}
                          style={{ width: `${Math.min(100, conversation.slaPct)}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 sm:block sm:text-right">
                      <span className="text-[10px] text-[var(--mi-text-soft)] sm:hidden">
                        Aguardando
                      </span>
                      <p className="text-xs font-black">{duration(conversation.ageSeconds)}</p>
                      <p className="mt-0.5 text-[9px] font-bold text-blue-600">Abrir conversa</p>
                    </div>
                  </button>
                ))}
                {!data.criticalConversations.length && (
                  <div className="grid min-h-48 place-items-center p-6 text-center">
                    <div>
                      <ShieldCheck className="mx-auto h-8 w-8 text-emerald-600" />
                      <p className="mt-2 text-sm font-black">Nenhuma prioridade crítica</p>
                      <p className="mt-1 text-xs text-[var(--mi-text-soft)]">
                        Não há conversa em risco ou com SLA estourado neste momento.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <div className="space-y-4">
              <section className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                      <p className="text-sm font-black">Governança de SLA</p>
                    </div>
                    <p className="mt-1 text-[10px] text-[var(--mi-text-soft)]">
                      Meta atual: até {duration(data.sla.waitingTargetSeconds)} para fila e{" "}
                      {duration(data.sla.firstResponseTargetSeconds)} para 1ª resposta.
                    </p>
                  </div>
                  <span className="text-xl font-black">
                    {data.slaMeasured > 0 ? `${data.slaCompliancePct}%` : "—"}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.1em] text-[var(--mi-text-soft)]">
                      Taxa de resposta
                    </p>
                    <p className="mt-1 text-lg font-black">{data.answerRatePct}%</p>
                  </div>
                  <div className="rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-3">
                    <p className="text-[9px] font-black uppercase tracking-[0.1em] text-[var(--mi-text-soft)]">
                      Backlog atual
                    </p>
                    <p className="mt-1 text-lg font-black">{data.backlogNow}</p>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-4">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-blue-600" />
                  <p className="text-sm font-black">Aging das pendências</p>
                </div>
                <div className="mt-4 space-y-3">
                  <AgingBar label="até 5 min" count={data.aging.under5m} total={agingTotal} />
                  <AgingBar label="5 a 15 min" count={data.aging.from5to15m} total={agingTotal} />
                  <AgingBar label="15 a 30 min" count={data.aging.from15to30m} total={agingTotal} />
                  <AgingBar label="acima de 30 min" count={data.aging.over30m} total={agingTotal} />
                </div>
              </section>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-4">
              <MessageCircle className="h-4 w-4 text-blue-600" />
              <p className="mt-3 text-lg font-black">{data.inboundMessages}</p>
              <p className="text-[10px] text-[var(--mi-text-soft)]">mensagens recebidas</p>
            </div>
            <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-4">
              <CheckCheck className="h-4 w-4 text-emerald-600" />
              <p className="mt-3 text-lg font-black">{data.outboundMessages}</p>
              <p className="text-[10px] text-[var(--mi-text-soft)]">mensagens enviadas</p>
            </div>
            <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-4">
              <Users className="h-4 w-4 text-indigo-600" />
              <p className="mt-3 text-lg font-black">{data.current.inService}</p>
              <p className="text-[10px] text-[var(--mi-text-soft)]">em atendimento humano</p>
            </div>
            <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-4">
              <Timer className="h-4 w-4 text-amber-600" />
              <p className="mt-3 text-lg font-black">{duration(data.oldestPendingSeconds)}</p>
              <p className="text-[10px] text-[var(--mi-text-soft)]">pendência mais antiga</p>
            </div>
            <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-4">
              <BarChart3 className="h-4 w-4 text-violet-600" />
              <p className="mt-3 text-lg font-black">{data.peakInboundHour ?? "—"}</p>
              <p className="text-[10px] text-[var(--mi-text-soft)]">pico de entrada</p>
            </div>
          </div>

          <section className="rounded-2xl border border-blue-300/30 bg-blue-500/[0.04] p-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-600" />
              <p className="text-sm font-black">Leitura executiva automática</p>
            </div>
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              {data.insights.map((insight) => (
                <div
                  key={insight}
                  className="flex items-start gap-2 rounded-xl bg-[var(--mi-surface)] px-3 py-2.5 text-xs leading-5"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
                  {insight}
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}

      <AttendanceHistoryReports
        startIso={startIso}
        onOpenConversation={(conversationId) => onOpenConversation(conversationId, "automatic")}
      />
    </div>
  );
}
