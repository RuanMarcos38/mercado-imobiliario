import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bot,
  CheckCircle2,
  Code2,
  Copy,
  MessageSquareText,
  PauseCircle,
  Plus,
  Power,
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
  setWhatsAppFlowEnabled,
} from "@/lib/whatsapp-admin.functions";
import {
  importWhatsAppFlowJson,
  previewWhatsAppFlowJson,
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
    "triggerType": "new_conversation",
    "triggerValue": "",
    "enabled": false,
    "steps": [
      { "type": "message", "config": { "text": "Olá {{nome}}! Como posso ajudar?" } },
      { "type": "wait", "config": { "seconds": 3 } },
      { "type": "ai", "config": { "instruction": "Atenda de forma humana e faça uma pergunta por vez." } },
      { "type": "tag", "config": { "tag": "Lead qualificado" } },
      { "type": "handoff", "config": { "reason": "Cliente pediu atendimento humano" } }
    ]
  }
}

Regras:
- triggerType deve ser: manual, new_conversation, keyword, new_property_alert ou webhook.
- type de cada step deve ser: message, wait, ai, handoff, webhook ou tag.
- Para keyword, preencha triggerValue com a palavra ou frase que inicia o fluxo.
- Em mensagens podem ser usadas as variáveis {{nome}}, {{telefone}}, {{mensagem}} e {{fluxo}}.
- Não inclua senhas, tokens, API Keys ou credenciais no JSON.
- O fluxo deve começar pausado para revisão.
- Preserve textos em português do Brasil.
- Entregue apenas JSON válido.`

function FlowsPage() {
  const listFn = useServerFn(listWhatsAppFlows);
  const createFn = useServerFn(createWhatsAppFlow);
  const addStepFn = useServerFn(addWhatsAppFlowStep);
  const getAiSettingsFn = useServerFn(getAiAgentSettings);
  const saveAiSettingsFn = useServerFn(saveAiAgentSettings);
  const setFlowEnabledFn = useServerFn(setWhatsAppFlowEnabled);
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
  const [jsonImport, setJsonImport] = useState("");
  const [validatingJson, setValidatingJson] = useState(false);
  const [importingJson, setImportingJson] = useState(false);
  const [flowBusyId, setFlowBusyId] = useState<string | null>(null);
  const [jsonPreview, setJsonPreview] = useState<{
    kind: string;
    flowName: string | null;
    flowSteps: number;
    hasLocalFlow: boolean;
  } | null>(null);
  const flows = useQuery({ queryKey: ["whatsapp-flows"], queryFn: () => listFn() });
  const aiSettings = useQuery({
    queryKey: ["ai-agent-settings"],
    queryFn: () => getAiSettingsFn(),
  });

  useEffect(() => {
    if (!aiSettings.data) return;
    setAiEnabled(Boolean(aiSettings.data.enabled));
    setAutoReply(Boolean(aiSettings.data.auto_reply));
    setAgentName(aiSettings.data.agent_name || "Assistente MercadoImobi");
    setSystemPrompt(aiSettings.data.system_prompt || "");
    setHandoffKeywords((aiSettings.data.handoff_keywords ?? []).join(", "));
  }, [aiSettings.data]);

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

  const toggleFlow = async (flowId: string, enabled: boolean) => {
    if (flowBusyId) return;
    setFlowBusyId(flowId);
    try {
      await setFlowEnabledFn({ data: { flowId, enabled } });
      await flows.refetch();
      toast.success(enabled ? "Fluxo ativado no motor nativo." : "Fluxo pausado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar o fluxo.");
    } finally {
      setFlowBusyId(null);
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
      if (!result.hasLocalFlow) {
        throw new Error("O JSON precisa conter um fluxo MercadoImobi.");
      }
      setJsonPreview({
        kind: result.kind,
        flowName: result.flowName,
        flowSteps: result.flowSteps,
        hasLocalFlow: result.hasLocalFlow,
      });
      toast.success("JSON válido e compatível com o motor nativo.");
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
          publishToN8n: false,
          activateN8n: false,
        },
      });
      await flows.refetch();
      if (!result.localFlowId) {
        throw new Error("O JSON não contém um fluxo nativo do MercadoImobi.");
      }
      toast.success("Fluxo importado. Revise e clique em Ativar quando estiver pronto.");
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
        <section className="mt-7 rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Code2 className="h-5 w-5 text-blue-600" />
                <h2 className="font-black">Importar fluxo JSON · ChatGPT + n8n</h2>
              </div>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--mi-text-soft)]">
                Gere o fluxo no ChatGPT, cole ou carregue o arquivo JSON, valide e importe sem
                substituir os fluxos já existentes. Workflows nativos do n8n também são aceitos.
              </p>
            </div>
            <Button variant="outline" onClick={() => void copyChatGptPrompt()}>
              <Copy className="mr-2 h-4 w-4" /> Copiar prompt para ChatGPT
            </Button>
          </div>

          <div className="mt-5 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-3">
              <Field label="JSON do fluxo">
                <textarea
                  value={jsonImport}
                  onChange={(event) => {
                    setJsonImport(event.target.value);
                    setJsonPreview(null);
                  }}
                  rows={14}
                  spellCheck={false}
                  placeholder="Cole aqui o JSON gerado pelo ChatGPT ou exportado pelo n8n..."
                  className="font-mono text-xs"
                />
              </Field>

              <div className="flex flex-wrap gap-2">
                <label className="inline-flex h-10 cursor-pointer items-center rounded-xl border border-[var(--mi-border)] px-4 text-xs font-black hover:bg-[var(--mi-surface-soft)]">
                  <Upload className="mr-2 h-4 w-4" /> Carregar arquivo .json
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(event) => void selectJsonFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                <Button
                  variant="outline"
                  onClick={() => void validateJson()}
                  disabled={!jsonImport.trim() || validatingJson}
                >
                  {validatingJson ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  Validar JSON
                </Button>
              </div>

              {jsonPreview && (
                <div className="rounded-xl border border-emerald-300/40 bg-emerald-500/[0.06] p-3 text-xs leading-5">
                  <p className="font-black text-emerald-700 dark:text-emerald-300">
                    JSON válido · {jsonPreview.kind}
                  </p>
                  {jsonPreview.hasLocalFlow && (
                    <p className="mt-1">
                      MercadoImobi: {jsonPreview.flowName} · {jsonPreview.flowSteps} passo(s)
                    </p>
                  )}
                  {jsonPreview.hasN8nWorkflow && (
                    <p>
                      n8n: {jsonPreview.n8nWorkflowName} · {jsonPreview.n8nNodes} node(s)
                    </p>
                  )}
                </div>
              )}

              <div className="grid gap-2 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-3 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-xs font-bold">
                  <input
                    type="checkbox"
                    checked={publishToN8n}
                    onChange={(event) => {
                      setPublishToN8n(event.target.checked);
                      if (!event.target.checked) setActivateN8n(false);
                    }}
                  />
                  Também publicar no n8n
                </label>
                <label className="flex items-center gap-2 text-xs font-bold">
                  <input
                    type="checkbox"
                    checked={activateN8n}
                    disabled={!publishToN8n}
                    onChange={(event) => setActivateN8n(event.target.checked)}
                  />
                  Ativar workflow após importar
                </label>
              </div>

              <Button
                onClick={() => void importJson()}
                disabled={!jsonImport.trim() || importingJson}
                className="h-11 w-full rounded-xl bg-blue-600 font-black text-white hover:bg-blue-700"
              >
                {importingJson ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Workflow className="mr-2 h-4 w-4" />
                )}
                {importingJson ? "Importando..." : "Importar fluxo JSON"}
              </Button>
              <p className="text-[10px] leading-4 text-[var(--mi-text-soft)]">
                Fluxos importados no MercadoImobi começam pausados para revisão. O importador não
                altera credenciais existentes e não executa código contido no JSON.
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Link2 className="h-4 w-4 text-violet-600" />
                    <p className="text-sm font-black">Integração n8n</p>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-[var(--mi-text-soft)]">
                    A API Key fica criptografada no servidor e nunca é exibida novamente.
                  </p>
                </div>
                <span
                  className={
                    "rounded-full px-2.5 py-1 text-[10px] font-black " +
                    (n8nSettings.data?.configured
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "bg-amber-500/10 text-amber-700 dark:text-amber-300")
                  }
                >
                  {n8nSettings.data?.configured ? "CONFIGURADO" : "PENDENTE"}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                <Field label="URL da instância n8n">
                  <input
                    value={n8nBaseUrl}
                    onChange={(event) => setN8nBaseUrl(event.target.value)}
                    placeholder="https://n8n.seudominio.com"
                    autoComplete="off"
                  />
                </Field>
                <Field label="API Key do n8n">
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 shrink-0 text-[var(--mi-text-soft)]" />
                    <input
                      type="password"
                      value={n8nApiKey}
                      onChange={(event) => setN8nApiKey(event.target.value)}
                      placeholder={
                        n8nSettings.data?.hasApiKey
                          ? "Deixe vazio para manter a chave salva"
                          : "Cole a API Key do n8n"
                      }
                      autoComplete="new-password"
                    />
                  </div>
                </Field>

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void saveN8n()}
                    disabled={!n8nBaseUrl.trim() || savingN8n}
                    className="bg-violet-600 font-black text-white hover:bg-violet-700"
                  >
                    {savingN8n ? (
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <KeyRound className="mr-2 h-4 w-4" />
                    )}
                    Salvar e validar
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void testN8n()}
                    disabled={!n8nSettings.data?.configured || testingN8n}
                  >
                    {testingN8n ? (
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Link2 className="mr-2 h-4 w-4" />
                    )}
                    Testar conexão
                  </Button>
                </div>

                <div className="rounded-xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-3 text-[11px] leading-5 text-[var(--mi-text-soft)]">
                  <p>
                    Fonte atual:{" "}
                    <strong className="text-[var(--mi-text)]">
                      {n8nSettings.data?.source === "user"
                        ? "Configuração criptografada da conta"
                        : n8nSettings.data?.source === "server"
                          ? "Variáveis seguras do servidor"
                          : "Não configurada"}
                    </strong>
                  </p>
                  <p className="mt-1">
                    A integração usa a API do n8n para criar workflows. Credenciais referenciadas
                    pelos nodes precisam existir na própria instância n8n.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
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
