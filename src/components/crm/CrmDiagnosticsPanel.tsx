import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, CheckCircle2, CircleAlert, RefreshCw, SearchCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { testAiAssistant } from "@/lib/ai-assistant.functions";
import { runCrmPlatformDiagnostic } from "@/lib/crm-operations.functions";

export function CrmDiagnosticsPanel() {
  const diagnosticFn = useServerFn(runCrmPlatformDiagnostic);
  const chatbotFn = useServerFn(testAiAssistant);
  const [message, setMessage] = useState(
    "Olá, estou procurando um apartamento de 2 quartos em Joinville. Como você pode me ajudar?",
  );
  const [answer, setAnswer] = useState("");
  const [testing, setTesting] = useState(false);
  const diagnostic = useQuery({
    queryKey: ["crm-platform-diagnostic"],
    queryFn: () => diagnosticFn(),
  });

  const testChatbot = async () => {
    setTesting(true);
    try {
      const result = await chatbotFn({ data: { message } });
      setAnswer(result.text);
      toast.success(`Chatbot respondeu usando ${result.model}.`);
    } catch (error) {
      setAnswer("");
      toast.error(error instanceof Error ? error.message : "O chatbot não respondeu ao teste.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">
            Diagnóstico operacional
          </p>
          <h1 className="mt-2 text-3xl font-black">CRM, atendimento e chatbot</h1>
          <p className="mt-2 max-w-4xl text-sm text-[var(--mi-text-muted)]">
            Validação do fluxo WhatsApp → contato → oportunidade, distribuição automática, IA,
            e-mail e módulos comerciais.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void diagnostic.refetch()}
          disabled={diagnostic.isFetching}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${diagnostic.isFetching ? "animate-spin" : ""}`} />{" "}
          Atualizar diagnóstico
        </Button>
      </header>

      {diagnostic.isLoading ? (
        <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-8 text-sm text-[var(--mi-text-soft)]">
          Executando diagnóstico...
        </div>
      ) : diagnostic.error || !diagnostic.data ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
          Falha ao executar o diagnóstico. {String((diagnostic.error as Error)?.message ?? "")}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Conversas" value={String(diagnostic.data.summary.conversations)} />
            <Metric label="Oportunidades" value={String(diagnostic.data.summary.opportunities)} />
            <Metric label="Contatos CRM" value={String(diagnostic.data.summary.contacts)} />
          </div>
          <section className="overflow-hidden rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)]">
            {diagnostic.data.checks.map((check) => {
              const Icon =
                check.status === "ok"
                  ? CheckCircle2
                  : check.status === "warn"
                    ? CircleAlert
                    : XCircle;
              const tone =
                check.status === "ok"
                  ? "text-emerald-600"
                  : check.status === "warn"
                    ? "text-amber-600"
                    : "text-rose-600";
              return (
                <div
                  key={check.key}
                  className="flex items-start gap-3 border-b border-[var(--mi-border)] p-4 last:border-0"
                >
                  <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${tone}`} />
                  <div>
                    <p className="font-black">{check.label}</p>
                    <p className="mt-1 text-sm text-[var(--mi-text-muted)]">{check.detail}</p>
                  </div>
                </div>
              );
            })}
          </section>
        </>
      )}

      <section className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
        <div className="mb-4 flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-500/10 text-blue-600">
            <Bot className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-black">Teste real do chatbot</h2>
            <p className="mt-1 text-xs text-[var(--mi-text-soft)]">
              Envia uma mensagem de teste ao mesmo provedor de IA configurado no atendimento, sem
              enviar nada ao WhatsApp do cliente.
            </p>
          </div>
        </div>
        <Textarea rows={4} value={message} onChange={(event) => setMessage(event.target.value)} />
        <Button
          className="mt-3"
          onClick={() => void testChatbot()}
          disabled={testing || !message.trim()}
        >
          <SearchCheck className="mr-2 h-4 w-4" />{" "}
          {testing ? "Testando..." : "Executar teste do chatbot"}
        </Button>
        {answer && (
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950">
            <p className="mb-1 text-[10px] font-black uppercase tracking-[0.12em] text-blue-600">
              Resposta do chatbot
            </p>
            {answer}
          </div>
        )}
      </section>
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
