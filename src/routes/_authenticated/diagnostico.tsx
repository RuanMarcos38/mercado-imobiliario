import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bot, CheckCircle2, CircleAlert, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runCommunicationDiagnostics, type DiagnosticItem } from "@/lib/communications-diagnostics.functions";

export const Route = createFileRoute("/_authenticated/diagnostico")({
  component: DiagnosticsPage,
  head: () => ({ title: "Diagnóstico | MercadoImobi" }),
});

function DiagnosticsPage() {
  const diagnosticsFn = useServerFn(runCommunicationDiagnostics);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof runCommunicationDiagnostics>> | null>(null);

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
          <Button onClick={() => void run()} disabled={running} className="h-11 rounded-xl bg-blue-600 font-black text-white hover:bg-blue-700">
            <RefreshCw className={`mr-2 h-4 w-4 ${running ? "animate-spin" : ""}`} />
            {running ? "Executando testes..." : "Testar tudo agora"}
          </Button>
        </div>

        <section className="mt-6 rounded-[28px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 shadow-sm sm:p-6">
          {!result ? (
            <div className="grid min-h-[360px] place-items-center text-center">
              <div><Bot className="mx-auto h-12 w-12 text-[var(--mi-text-soft)]" /><h2 className="mt-3 text-lg font-black">Autoteste MercadoImobi</h2><p className="mt-1 max-w-lg text-sm leading-6 text-[var(--mi-text-soft)]">O teste valida banco/tenant, OpenAI, WhatsApp/Evolution, Meta, e-mail e telefonia. Serviços ainda sem credenciais aparecem como “não configurados”, sem derrubar o restante da plataforma.</p></div>
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
      </div>
    </div>
  );
}

function Summary({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-4"><div className="flex items-center gap-2 text-blue-600">{icon}<span className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">{label}</span></div><p className="mt-2 text-xl font-black">{value}</p></div>;
}

function DiagnosticCard({ item }: { item: DiagnosticItem }) {
  const state = !item.configured ? "not-configured" : item.ok ? "ok" : "error";
  return <div className={`rounded-2xl border p-4 ${state === "ok" ? "border-emerald-500/20 bg-emerald-500/[0.04]" : state === "error" ? "border-rose-500/20 bg-rose-500/[0.04]" : "border-amber-500/20 bg-amber-500/[0.04]"}`}><div className="flex items-start gap-3"><span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${state === "ok" ? "bg-emerald-500/10 text-emerald-700" : state === "error" ? "bg-rose-500/10 text-rose-700" : "bg-amber-500/10 text-amber-700"}`}>{state === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}</span><div><p className="font-black">{item.label}</p><p className="mt-1 text-xs leading-5 text-[var(--mi-text-muted)]">{item.detail}</p><span className="mt-2 inline-flex rounded-full bg-[var(--mi-bg)] px-2 py-1 text-[10px] font-black uppercase text-[var(--mi-text-soft)]">{!item.configured ? "Não configurado" : item.ok ? "Funcionando" : "Requer atenção"}</span></div></div></div>;
}
