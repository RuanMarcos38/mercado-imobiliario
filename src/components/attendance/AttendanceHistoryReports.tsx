import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Archive, Clock3, MessageCircle, RefreshCw, Star, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getAttendanceHistoryReport,
  type AttendanceHistoryReport,
} from "@/lib/attendance-history.functions";

type Props = {
  startIso: string;
  onOpenConversation: (conversationId: string) => void;
};

function duration(totalSeconds: number | null | undefined) {
  if (totalSeconds === null || totalSeconds === undefined) return "—";
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}min` : `${hours}h`;
}

function ratingLabel(rating: number | null) {
  if (!rating) return "Aguardando nota";
  return `${rating}/5`;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-4">
      <p className="text-[9px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
        {label}
      </p>
      <p className="mt-2 text-xl font-black tracking-tight">{value}</p>
      <p className="mt-1 text-[10px] leading-4 text-[var(--mi-text-soft)]">{detail}</p>
    </div>
  );
}

function RatingDistribution({ report }: { report: AttendanceHistoryReport }) {
  const total = Math.max(1, report.surveyResponses);
  return (
    <section className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-4">
      <div className="flex items-center gap-2">
        <Star className="h-4 w-4 text-amber-500" />
        <p className="text-sm font-black">Distribuição das notas</p>
      </div>
      <div className="mt-4 space-y-3">
        {([5, 4, 3, 2, 1] as const).map((rating) => {
          const count = report.distribution[rating];
          const width = report.surveyResponses ? Math.round((count / total) * 100) : 0;
          return (
            <div key={rating}>
              <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-bold">
                <span>
                  {rating} estrela{rating === 1 ? "" : "s"}
                </span>
                <span className="text-[var(--mi-text-soft)]">{count}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--mi-border)]/60">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all"
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function AttendanceHistoryReports({ startIso, onOpenConversation }: Props) {
  const reportFn = useServerFn(getAttendanceHistoryReport);
  const report = useQuery({
    queryKey: ["attendance-history-report", startIso],
    queryFn: () => reportFn({ data: { startIso } }),
    refetchInterval: 30_000,
  });
  const data = report.data;

  return (
    <section className="mt-7 border-t border-[var(--mi-border)] pt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-black">Relatórios e histórico de atendimentos</h3>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--mi-text-soft)]">
            Consulte atendimentos encerrados, desempenho da equipe e avaliações recebidas sem apagar
            ou substituir o histórico das conversas.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void report.refetch()}
          disabled={report.isFetching}
          className="h-9 self-start rounded-xl"
        >
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${report.isFetching ? "animate-spin" : ""}`} />
          Atualizar relatório
        </Button>
      </div>

      {report.isLoading && !data ? (
        <div className="mt-5 grid min-h-36 place-items-center rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] text-sm text-[var(--mi-text-soft)]">
          Carregando histórico de atendimento...
        </div>
      ) : report.isError ? (
        <div className="mt-5 rounded-2xl border border-rose-300/40 bg-rose-500/[0.05] p-4 text-sm text-rose-700 dark:text-rose-300">
          Não foi possível carregar o relatório agora. O atendimento continua funcionando
          normalmente.
        </div>
      ) : data ? (
        <div className="mt-5 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric
              label="Encerrados"
              value={String(data.totalClosed)}
              detail="sessões finalizadas no período"
            />
            <Metric
              label="Nota média"
              value={data.averageRating === null ? "—" : `${data.averageRating.toFixed(2)}/5`}
              detail={`${data.surveyResponses} pesquisa(s) respondida(s)`}
            />
            <Metric
              label="Taxa de resposta"
              value={`${data.surveyResponseRatePct}%`}
              detail={`${data.surveysSent} pesquisa(s) enviada(s)`}
            />
            <Metric
              label="1ª resposta"
              value={duration(data.avgFirstResponseSeconds)}
              detail="tempo médio até a primeira resposta"
            />
            <Metric
              label="Tempo de atendimento"
              value={duration(data.avgAttendanceSeconds)}
              detail="duração média dos atendimentos encerrados"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[.72fr_1.28fr]">
            <RatingDistribution report={data} />

            <section className="overflow-hidden rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)]">
              <div className="flex items-center gap-2 border-b border-[var(--mi-border)] px-4 py-3">
                <Users className="h-4 w-4 text-indigo-600" />
                <div>
                  <p className="text-sm font-black">Desempenho por atendente</p>
                  <p className="text-[10px] text-[var(--mi-text-soft)]">
                    Encerramentos, avaliação e tempo médio por usuário.
                  </p>
                </div>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                <div className="hidden grid-cols-[1.3fr_80px_100px_110px] gap-3 bg-[var(--mi-surface-soft)] px-4 py-2.5 text-[9px] font-black uppercase tracking-[0.08em] text-[var(--mi-text-soft)] md:grid">
                  <span>Atendente</span>
                  <span>Encerrados</span>
                  <span>Nota média</span>
                  <span>Tempo médio</span>
                </div>
                {data.byAgent.map((agent) => (
                  <div
                    key={agent.userId}
                    className="grid gap-2 border-t border-[var(--mi-border)] px-4 py-3 text-xs md:grid-cols-[1.3fr_80px_100px_110px] md:items-center"
                  >
                    <span className="font-black">{agent.name}</span>
                    <span>{agent.closed}</span>
                    <span>
                      {agent.averageRating === null ? "—" : `${agent.averageRating.toFixed(2)}/5`}
                    </span>
                    <span>{duration(agent.avgAttendanceSeconds)}</span>
                  </div>
                ))}
                {!data.byAgent.length && (
                  <div className="px-4 py-10 text-center text-xs text-[var(--mi-text-soft)]">
                    Nenhum atendimento humano encerrado neste período.
                  </div>
                )}
              </div>
            </section>
          </div>

          <section className="overflow-hidden rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)]">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--mi-border)] px-4 py-3">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-blue-600" />
                <div>
                  <p className="text-sm font-black">Conversas encerradas</p>
                  <p className="text-[10px] text-[var(--mi-text-soft)]">
                    Histórico preservado por protocolo e sessão de atendimento.
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-[var(--mi-surface-soft)] px-2.5 py-1 text-[10px] font-black">
                {data.totalClosed} no período
              </span>
            </div>

            <div className="max-h-[460px] overflow-y-auto">
              {data.closedConversations.map((item) => (
                <div
                  key={item.sessionId}
                  className="grid gap-3 border-t border-[var(--mi-border)] px-4 py-3 lg:grid-cols-[1.35fr_1fr_150px_110px_120px] lg:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-black">{item.contactName}</p>
                    <p className="mt-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-blue-600">
                      Protocolo {item.protocolCode || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold">{item.attendantName}</p>
                    <p className="mt-0.5 text-[9px] text-[var(--mi-text-soft)]">
                      {new Date(item.closedAt).toLocaleString("pt-BR")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] font-bold">
                    <Clock3 className="h-3.5 w-3.5 text-[var(--mi-text-soft)]" />
                    {duration(item.attendanceSeconds)}
                  </div>
                  <span
                    className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-1 text-[9px] font-black ${item.rating ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-[var(--mi-surface-soft)] text-[var(--mi-text-soft)]"}`}
                  >
                    <Star className="h-3 w-3" /> {ratingLabel(item.rating)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenConversation(item.conversationId)}
                    className="h-8 rounded-lg text-[10px] font-black"
                  >
                    Abrir histórico
                  </Button>
                </div>
              ))}
              {!data.closedConversations.length && (
                <div className="px-5 py-12 text-center text-xs text-[var(--mi-text-soft)]">
                  Nenhuma conversa encerrada no período selecionado.
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
