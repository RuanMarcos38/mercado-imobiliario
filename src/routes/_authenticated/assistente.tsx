import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, CheckCircle2, MessageCircle, Save, Send, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  getAiAgentSettings,
  saveAiAgentSettings,
} from "@/lib/whatsapp-admin.functions";
import { getAiRuntimeStatus, testAiAssistant } from "@/lib/ai-assistant.functions";

export const Route = createFileRoute("/_authenticated/assistente")({
  component: AssistantPage,
  head: () => ({ title: "Assistente IA | MercadoImobi" }),
});

function AssistantPage() {
  const settingsFn = useServerFn(getAiAgentSettings);
  const saveFn = useServerFn(saveAiAgentSettings);
  const statusFn = useServerFn(getAiRuntimeStatus);
  const testFn = useServerFn(testAiAssistant);

  const settings = useQuery({ queryKey: ["ai-agent-settings"], queryFn: () => settingsFn() });
  const runtime = useQuery({ queryKey: ["ai-runtime-status"], queryFn: () => statusFn() });

  const [enabled, setEnabled] = useState(false);
  const [autoReply, setAutoReply] = useState(false);
  const [agentName, setAgentName] = useState("Assistente MercadoImobi");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [handoff, setHandoff] = useState("humano, corretor, atendente");
  const [testMessage, setTestMessage] = useState("Olá, estou procurando um apartamento em Joinville. Como você pode me ajudar?");
  const [testReply, setTestReply] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    setEnabled(Boolean(settings.data.enabled));
    setAutoReply(Boolean(settings.data.auto_reply));
    setAgentName(settings.data.agent_name || "Assistente MercadoImobi");
    setSystemPrompt(settings.data.system_prompt || "");
    setHandoff((settings.data.handoff_keywords ?? ["humano", "corretor", "atendente"]).join(", "));
  }, [settings.data]);

  const save = async () => {
    try {
      await saveFn({
        data: {
          enabled,
          autoReply,
          agentName,
          systemPrompt,
          handoffKeywords: handoff
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        },
      });
      await settings.refetch();
      toast.success("Configuração do assistente salva.");
    } catch {
      toast.error("Não foi possível salvar a configuração.");
    }
  };

  const test = async () => {
    if (!testMessage.trim()) return;
    if (!runtime.data?.configured) {
      toast.info("A inteligência artificial ainda precisa ser ativada no servidor.");
      return;
    }
    setTesting(true);
    setTestReply("");
    try {
      const result = await testFn({ data: { message: testMessage } });
      setTestReply(result.text);
    } catch {
      toast.error("O teste do assistente não respondeu. Verifique a configuração do servidor.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#06101c] p-4 text-white sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1400px]">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">Atendimento</p>
            <h1 className="mt-2 text-3xl font-black">Assistente Inteligente</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Configure o tom de atendimento, teste respostas antes de ativar e defina quando a conversa deve passar para uma pessoa.
            </p>
          </div>
          <StatusCard configured={Boolean(runtime.data?.configured)} model={runtime.data?.model ?? null} />
        </div>

        <div className="mt-7 grid gap-6 xl:grid-cols-[1fr_460px]">
          <section className="rounded-[26px] border border-white/10 bg-white/[0.04] p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-cyan-300" />
              <h2 className="text-lg font-black">Comportamento do assistente</h2>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <ToggleCard
                title="Assistente ativado"
                description="Permite gerar respostas dentro das conversas."
                checked={enabled}
                onChange={setEnabled}
              />
              <ToggleCard
                title="Resposta automática"
                description="Mantenha desligado até validar o atendimento e a conexão do WhatsApp."
                checked={autoReply}
                onChange={setAutoReply}
                warning
              />
            </div>

            <div className="mt-5 space-y-4">
              <Field label="Nome do assistente">
                <input value={agentName} onChange={(event) => setAgentName(event.target.value)} />
              </Field>
              <Field label="Instruções de atendimento">
                <textarea
                  rows={10}
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  placeholder="Ex.: Seja cordial, consultivo, faça uma pergunta por vez, não invente informações e ofereça atendimento humano quando necessário."
                />
              </Field>
              <Field label="Palavras para transferir ao atendimento humano">
                <input value={handoff} onChange={(event) => setHandoff(event.target.value)} />
              </Field>
              <Button onClick={() => void save()} className="h-11 rounded-xl bg-cyan-300 px-5 font-black text-[#06101c] hover:bg-cyan-200">
                <Save className="mr-2 h-4 w-4" /> Salvar configuração
              </Button>
            </div>
          </section>

          <section className="rounded-[26px] border border-white/10 bg-white/[0.04] p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-cyan-300" />
              <h2 className="text-lg font-black">Teste do chatbot</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Este teste não envia mensagem para nenhum cliente. Ele apenas valida a resposta do assistente no servidor.
            </p>

            <div className="mt-5 rounded-2xl border border-white/10 bg-[#081421] p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/5 text-slate-300">
                  <MessageCircle className="h-4 w-4" />
                </span>
                <textarea
                  rows={5}
                  value={testMessage}
                  onChange={(event) => setTestMessage(event.target.value)}
                  className="min-h-28 flex-1 resize-none bg-transparent text-sm leading-6 text-white outline-none placeholder:text-slate-600"
                />
              </div>
            </div>
            <Button
              onClick={() => void test()}
              disabled={testing || !runtime.data?.configured}
              className="mt-3 h-11 w-full rounded-xl bg-cyan-300 font-black text-[#06101c] hover:bg-cyan-200"
            >
              <Send className="mr-2 h-4 w-4" /> {testing ? "Testando..." : "Testar resposta"}
            </Button>

            {testReply && (
              <div className="mt-4 rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.04] p-4">
                <p className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-emerald-200">
                  <CheckCircle2 className="h-4 w-4" /> Resposta recebida
                </p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">{testReply}</p>
              </div>
            )}

            {!runtime.isLoading && !runtime.data?.configured && (
              <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-300/[0.04] p-4 text-sm leading-6 text-amber-100">
                O módulo está pronto, mas a inteligência artificial ainda não está conectada no servidor. O teste e as respostas automáticas permanecem bloqueados até a ativação.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function StatusCard({ configured, model }: { configured: boolean; model: string | null }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${configured ? "border-emerald-300/15 bg-emerald-300/[0.05]" : "border-amber-300/15 bg-amber-300/[0.04]"}`}>
      <p className={`flex items-center gap-2 text-xs font-black ${configured ? "text-emerald-200" : "text-amber-100"}`}>
        <ShieldCheck className="h-4 w-4" /> {configured ? "IA conectada" : "IA aguardando ativação"}
      </p>
      {model && <p className="mt-1 text-[11px] text-slate-500">Modelo do servidor: {model}</p>}
    </div>
  );
}

function ToggleCard({ title, description, checked, onChange, warning }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void; warning?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-start justify-between gap-4 rounded-2xl border p-4 ${warning ? "border-amber-300/10 bg-amber-300/[0.025]" : "border-white/10 bg-black/10"}`}>
      <span><span className="block text-sm font-bold">{title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-4 w-4 accent-cyan-300" />
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2 [&_input]:w-full [&_input]:bg-transparent [&_input]:text-sm [&_input]:text-white [&_input]:outline-none [&_textarea]:w-full [&_textarea]:resize-none [&_textarea]:bg-transparent [&_textarea]:text-sm [&_textarea]:leading-6 [&_textarea]:text-white [&_textarea]:outline-none">
        {children}
      </div>
    </label>
  );
}
