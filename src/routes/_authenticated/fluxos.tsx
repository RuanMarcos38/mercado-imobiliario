import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, MessageSquareText, Plus, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  addWhatsAppFlowStep,
  createWhatsAppFlow,
  listWhatsAppFlows,
} from "@/lib/whatsapp-admin.functions";

export const Route = createFileRoute("/_authenticated/fluxos")({
  component: FlowsPage,
  head: () => ({ title: "Fluxos de atendimento | MercadoImobi" }),
});

function FlowsPage() {
  const listFn = useServerFn(listWhatsAppFlows);
  const createFn = useServerFn(createWhatsAppFlow);
  const addStepFn = useServerFn(addWhatsAppFlowStep);
  const [name, setName] = useState("Novo fluxo");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<
    "manual" | "new_conversation" | "keyword" | "new_property_alert" | "webhook"
  >("manual");
  const [triggerValue, setTriggerValue] = useState("");
  const flows = useQuery({ queryKey: ["whatsapp-flows"], queryFn: () => listFn() });

  const create = async () => {
    try {
      const result = await createFn({
        data: {
          name,
          description: description || undefined,
          triggerType,
          triggerValue: triggerValue || undefined,
          enabled: false,
        },
      });
      await addStepFn({
        data: {
          flowId: result.id,
          stepType: "message",
          config: { text: "Olá! Como posso ajudar com este imóvel?" },
        },
      });
      await flows.refetch();
      toast.success("Fluxo criado. Ele começa pausado para revisão.");
    } catch {
      toast.error("Não foi possível criar o fluxo.");
    }
  };

  return (
    <div className="min-h-screen bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1400px]">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Atendimento</p>
        <h1 className="mt-2 text-3xl font-black">Fluxos de conversa</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--mi-text-muted)]">
          Organize mensagens, espera, passagem para atendente, IA e webhooks sem misturar essas
          configurações com a tela de conversas.
        </p>

        <div className="mt-7 grid gap-6 xl:grid-cols-[420px_1fr]">
          <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-blue-600" />
              <h2 className="font-black">Criar fluxo</h2>
            </div>
            <div className="mt-5 space-y-3">
              <Field label="Nome">
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Descrição">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </Field>
              <Field label="Quando iniciar">
                <select
                  value={triggerType}
                  onChange={(e) => setTriggerType(e.target.value as typeof triggerType)}
                >
                  <option value="manual">Manual</option>
                  <option value="new_conversation">Nova conversa</option>
                  <option value="keyword">Palavra-chave</option>
                  <option value="new_property_alert">Novo imóvel encontrado</option>
                  <option value="webhook">Webhook</option>
                </select>
              </Field>
              {triggerType === "keyword" && (
                <Field label="Palavra-chave">
                  <input value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)} />
                </Field>
              )}
              <Button
                onClick={() => void create()}
                className="h-11 w-full rounded-xl bg-blue-600 font-black text-white hover:bg-blue-700"
              >
                <Workflow className="mr-2 h-4 w-4" /> Criar fluxo
              </Button>
            </div>
          </section>

          <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
            <h2 className="font-black">Fluxos cadastrados</h2>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {(flows.data ?? []).map((flow: any) => (
                <div
                  key={flow.id}
                  className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">{flow.name}</p>
                      <p className="mt-1 text-xs text-[var(--mi-text-soft)]">
                        {flow.description || "Sem descrição"}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-black ${flow.enabled ? "bg-emerald-400/10 text-emerald-200" : "bg-white/5 text-[var(--mi-text-soft)]"}`}
                    >
                      {flow.enabled ? "ATIVO" : "PAUSADO"}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center gap-2 border-t border-[var(--mi-border)] pt-3 text-xs text-[var(--mi-text-muted)]">
                    <MessageSquareText className="h-3.5 w-3.5" /> Gatilho:{" "}
                    {labelTrigger(flow.trigger_type)}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-[var(--mi-text-soft)]">
                    <Bot className="h-3.5 w-3.5" /> Passos adicionais podem incluir IA e
                    transferência para humano.
                  </div>
                </div>
              ))}
              {!flows.isLoading && (flows.data?.length ?? 0) === 0 && (
                <div className="col-span-full rounded-2xl border border-dashed border-[var(--mi-border)] p-8 text-center text-sm text-[var(--mi-text-soft)]">
                  Nenhum fluxo criado ainda.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.14em] text-[var(--mi-text-soft)]">
        {label}
      </span>
      <div className="rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-3 py-2 [&_input]:w-full [&_input]:bg-transparent [&_input]:text-sm [&_input]:text-[var(--mi-text)] [&_input]:outline-none [&_textarea]:w-full [&_textarea]:resize-none [&_textarea]:bg-transparent [&_textarea]:text-sm [&_textarea]:text-[var(--mi-text)] [&_textarea]:outline-none [&_select]:w-full [&_select]:bg-transparent [&_select]:text-sm [&_select]:text-[var(--mi-text)] [&_select]:outline-none [&_option]:bg-[var(--mi-surface)]">
        {children}
      </div>
    </label>
  );
}
function labelTrigger(value: string) {
  return (
    (
      {
        manual: "Manual",
        new_conversation: "Nova conversa",
        keyword: "Palavra-chave",
        new_property_alert: "Novo imóvel",
        webhook: "Webhook",
      } as Record<string, string>
    )[value] ?? value
  );
}
