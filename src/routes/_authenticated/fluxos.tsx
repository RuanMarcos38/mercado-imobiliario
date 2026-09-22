import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bot,
  CheckCircle2,
  Code2,
  Copy,
  KeyRound,
  Link2,
  MessageSquareText,
  Plus,
  RefreshCw,
  Upload,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  addWhatsAppFlowStep,
  createWhatsAppFlow,
  getAiAgentSettings,
  listWhatsAppFlows,
  saveAiAgentSettings,
} from "@/lib/whatsapp-admin.functions";
import {
  getN8nWorkflowSettings,
  importWhatsAppFlowJson,
  previewWhatsAppFlowJson,
  saveN8nWorkflowSettings,
  testN8nWorkflowConnection,
} from "@/lib/n8n-workflow.functions";

export const Route = createFileRoute("/_authenticated/fluxos")({
  component: FlowsPage,
  head: () => ({ title: "Fluxos de atendimento | MercadoImobi" }),
});

const CHATGPT_FLOW_PROMPT = `Crie um fluxo de atendimento para importar no MercadoImobi.
Responda SOMENTE com JSON válido, sem markdown, comentários ou explicações.

Formato obrigatório:
{
  "schemaVersion": 1,
  "flow": {
    "name": "Nome do fluxo",
    "description": "Objetivo do fluxo",
    "triggerType": "manual",
    "triggerValue": "",
    "enabled": false,
    "steps": [
      { "type": "message", "config": { "text": "Olá! Como posso ajudar?" } },
      { "type": "wait", "config": { "seconds": 3 } },
      { "type": "ai", "config": { "instruction": "Atenda de forma humana e faça uma pergunta por vez." } },
      { "type": "handoff", "config": { "reason": "Cliente pediu atendimento humano" } }
    ]
  },
  "n8nWorkflow": {
    "name": "Nome do workflow no n8n",
    "nodes": [],
    "connections": {},
    "settings": {}
  }
}

Regras:
- triggerType deve ser: manual, new_conversation, keyword, new_property_alert ou webhook.
- type de cada step deve ser: message, wait, ai, handoff, webhook ou tag.
- Se eu pedir integração com n8n, preencha n8nWorkflow com nodes e connections válidos do n8n.
- Não inclua senhas, tokens, API Keys ou credenciais no JSON.
- O fluxo deve começar pausado para revisão.
- Preserve textos em português do Brasil.
- Entregue apenas JSON válido.`;

function FlowsPage() {
  const listFn = useServerFn(listWhatsAppFlows);
  const createFn = useServerFn(createWhatsAppFlow);
  const addStepFn = useServerFn(addWhatsAppFlowStep);
  const getAiSettingsFn = useServerFn(getAiAgentSettings);
  const saveAiSettingsFn = useServerFn(saveAiAgentSettings);
  const getN8nSettingsFn = useServerFn(getN8nWorkflowSettings);
  const saveN8nSettingsFn = useServerFn(saveN8nWorkflowSettings);
  const testN8nFn = useServerFn(testN8nWorkflowConnection);
  const previewJsonFn = useServerFn(previewWhatsAppFlowJson);
  const importJsonFn = useServerFn(importWhatsAppFlowJson);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [autoReply, setAutoReply] = useState(true);
  const [agentName, setAgentName] = useState("Assistente MercadoImobi");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [handoffKeywords, setHandoffKeywords] = useState("humano, corretor, atendente");
  const [savingAi, setSavingAi] = useState(false);
  const [name, setName] = useState("Novo fluxo");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<
    "manual" | "new_conversation" | "keyword" | "new_property_alert" | "webhook"
  >("manual");
  const [triggerValue, setTriggerValue] = useState("");
  const [n8nBaseUrl, setN8nBaseUrl] = useState("");
  const [n8nApiKey, setN8nApiKey] = useState("");
  const [savingN8n, setSavingN8n] = useState(false);
  const [testingN8n, setTestingN8n] = useState(false);
  const [jsonImport, setJsonImport] = useState("");
  const [validatingJson, setValidatingJson] = useState(false);
  const [importingJson, setImportingJson] = useState(false);
  const [publishToN8n, setPublishToN8n] = useState(false);
  const [activateN8n, setActivateN8n] = useState(false);
  const [jsonPreview, setJsonPreview] = useState<{
    kind: string;
    flowName: string | null;
    flowSteps: number;
    n8nWorkflowName: string | null;
    n8nNodes: number;
    hasLocalFlow: boolean;
    hasN8nWorkflow: boolean;
  } | null>(null);
  const flows = useQuery({ queryKey: ["whatsapp-flows"], queryFn: () => listFn() });
  const aiSettings = useQuery({
    queryKey: ["ai-agent-settings"],
    queryFn: () => getAiSettingsFn(),
  });
  const n8nSettings = useQuery({
    queryKey: ["n8n-workflow-settings"],
    queryFn: () => getN8nSettingsFn(),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!aiSettings.data) return;
    setAiEnabled(Boolean(aiSettings.data.enabled));
    setAutoReply(Boolean(aiSettings.data.auto_reply));
    setAgentName(aiSettings.data.agent_name || "Assistente MercadoImobi");
    setSystemPrompt(aiSettings.data.system_prompt || "");
    setHandoffKeywords((aiSettings.data.handoff_keywords ?? []).join(", "));
  }, [aiSettings.data]);

  useEffect(() => {
    if (!n8nSettings.data) return;
    setN8nBaseUrl(n8nSettings.data.baseUrl || "");
  }, [n8nSettings.data]);

  const saveAi = async () => {
    setSavingAi(true);
    try {
      const keywords = handoffKeywords
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      await saveAiSettingsFn({
        data: {
          enabled: aiEnabled,
          agentName,
          systemPrompt,
          autoReply,
          handoffKeywords: keywords.length ? keywords : ["humano", "corretor", "atendente"],
        },
      });
      await aiSettings.refetch();
      toast.success("Agente de IA e atendimento automático atualizados.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível salvar o agente de IA.",
      );
    } finally {
      setSavingAi(false);
    }
  };

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

  const saveN8n = async () => {
    if (!n8nBaseUrl.trim() || savingN8n) return;
    setSavingN8n(true);
    try {
      await saveN8nSettingsFn({
        data: {
          baseUrl: n8nBaseUrl.trim(),
          apiKey: n8nApiKey.trim() || undefined,
        },
      });
      setN8nApiKey("");
      await n8nSettings.refetch();
      toast.success("Integração n8n validada e salva com segurança.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível conectar ao n8n.");
    } finally {
      setSavingN8n(false);
    }
  };

  const testN8n = async () => {
    if (testingN8n) return;
    setTestingN8n(true);
    try {
      await testN8nFn();
      toast.success("Conexão com o n8n confirmada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao testar o n8n.");
    } finally {
      setTestingN8n(false);
    }
  };

  const copyChatGptPrompt = async () => {
    try {
      await navigator.clipboard.writeText(CHATGPT_FLOW_PROMPT);
      toast.success("Prompt para o ChatGPT copiado.");
    } catch {
      toast.error("Não foi possível copiar o prompt automaticamente.");
    }
  };

  const selectJsonFile = async (file: File | null) => {
    if (!file) return;
    if (file.size > 1_500_000) {
      toast.error("O arquivo JSON deve ter no máximo 1,5 MB.");
      return;
    }
    try {
      const text = await file.text();
      setJsonImport(text);
      setJsonPreview(null);
      toast.success("JSON carregado. Valide antes de importar.");
    } catch {
      toast.error("Não foi possível ler o arquivo JSON.");
    }
  };

  const validateJson = async () => {
    if (!jsonImport.trim() || validatingJson) return;
    setValidatingJson(true);
    try {
      const result = await previewJsonFn({ data: { json: jsonImport } });
      setJsonPreview(result);
      if (result.hasN8nWorkflow && !result.hasLocalFlow) setPublishToN8n(true);
      toast.success("JSON válido e compatível com a ferramenta.");
    } catch (error) {
      setJsonPreview(null);
      toast.error(error instanceof Error ? error.message : "JSON inválido.");
    } finally {
      setValidatingJson(false);
    }
  };

  const importJson = async () => {
    if (!jsonImport.trim() || importingJson) return;
    setImportingJson(true);
    try {
      const result = await importJsonFn({
        data: {
          json: jsonImport,
          publishToN8n,
          activateN8n: publishToN8n && activateN8n,
        },
      });
      await flows.refetch();
      if (result.warning) {
        toast.info(result.warning);
      } else if (result.localFlowId && result.n8n?.id) {
        toast.success("Fluxo importado no MercadoImobi e publicado no n8n.");
      } else if (result.localFlowId) {
        toast.success("Fluxo importado no MercadoImobi e mantido pausado para revisão.");
      } else {
        toast.success("Workflow publicado no n8n com sucesso.");
      }
      setJsonPreview(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível importar o fluxo.");
    } finally {
      setImportingJson(false);
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

        <section className="mt-7 rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-emerald-600" />
                <h2 className="font-black">Agente de IA · Atendimento automático</h2>
              </div>
              <p className="mt-1 text-xs text-[var(--mi-text-soft)]">
                O modo automático responde novas mensagens recebidas e transfere para humano quando
                necessário.
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-[10px] font-black ${aiEnabled && autoReply ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}
            >
              {aiEnabled && autoReply ? "AUTOMÁTICO ATIVO" : "AUTOMÁTICO PAUSADO"}
            </span>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <label className="flex items-center justify-between rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-4 py-3 text-sm font-bold">
              Ativar agente de IA
              <input
                type="checkbox"
                checked={aiEnabled}
                onChange={(e) => setAiEnabled(e.target.checked)}
                className="h-4 w-4"
              />
            </label>
            <label className="flex items-center justify-between rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-4 py-3 text-sm font-bold">
              Responder automaticamente
              <input
                type="checkbox"
                checked={autoReply}
                onChange={(e) => setAutoReply(e.target.checked)}
                className="h-4 w-4"
              />
            </label>
            <Field label="Nome do agente">
              <input value={agentName} onChange={(e) => setAgentName(e.target.value)} />
            </Field>
            <Field label="Palavras para transferir ao humano">
              <input
                value={handoffKeywords}
                onChange={(e) => setHandoffKeywords(e.target.value)}
                placeholder="humano, corretor, atendente"
              />
            </Field>
            <div className="lg:col-span-2">
              <Field label="Instruções do agente">
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={5}
                />
              </Field>
            </div>
          </div>
          <Button
            onClick={() => void saveAi()}
            disabled={savingAi || aiSettings.isLoading}
            className="mt-4 h-11 rounded-xl bg-emerald-600 px-5 font-black text-white hover:bg-emerald-700"
          >
            <Bot className="mr-2 h-4 w-4" />{" "}
            {savingAi ? "Salvando..." : "Salvar agente e automático"}
          </Button>
        </section>

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
