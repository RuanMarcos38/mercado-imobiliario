import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  Bot,
  CheckCircle2,
  CircleAlert,
  Gauge,
  MessageCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  askBackendAuditAssistant,
  runBackendAudit,
  type BackendAuditCheck,
  type BackendAuditResult,
} from "@/lib/backend-auditor.functions";
import {
  runCommunicationDiagnostics,
  type DiagnosticItem,
} from "@/lib/communications-diagnostics.functions";

export const Route = createFileRoute("/_authenticated/diagnostico")({
  component: DiagnosticsPage,
  head: () => ({ title: "Diagnóstico | MercadoImobi" }),
});

type AuditChatMessage = { role: "assistant" | "user"; text: string };

function DiagnosticsPage() {
  const { roles } = Route.useRouteContext();
  const isAdmin = roles.includes("admin");
  const diagnosticsFn = useServerFn(runCommunicationDiagnostics);
  const backendAuditFn = useServerFn(runBackendAudit);
  const auditChatFn = useServerFn(askBackendAuditAssistant);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof runCommunicationDiagnostics>> | null>(null);
  const [auditRunning, setAuditRunning] = useState(false);
  const [auditResult, setAuditResult] = useState<BackendAuditResult | null>(null);
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatRunning, setChatRunning] = useState(false);
  const [chat, setChat] = useState<AuditChatMessage[]>([]);

  const run = async () => {
    setRunning(true);
    try {
      const response = await diagnosticsFn();
      setResult(response);
      if (response.healthy) toast.success("Todos os serviços configurados responderam corretamente.");
      else toast.info("Diagnóstico concluído. Veja os itens que precisam de configuração ou correção.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "O diagnóstico não foi concluído.");
    } finally {
      setRunning(false);
    }
  };

  const runBackend = async () => {
    setAuditRunning(true);
    setChat([]);
    try {
      const response = await backendAuditFn();
      setAuditResult(response);
      setChat([{ role: "assistant", text: response.assistantReport }]);
      if (response.backend100) {
        toast.success("Backend aprovado em 100% das verificações deste ciclo.");
      } else if (response.productionReady) {
        toast.info("Backend principal saudável. Existem integrações opcionais pendentes ou não verificadas.");
      } else {
        toast.error("A auditoria encontrou falhas que precisam de correção.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "A auditoria do backend não foi concluída.";
      toast.error(message.includes("FORBIDDEN_ADMIN") ? "Auditoria completa disponível somente para administrador." : message);
    } finally {
      setAuditRunning(false);
    }
  };

  const askAuditor = async () => {
    const question = chatQuestion.trim();
    if (!question || !auditResult || chatRunning) return;
    setChatQuestion("");
    setChat((current) => [...current, { role: "user", text: question }]);
    setChatRunning(true);
    try {
      const response = await auditChatFn({
        data: {
          question,
          checkedAt: auditResult.checkedAt,
          checks: auditResult.checks,
        },
      });
      setChat((current) => [...current, { role: "assistant", text: response.text }]);
    } catch (error) {
      setChat((current) => [
        ...current,
        {
          role: "assistant",
          text: error instanceof Error ? error.message : "Não consegui analisar o relatório agora.",
        },
      ]);
    } finally {
      setChatRunning(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1200px]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Qualidade e operação</p>
            <h1 className="mt-2 text-3xl font-black">Diagnóstico da plataforma</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--mi-text-muted)]">
              Execute testes sintéticos do chatbot e verificações reais de autenticação/conectividade das integrações sem enviar mensagens para clientes.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/speed-to-lead">
              <Button variant="outline" className="h-11 rounded-xl border-[var(--mi-border)] font-black">
                <Gauge className="mr-2 h-4 w-4" /> Speed to Lead
              </Button>
            </Link>
            <Button onClick={() => void run()} disabled={running} className="h-11 rounded-xl bg-blue-600 font-black text-white hover:bg-blue-700">
              <RefreshCw className={`mr-2 h-4 w-4 ${running ? "animate-spin" : ""}`} />
              {running ? "Executando testes..." : "Testar tudo agora"}
            </Button>
            {isAdmin && (
              <Button
                onClick={() => void runBackend()}
                disabled={auditRunning}
                className="h-11 rounded-xl bg-slate-950 font-black text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
              >
                <ShieldCheck className={`mr-2 h-4 w-4 ${auditRunning ? "animate-pulse" : ""}`} />
                {auditRunning ? "Auditando backend..." : "Auditar backend completo"}
              </Button>
            )}
          </div>
        </div>

        <section className="mt-6 rounded-[28px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 shadow-sm sm:p-6">
          {!result ? (
            <div className="grid min-h-[300px] place-items-center text-center">
              <div>
                <Bot className="mx-auto h-12 w-12 text-[var(--mi-text-soft)]" />
                <h2 className="mt-3 text-lg font-black">Autoteste MercadoImobi</h2>
                <p className="mt-1 max-w-lg text-sm leading-6 text-[var(--mi-text-soft)]">
                  O teste valida banco/tenant, OpenAI, WhatsApp/Evolution, Meta, e-mail e telefonia. Serviços ainda sem credenciais aparecem como “não configurados”, sem derrubar o restante da plataforma.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Summary label="Configurados" value={`${result.configuredCount}`} icon={<Wrench className="h-5 w-5" />} />
                <Summary label="Aprovados" value={`${result.okCount}`} icon={<CheckCircle2 className="h-5 w-5" />} />
                <Summary label="Situação" value={result.healthy ? "Saudável" : "Atenção"} icon={<ShieldCheck className="h-5 w-5" />} />
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {result.items.map((item) => <DiagnosticCard key={item.key} item={item} />)}
              </div>
              <p className="mt-5 text-xs text-[var(--mi-text-soft)]">Última execução: {new Date(result.checkedAt).toLocaleString("pt-BR")}</p>
            </>
          )}
        </section>

        {isAdmin && (
          <section className="mt-6 rounded-[28px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-blue-600" />
                  <h2 className="font-black">Auditor IA do Backend</h2>
                </div>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--mi-text-muted)]">
                  Auditoria somente leitura: valida autenticação, tenant, tabelas críticas, índice de imóveis, storage, Speed to Lead e integrações externas reais. O teste não envia WhatsApp, e-mail, ligação, cobrança ou documentação para clientes.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => void runBackend()}
                disabled={auditRunning}
                className="h-10 shrink-0 rounded-xl border-[var(--mi-border)] font-black"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${auditRunning ? "animate-spin" : ""}`} />
                Rodar novamente
              </Button>
            </div>

            {!auditResult ? (
              <div className="mt-5 rounded-2xl border border-dashed border-[var(--mi-border)] bg-[var(--mi-bg)] p-8 text-center">
                <Activity className="mx-auto h-9 w-9 text-[var(--mi-text-soft)]" />
                <p className="mt-3 text-sm font-black">Aguardando auditoria completa</p>
                <p className="mt-1 text-xs text-[var(--mi-text-soft)]">Clique em “Auditar backend completo”. O sistema só exibirá 100% quando todas as verificações deste ciclo estiverem aprovadas.</p>
              </div>
            ) : (
              <>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <Summary label="Verificação" value={`${auditResult.verificationPercent}%`} icon={<Gauge className="h-5 w-5" />} />
                  <Summary label="Aprovados" value={`${auditResult.passed}`} icon={<CheckCircle2 className="h-5 w-5" />} />
                  <Summary label="Falhas" value={`${auditResult.failed}`} icon={<CircleAlert className="h-5 w-5" />} />
                  <Summary label="Pendentes" value={`${auditResult.warnings + auditResult.notConfigured}`} icon={<Wrench className="h-5 w-5" />} />
                  <Summary label="Backend 100%" value={auditResult.backend100 ? "SIM" : "NÃO"} icon={<ShieldCheck className="h-5 w-5" />} />
                </div>

                <div className={`mt-4 rounded-2xl border p-4 ${auditResult.backend100 ? "border-emerald-500/20 bg-emerald-500/[0.05]" : auditResult.productionReady ? "border-amber-500/20 bg-amber-500/[0.05]" : "border-rose-500/20 bg-rose-500/[0.05]"}`}>
                  <p className="text-sm font-black">
                    {auditResult.backend100
                      ? "Todas as verificações deste ciclo foram aprovadas."
                      : auditResult.productionReady
                        ? "Núcleo do backend aprovado; ainda existem integrações opcionais pendentes ou parcialmente verificadas."
                        : "Existem falhas no backend ou em integrações configuradas que exigem correção."}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--mi-text-muted)]">{auditResult.assistantReport}</p>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {auditResult.checks.map((item) => <BackendAuditCard key={item.key} item={item} />)}
                </div>
                <p className="mt-5 text-xs text-[var(--mi-text-soft)]">
                  Auditoria executada em {(auditResult.durationMs / 1000).toFixed(1)}s · {new Date(auditResult.checkedAt).toLocaleString("pt-BR")}.
                </p>

                <div className="mt-6 border-t border-[var(--mi-border)] pt-5">
                  <div className="flex items-center gap-2">
                    <MessageCircle className="h-5 w-5 text-blue-600" />
                    <h3 className="font-black">Chatbot Auditor</h3>
                  </div>
                  <p className="mt-1 text-xs text-[var(--mi-text-muted)]">
                    Pergunte sobre falhas, prioridades ou o que falta para chegar a 100%. O chatbot responde somente com base nos testes acima.
                  </p>
                  <div className="mt-4 max-h-[320px] space-y-3 overflow-y-auto rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-4">
                    {chat.map((message, index) => (
                      <div key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "bg-blue-600 text-white" : "border border-[var(--mi-border)] bg-[var(--mi-surface)]"}`}>
                          {message.text}
                        </div>
                      </div>
                    ))}
                    {chatRunning && <div className="text-xs font-bold text-[var(--mi-text-soft)]">Auditor analisando o relatório...</div>}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <input
                      value={chatQuestion}
                      onChange={(event) => setChatQuestion(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void askAuditor();
                        }
                      }}
                      placeholder="Ex.: O que falta corrigir para ficar 100%?"
                      className="h-11 min-w-0 flex-1 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-bg)] px-4 text-sm outline-none focus:border-blue-500"
                    />
                    <Button
                      onClick={() => void askAuditor()}
                      disabled={!chatQuestion.trim() || chatRunning}
                      className="h-11 rounded-xl bg-blue-600 px-4 text-white hover:bg-blue-700"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function Summary({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-4">
      <div className="flex items-center gap-2 text-blue-600">
        {icon}
        <span className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">{label}</span>
      </div>
      <p className="mt-2 text-xl font-black">{value}</p>
    </div>
  );
}

function DiagnosticCard({ item }: { item: DiagnosticItem }) {
  const state = !item.configured ? "not-configured" : item.ok ? "ok" : "error";
  return (
    <div className={`rounded-2xl border p-4 ${state === "ok" ? "border-emerald-500/20 bg-emerald-500/[0.04]" : state === "error" ? "border-rose-500/20 bg-rose-500/[0.04]" : "border-amber-500/20 bg-amber-500/[0.04]"}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${state === "ok" ? "bg-emerald-500/10 text-emerald-700" : state === "error" ? "bg-rose-500/10 text-rose-700" : "bg-amber-500/10 text-amber-700"}`}>
          {state === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
        </span>
        <div>
          <p className="font-black">{item.label}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--mi-text-muted)]">{item.detail}</p>
          <span className="mt-2 inline-flex rounded-full bg-[var(--mi-bg)] px-2 py-1 text-[10px] font-black uppercase text-[var(--mi-text-soft)]">
            {!item.configured ? "Não configurado" : item.ok ? "Funcionando" : "Requer atenção"}
          </span>
        </div>
      </div>
    </div>
  );
}

function BackendAuditCard({ item }: { item: BackendAuditCheck }) {
  const tone =
    item.status === "pass"
      ? "border-emerald-500/20 bg-emerald-500/[0.04]"
      : item.status === "fail"
        ? "border-rose-500/20 bg-rose-500/[0.04]"
        : "border-amber-500/20 bg-amber-500/[0.04]";
  const label =
    item.status === "pass"
      ? "Aprovado"
      : item.status === "fail"
        ? "Falhou"
        : item.status === "warn"
          ? "Parcial"
          : "Não configurado";
  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${item.status === "pass" ? "bg-emerald-500/10 text-emerald-700" : item.status === "fail" ? "bg-rose-500/10 text-rose-700" : "bg-amber-500/10 text-amber-700"}`}>
          {item.status === "pass" ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-black">{item.label}</p>
            {item.critical && <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[9px] font-black uppercase text-rose-700">Crítico</span>}
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--mi-text-muted)]">{item.detail}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase text-[var(--mi-text-soft)]">
            <span className="rounded-full bg-[var(--mi-bg)] px-2 py-1">{label}</span>
            <span>{item.category}</span>
            <span>{item.durationMs} ms</span>
          </div>
        </div>
      </div>
    </div>
  );
}
