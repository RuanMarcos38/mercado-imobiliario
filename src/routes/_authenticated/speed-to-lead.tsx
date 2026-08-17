import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  CheckCircle2,
  Clock3,
  Copy,
  Gauge,
  RefreshCw,
  Route as RouteIcon,
  Send,
  Users,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createSpeedToLeadTestLead,
  getLeadWebhookSetup,
  getSpeedToLeadSnapshot,
} from "@/lib/speed-to-lead.functions";

export const Route = createFileRoute("/_authenticated/speed-to-lead")({
  component: SpeedToLeadPage,
  head: () => ({ title: "Speed to Lead | MercadoImobi" }),
});

function SpeedToLeadPage() {
  const snapshotFn = useServerFn(getSpeedToLeadSnapshot);
  const webhookFn = useServerFn(getLeadWebhookSetup);
  const testFn = useServerFn(createSpeedToLeadTestLead);
  const snapshot = useQuery({
    queryKey: ["speed-to-lead-snapshot"],
    queryFn: () => snapshotFn(),
    refetchInterval: 60_000,
  });
  const webhooks = useQuery({ queryKey: ["lead-webhook-setup"], queryFn: () => webhookFn() });
  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState(false);
  const [lastTest, setLastTest] = useState<{
    assignedUserName?: string | null;
    leadId: string;
    conversationId?: string | null;
  } | null>(null);

  const createTest = async () => {
    setTesting(true);
    try {
      const result = await testFn({
        data: {
          name: "Lead Teste MercadoImobi",
          phone: testPhone.trim() || undefined,
        },
      });
      setLastTest(result);
      toast.success(
        result.assignedUserName
          ? `Lead distribuído para ${result.assignedUserName}.`
          : "Lead de teste criado e distribuído.",
      );
      await snapshot.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar o lead de teste.");
    } finally {
      setTesting(false);
    }
  };

  const copy = async (value: string | null | undefined, label: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copiado.`);
  };

  const data = snapshot.data;

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1600px]">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Performance comercial</p>
            <h1 className="mt-2 text-3xl font-black">Speed to Lead</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--mi-text-muted)]">
              Meça quanto tempo cada oportunidade leva para receber a primeira resposta no WhatsApp e distribua novos leads automaticamente entre usuários ativos da operação.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void snapshot.refetch()}
            className="rounded-xl border-[var(--mi-border)]"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${snapshot.isFetching ? "animate-spin" : ""}`} />
            Atualizar métricas
          </Button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={RouteIcon} label="Leads nos últimos 7 dias" value={String(data?.leads7d ?? "—")} detail={`${data?.leads30d ?? 0} nos últimos 30 dias`} />
          <MetricCard icon={Clock3} label="SLA médio de 1ª resposta" value={data?.averageLabel ?? "—"} detail={`Mediana: ${data?.medianLabel ?? "—"}`} />
          <MetricCard icon={Gauge} label="Dentro do SLA de 5 min" value={data?.withinSlaPct === null || data?.withinSlaPct === undefined ? "—" : `${data.withinSlaPct}%`} detail={`${data?.answered7d ?? 0} leads com resposta medida`} />
          <MetricCard icon={Activity} label="Aguardando 1ª resposta" value={String(data?.unanswered7d ?? "—")} detail="Leads sem mensagem de saída após a entrada" />
        </div>

        <div className="mt-6 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[24px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-blue-600" />
                  <h2 className="font-black">Roleta e performance da equipe</h2>
                </div>
                <p className="mt-1 text-xs leading-5 text-[var(--mi-text-muted)]">
                  A distribuição favorece usuários ativos com menor carga de leads nas últimas 24 horas. O quadro abaixo mede os últimos 7 dias.
                </p>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[650px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--mi-border)] text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
                    <th className="px-3 py-3">Usuário</th>
                    <th className="px-3 py-3">Leads</th>
                    <th className="px-3 py-3">Respondidos</th>
                    <th className="px-3 py-3">SLA médio</th>
                    <th className="px-3 py-3">Até 5 min</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.team ?? []).map((member) => (
                    <tr key={member.userId} className="border-b border-[var(--mi-border)] last:border-0">
                      <td className="px-3 py-3 font-bold">{member.name}</td>
                      <td className="px-3 py-3">{member.assigned}</td>
                      <td className="px-3 py-3">{member.answered}</td>
                      <td className="px-3 py-3 font-bold">{member.averageLabel}</td>
                      <td className="px-3 py-3">
                        {member.withinSlaPct === null ? (
                          <span className="text-[var(--mi-text-soft)]">—</span>
                        ) : (
                          <span className={member.withinSlaPct >= 80 ? "font-black text-emerald-600" : "font-black text-amber-600"}>
                            {member.withinSlaPct}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {(data?.team.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-10 text-center text-sm text-[var(--mi-text-soft)]">
                        Ainda não há leads suficientes para calcular a performance da equipe.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-[24px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Send className="h-5 w-5 text-blue-600" />
              <h2 className="font-black">Teste o fluxo em menos de 1 minuto</h2>
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--mi-text-muted)]">
              Gere um lead técnico para validar a roleta. Se informar um WhatsApp real, a conversa também será preparada no Atendimento, sem enviar mensagem automaticamente.
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Input
                value={testPhone}
                onChange={(event) => setTestPhone(event.target.value)}
                placeholder="WhatsApp com DDD (opcional)"
                className="h-11 rounded-xl"
              />
              <Button onClick={() => void createTest()} disabled={testing} className="h-11 shrink-0 rounded-xl font-black">
                {testing ? "Distribuindo..." : "Gerar lead de teste"}
              </Button>
            </div>
            {lastTest && (
              <div className="mt-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
                <p className="flex items-center gap-2 text-sm font-black text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> Fluxo executado
                </p>
                <p className="mt-2 text-xs leading-5 text-[var(--mi-text-muted)]">
                  Lead criado{lastTest.assignedUserName ? ` e distribuído para ${lastTest.assignedUserName}` : ""}.
                  {lastTest.conversationId ? " A conversa já está pronta no Atendimento." : ""}
                </p>
              </div>
            )}

            <div className="mt-6 border-t border-[var(--mi-border)] pt-5">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--mi-text-soft)]">Origem dos leads — 7 dias</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(data?.sources ?? []).map((source) => (
                  <span key={source.source} className="rounded-full border border-[var(--mi-border)] bg-[var(--mi-bg)] px-3 py-1.5 text-xs font-bold">
                    {source.source} <span className="text-blue-600">{source.count}</span>
                  </span>
                ))}
                {(data?.sources.length ?? 0) === 0 && <span className="text-xs text-[var(--mi-text-soft)]">Nenhuma origem registrada ainda.</span>}
              </div>
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-[24px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-600">
              <Webhook className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-black">Entrada automática de leads</h2>
              <p className="mt-1 max-w-4xl text-xs leading-5 text-[var(--mi-text-muted)]">
                Use os endpoints assinados abaixo nas integrações de Meta, Google, formulários, landing pages ou automações. O MercadoImobi normaliza telefone/e-mail, evita duplicidade por identificador externo e distribui o lead para um usuário ativo.
              </p>
            </div>
          </div>

          {!webhooks.data?.configured ? (
            <div className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4 text-sm text-amber-800">
              Configure <strong>LEAD_WEBHOOK_SECRET</strong> no servidor para liberar URLs de captação assinadas.
            </div>
          ) : (
            <div className="mt-5 grid gap-3 lg:grid-cols-2">
              <WebhookRow label="Meta Ads / automação" value={webhooks.data.meta} onCopy={copy} />
              <WebhookRow label="Google Lead Forms" value={webhooks.data.google} onCopy={copy} />
              <WebhookRow label="Landing Pages" value={webhooks.data.landingPage} onCopy={copy} />
              <WebhookRow label="Webhook genérico" value={webhooks.data.generic} onCopy={copy} />
            </div>
          )}

          <div className="mt-5 rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-4">
            <p className="text-xs font-black">Formato mínimo aceito</p>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[11px] leading-5 text-[var(--mi-text-muted)]">{`{
  "external_id": "lead-123",
  "name": "Maria Souza",
  "phone": "47999999999",
  "email": "maria@email.com",
  "campaign_name": "Apartamento Joinville",
  "property": "Residencial Exemplo"
}`}</pre>
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
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[22px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-black uppercase tracking-[0.13em] text-[var(--mi-text-soft)]">{label}</p>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-600"><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-4 text-3xl font-black tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-[var(--mi-text-muted)]">{detail}</p>
    </div>
  );
}

function WebhookRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string | null;
  onCopy: (value: string | null | undefined, label: string) => Promise<void>;
}) {
  return (
    <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">{label}</p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate text-[11px] text-[var(--mi-text-muted)]">{value}</code>
        <Button size="icon" variant="outline" onClick={() => void onCopy(value, label)} className="h-9 w-9 shrink-0 rounded-xl border-[var(--mi-border)]" title={`Copiar ${label}`}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
