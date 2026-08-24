import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  ArrowRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Download,
  GripVertical,
  Layers3,
  ListChecks,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Upload,
  UsersRound,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addCrmCadenceStep,
  bulkDeleteCrmOpportunities,
  bulkLoseCrmOpportunities,
  bulkMoveCrmOpportunities,
  completeCrmActivity,
  createCrmAutomation,
  createCrmCadence,
  createCrmCustomField,
  createCrmLossReason,
  createCrmOpportunity,
  createCrmPipeline,
  createCrmStage,
  getCrmWorkspace,
  importCrmOpportunities,
  toggleCrmAutomation,
  toggleCrmCadence,
  toggleCrmLossReason,
  updateCrmOpportunity,
  updateCrmStage,
  type CrmCustomField,
  type CrmOpportunity,
  type CrmStage,
} from "@/lib/crm-advanced.functions";

type Panel =
  "pipeline" | "funis" | "perdas" | "importar" | "exportar" | "cadencias" | "automacoes" | "campos";

const panelItems: Array<{ id: Panel; label: string; icon: typeof Activity }> = [
  { id: "pipeline", label: "Pipeline", icon: Layers3 },
  { id: "funis", label: "Funis e etapas", icon: SlidersHorizontal },
  { id: "perdas", label: "Motivos de perda", icon: XCircle },
  { id: "importar", label: "Importações", icon: Upload },
  { id: "exportar", label: "Exportações", icon: Download },
  { id: "cadencias", label: "Cadência de funil", icon: CalendarClock },
  { id: "automacoes", label: "Ações automáticas", icon: Bot },
  { id: "campos", label: "Campos customizados", icon: Settings2 },
];

const emptyOpportunity = {
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  propertyReference: "",
  source: "manual",
  value: "",
  expectedCloseDate: "",
  nextActionAt: "",
  notes: "",
  customValues: {} as Record<string, unknown>,
};

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(value),
  );
}

function when(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if ((char === "," || char === ";") && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows
    .slice(1)
    .map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
    );
}

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(opportunities: CrmOpportunity[], stages: CrmStage[]) {
  const stageMap = new Map(stages.map((stage) => [stage.id, stage.name]));
  const header = [
    "nome",
    "telefone",
    "email",
    "imovel",
    "origem",
    "valor",
    "etapa",
    "probabilidade",
    "status",
    "proxima_acao",
    "observacoes",
  ];
  const lines = opportunities.map((item) =>
    [
      item.contact_name,
      item.contact_phone,
      item.contact_email,
      item.property_reference,
      item.source,
      item.value,
      stageMap.get(item.stage_id) ?? "",
      item.probability,
      item.status,
      item.next_action_at,
      item.notes,
    ]
      .map(csvEscape)
      .join(","),
  );
  const blob = new Blob(["\ufeff", header.join(","), "\n", lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `mercadoimobi-oportunidades-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function CrmPipelineWorkspace() {
  const getWorkspaceFn = useServerFn(getCrmWorkspace);
  const createOpportunityFn = useServerFn(createCrmOpportunity);
  const updateOpportunityFn = useServerFn(updateCrmOpportunity);
  const moveFn = useServerFn(bulkMoveCrmOpportunities);
  const loseFn = useServerFn(bulkLoseCrmOpportunities);
  const deleteFn = useServerFn(bulkDeleteCrmOpportunities);
  const pipelineFn = useServerFn(createCrmPipeline);
  const stageFn = useServerFn(createCrmStage);
  const updateStageFn = useServerFn(updateCrmStage);
  const lossReasonFn = useServerFn(createCrmLossReason);
  const toggleLossReasonFn = useServerFn(toggleCrmLossReason);
  const customFieldFn = useServerFn(createCrmCustomField);
  const cadenceFn = useServerFn(createCrmCadence);
  const cadenceStepFn = useServerFn(addCrmCadenceStep);
  const toggleCadenceFn = useServerFn(toggleCrmCadence);
  const automationFn = useServerFn(createCrmAutomation);
  const toggleAutomationFn = useServerFn(toggleCrmAutomation);
  const completeActivityFn = useServerFn(completeCrmActivity);
  const importFn = useServerFn(importCrmOpportunities);

  const workspace = useQuery({
    queryKey: ["crm-advanced-workspace"],
    queryFn: () => getWorkspaceFn(),
  });

  const [panel, setPanel] = useState<Panel>("pipeline");
  const [pipelineId, setPipelineId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [bulkStageId, setBulkStageId] = useState("");
  const [bulkLossReasonId, setBulkLossReasonId] = useState("");
  const [opportunityOpen, setOpportunityOpen] = useState(false);
  const [editing, setEditing] = useState<CrmOpportunity | null>(null);
  const [opportunityForm, setOpportunityForm] = useState(emptyOpportunity);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pipelineId || !workspace.data?.pipelines.length) return;
    const initial =
      workspace.data.pipelines.find((item) => item.is_default) ?? workspace.data.pipelines[0];
    setPipelineId(initial.id);
  }, [pipelineId, workspace.data?.pipelines]);

  const stages = useMemo(
    () =>
      (workspace.data?.stages ?? [])
        .filter((stage) => stage.pipeline_id === pipelineId && stage.is_active)
        .sort((a, b) => a.position - b.position),
    [pipelineId, workspace.data?.stages],
  );

  const opportunities = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (workspace.data?.opportunities ?? []).filter((item) => {
      if (item.pipeline_id !== pipelineId) return false;
      if (!query) return true;
      return [
        item.contact_name,
        item.contact_phone,
        item.contact_email,
        item.property_reference,
        item.source,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [pipelineId, search, workspace.data?.opportunities]);

  const activitiesByOpportunity = useMemo(() => {
    const map = new Map<string, NonNullable<typeof workspace.data>["activities"]>();
    for (const activity of workspace.data?.activities ?? []) {
      const values = map.get(activity.opportunity_id) ?? [];
      values.push(activity);
      map.set(activity.opportunity_id, values);
    }
    return map;
  }, [workspace.data]);

  const byStage = useMemo(() => {
    const map = new Map<string, CrmOpportunity[]>();
    for (const stage of stages) map.set(stage.id, []);
    for (const item of opportunities) map.get(item.stage_id)?.push(item);
    return map;
  }, [opportunities, stages]);

  const openCount = opportunities.filter((item) => item.status === "open").length;
  const wonCount = opportunities.filter((item) => item.status === "won").length;
  const openValue = opportunities
    .filter((item) => item.status === "open")
    .reduce((total, item) => total + Number(item.value ?? 0), 0);
  const dueCount = opportunities.filter(
    (item) => item.next_action_at && new Date(item.next_action_at).getTime() <= Date.now(),
  ).length;

  const refresh = async () => {
    await workspace.refetch();
  };

  const openCreate = () => {
    setEditing(null);
    setOpportunityForm(emptyOpportunity);
    setOpportunityOpen(true);
  };

  const openEdit = (item: CrmOpportunity) => {
    setEditing(item);
    setOpportunityForm({
      contactName: item.contact_name,
      contactPhone: item.contact_phone ?? "",
      contactEmail: item.contact_email ?? "",
      propertyReference: item.property_reference ?? "",
      source: item.source,
      value: item.value == null ? "" : String(item.value),
      expectedCloseDate: item.expected_close_date ?? "",
      nextActionAt: item.next_action_at ? item.next_action_at.slice(0, 16) : "",
      notes: item.notes ?? "",
      customValues: item.custom_values ?? {},
    });
    setOpportunityOpen(true);
  };

  const saveOpportunity = async () => {
    const stageId = editing?.stage_id || stages.find((stage) => stage.status_type === "open")?.id;
    if (!pipelineId || !stageId)
      return toast.error("Configure ao menos uma etapa aberta no funil.");
    setSaving(true);
    try {
      const payload = {
        pipelineId,
        stageId,
        contactName: opportunityForm.contactName,
        contactPhone: opportunityForm.contactPhone,
        contactEmail: opportunityForm.contactEmail,
        propertyReference: opportunityForm.propertyReference,
        source: opportunityForm.source || "manual",
        value: opportunityForm.value ? Number(opportunityForm.value.replace(",", ".")) : null,
        expectedCloseDate: opportunityForm.expectedCloseDate,
        nextActionAt: opportunityForm.nextActionAt
          ? new Date(opportunityForm.nextActionAt).toISOString()
          : "",
        notes: opportunityForm.notes,
        customValues: opportunityForm.customValues,
      };
      if (editing) await updateOpportunityFn({ data: { id: editing.id, ...payload } });
      else await createOpportunityFn({ data: payload });
      toast.success(editing ? "Oportunidade atualizada." : "Oportunidade criada.");
      setOpportunityOpen(false);
      await refresh();
    } catch (error) {
      toast.error(String((error as Error)?.message ?? "Não foi possível salvar a oportunidade."));
    } finally {
      setSaving(false);
    }
  };

  const moveOne = async (id: string, stageId: string) => {
    try {
      await moveFn({ data: { ids: [id], pipelineId, stageId } });
      await refresh();
    } catch (error) {
      toast.error(String((error as Error)?.message ?? "Não foi possível mover a oportunidade."));
    } finally {
      setDraggingId(null);
    }
  };

  const runBulkMove = async () => {
    if (!selectedIds.size || !bulkStageId) return;
    await moveFn({ data: { ids: Array.from(selectedIds), pipelineId, stageId: bulkStageId } });
    setSelectedIds(new Set());
    await refresh();
    toast.success("Oportunidades movidas.");
  };

  const runBulkLoss = async () => {
    const lostStage = stages.find((stage) => stage.status_type === "lost");
    if (!lostStage) return toast.error("Crie uma etapa do tipo Perdido neste funil.");
    if (!selectedIds.size || !bulkLossReasonId) return toast.error("Selecione um motivo de perda.");
    await loseFn({
      data: {
        ids: Array.from(selectedIds),
        pipelineId,
        lostStageId: lostStage.id,
        lossReasonId: bulkLossReasonId,
      },
    });
    setSelectedIds(new Set());
    await refresh();
    toast.success("Oportunidades marcadas como perdidas.");
  };

  const runBulkDelete = async () => {
    if (!selectedIds.size) return;
    if (!window.confirm(`Excluir ${selectedIds.size} oportunidade(s)?`)) return;
    await deleteFn({ data: { ids: Array.from(selectedIds) } });
    setSelectedIds(new Set());
    await refresh();
    toast.success("Oportunidades excluídas.");
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (workspace.isLoading) {
    return (
      <div className="p-8 text-sm text-[var(--mi-text-muted)]">Carregando CRM imobiliário...</div>
    );
  }
  if (workspace.error || !workspace.data) {
    return (
      <div className="p-8">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
          Não foi possível carregar o CRM. {String((workspace.error as Error)?.message ?? "")}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1900px] space-y-5">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">
              CRM imobiliário
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">Pipeline de oportunidades</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--mi-text-muted)]">
              Todo novo contato do WhatsApp gera automaticamente uma oportunidade. Controle funis,
              etapas, perdas, cadências, automações, campos personalizados e ações em massa sem sair
              da estrutura atual da plataforma.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={pipelineId}
              onChange={(event) => {
                setPipelineId(event.target.value);
                setSelectedIds(new Set());
              }}
              className="h-10 rounded-md border border-[var(--mi-border)] bg-[var(--mi-surface)] px-3 text-sm font-bold"
            >
              {workspace.data.pipelines
                .filter((item) => item.is_active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> Nova oportunidade
            </Button>
          </div>
        </header>

        <div className="flex gap-2 overflow-x-auto rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-2">
          {panelItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setPanel(item.id)}
                className={classNames(
                  "flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-black transition",
                  panel === item.id
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-[var(--mi-text-muted)] hover:bg-[var(--mi-bg)]",
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {item.label}
              </button>
            );
          })}
        </div>

        {panel === "pipeline" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric icon={UsersRound} label="Oportunidades abertas" value={String(openCount)} />
              <Metric
                icon={CircleDollarSign}
                label="Valor em negociação"
                value={money(openValue)}
              />
              <Metric icon={CalendarClock} label="Follow-ups vencidos" value={String(dueCount)} />
              <Metric
                icon={CheckCircle2}
                label="Conversão em vendas"
                value={`${opportunities.length ? Math.round((wonCount / opportunities.length) * 100) : 0}%`}
              />
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-3 lg:flex-row lg:items-center">
              <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--mi-border)] bg-[var(--mi-bg)] px-3">
                <Search className="h-4 w-4 text-[var(--mi-text-soft)]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por cliente, telefone, imóvel ou origem..."
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </div>
              <Button variant="outline" onClick={() => fileInput.current?.click()}>
                <Upload className="mr-2 h-4 w-4" /> Importar
              </Button>
              <Button variant="outline" onClick={() => downloadCsv(opportunities, stages)}>
                <Download className="mr-2 h-4 w-4" /> Exportar
              </Button>
            </div>

            {selectedIds.size > 0 && (
              <div className="sticky top-16 z-30 flex flex-col gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-3 shadow-lg lg:flex-row lg:items-center">
                <strong className="text-sm text-blue-900">{selectedIds.size} selecionada(s)</strong>
                <select
                  value={bulkStageId}
                  onChange={(event) => setBulkStageId(event.target.value)}
                  className="h-9 rounded-md border border-blue-200 bg-white px-3 text-xs"
                >
                  <option value="">Mover para etapa...</option>
                  {stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
                <Button size="sm" onClick={() => void runBulkMove()} disabled={!bulkStageId}>
                  <ArrowRight className="mr-2 h-3.5 w-3.5" /> Mover em massa
                </Button>
                <select
                  value={bulkLossReasonId}
                  onChange={(event) => setBulkLossReasonId(event.target.value)}
                  className="h-9 rounded-md border border-blue-200 bg-white px-3 text-xs"
                >
                  <option value="">Motivo da perda...</option>
                  {workspace.data.lossReasons
                    .filter((item) => item.is_active)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
                <Button size="sm" variant="outline" onClick={() => void runBulkLoss()}>
                  <XCircle className="mr-2 h-3.5 w-3.5" /> Marcar perdido
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    downloadCsv(
                      opportunities.filter((item) => selectedIds.has(item.id)),
                      stages,
                    )
                  }
                >
                  <Download className="mr-2 h-3.5 w-3.5" /> Exportar selecionados
                </Button>
                <Button size="sm" variant="destructive" onClick={() => void runBulkDelete()}>
                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir
                </Button>
              </div>
            )}

            <div className="flex gap-4 overflow-x-auto pb-6">
              {stages.map((stage) => (
                <section
                  key={stage.id}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => draggingId && void moveOne(draggingId, stage.id)}
                  className="w-[315px] shrink-0 rounded-[22px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-3"
                >
                  <div className="flex items-start justify-between gap-2 px-1 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: stage.color }}
                        />
                        <h2 className="truncate text-xs font-black uppercase tracking-[0.08em]">
                          {stage.name}
                        </h2>
                      </div>
                      <p className="mt-1 text-[10px] text-[var(--mi-text-soft)]">
                        Probabilidade {stage.probability}%
                      </p>
                    </div>
                    <span className="grid h-6 min-w-6 place-items-center rounded-full bg-[var(--mi-bg)] px-1.5 text-[10px] font-black">
                      {byStage.get(stage.id)?.length ?? 0}
                    </span>
                  </div>
                  <div className="mt-2 min-h-[180px] space-y-3">
                    {(byStage.get(stage.id) ?? []).map((item) => {
                      const pending = activitiesByOpportunity.get(item.id) ?? [];
                      return (
                        <article
                          key={item.id}
                          draggable
                          onDragStart={() => setDraggingId(item.id)}
                          onDragEnd={() => setDraggingId(null)}
                          className="group rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-4 shadow-sm"
                        >
                          <div className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(item.id)}
                              onChange={() => toggleSelected(item.id)}
                              onClick={(event) => event.stopPropagation()}
                              className="mt-1 h-4 w-4"
                              aria-label={`Selecionar ${item.contact_name}`}
                            />
                            <button
                              onClick={() => openEdit(item)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <p className="truncate font-black">{item.contact_name}</p>
                              <p className="mt-1 truncate text-xs text-[var(--mi-text-muted)]">
                                {item.property_reference ||
                                  item.contact_phone ||
                                  "Sem imóvel informado"}
                              </p>
                            </button>
                            <GripVertical className="h-4 w-4 shrink-0 text-[var(--mi-text-soft)]" />
                          </div>
                          <button
                            onClick={() => openEdit(item)}
                            className="mt-3 block w-full text-left"
                          >
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="font-black text-blue-600">{money(item.value)}</span>
                              <span className="rounded-full bg-[var(--mi-surface)] px-2 py-1 text-[9px] font-black uppercase text-[var(--mi-text-soft)]">
                                {item.source}
                              </span>
                            </div>
                            <div className="mt-3 grid gap-1.5 text-[10px] text-[var(--mi-text-muted)]">
                              <span>Próxima ação: {when(item.next_action_at)}</span>
                              {pending[0] && (
                                <span className="font-bold text-amber-600">
                                  Tarefa: {pending[0].title}
                                </span>
                              )}
                            </div>
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}

        {panel === "funis" && (
          <FunnelPanel
            pipelines={workspace.data.pipelines}
            stages={workspace.data.stages}
            pipelineId={pipelineId}
            setPipelineId={setPipelineId}
            createPipeline={async (name, description) => {
              await pipelineFn({ data: { name, description } });
              await refresh();
            }}
            createStage={async (form) => {
              await stageFn({ data: { pipelineId, ...form } });
              await refresh();
            }}
            toggleStage={async (stage) => {
              await updateStageFn({
                data: {
                  id: stage.id,
                  name: stage.name,
                  probability: stage.probability,
                  statusType: stage.status_type,
                  color: stage.color,
                  isActive: !stage.is_active,
                },
              });
              await refresh();
            }}
          />
        )}

        {panel === "perdas" && (
          <SimplePanel
            title="Motivos da perda"
            description="Cadastre os motivos usados ao encerrar oportunidades perdidas."
          >
            <LossReasonPanel
              reasons={workspace.data.lossReasons}
              onCreate={async (name) => {
                await lossReasonFn({ data: { name } });
                await refresh();
              }}
              onToggle={async (id, isActive) => {
                await toggleLossReasonFn({ data: { id, isActive } });
                await refresh();
              }}
            />
          </SimplePanel>
        )}

        {panel === "importar" && (
          <SimplePanel
            title="Importações"
            description="Importe oportunidades em CSV sem alterar o restante da base."
          >
            <ImportPanel onChoose={() => fileInput.current?.click()} />
          </SimplePanel>
        )}

        {panel === "exportar" && (
          <SimplePanel
            title="Exportações"
            description="Exporte o funil atual em CSV para análise, backup ou integração."
          >
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => downloadCsv(opportunities, stages)}>
                <Download className="mr-2 h-4 w-4" /> Exportar funil atual ({opportunities.length})
              </Button>
              <Button
                variant="outline"
                onClick={() => downloadCsv(workspace.data.opportunities, workspace.data.stages)}
              >
                Exportar todas as oportunidades
              </Button>
            </div>
          </SimplePanel>
        )}

        {panel === "cadencias" && (
          <CadencePanel
            pipelineId={pipelineId}
            stages={stages}
            cadences={workspace.data.cadences.filter((item) => item.pipeline_id === pipelineId)}
            steps={workspace.data.cadenceSteps}
            onCreate={async (payload) => {
              await cadenceFn({ data: { pipelineId, ...payload } });
              await refresh();
            }}
            onAddStep={async (payload) => {
              await cadenceStepFn({ data: payload });
              await refresh();
            }}
            onToggle={async (id, isActive) => {
              await toggleCadenceFn({ data: { id, isActive } });
              await refresh();
            }}
          />
        )}

        {panel === "automacoes" && (
          <AutomationPanel
            pipelineId={pipelineId}
            stages={stages}
            automations={workspace.data.automations.filter(
              (item) => item.pipeline_id === pipelineId,
            )}
            onCreate={async (payload) => {
              await automationFn({ data: { pipelineId, ...payload } });
              await refresh();
            }}
            onToggle={async (id, isActive) => {
              await toggleAutomationFn({ data: { id, isActive } });
              await refresh();
            }}
          />
        )}

        {panel === "campos" && (
          <CustomFieldPanel
            fields={workspace.data.customFields}
            onCreate={async (payload) => {
              await customFieldFn({ data: payload });
              await refresh();
            }}
          />
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            const parsed = parseCsv(await file.text());
            const firstOpenStage = stages.find((stage) => stage.status_type === "open");
            if (!firstOpenStage)
              throw new Error("Funil sem etapa aberta para receber a importação.");
            const rows = parsed
              .map((row) => ({
                contactName: row.nome || row.name || row.cliente || row.contact_name || "",
                contactPhone: row.telefone || row.whatsapp || row.phone || row.contact_phone || "",
                contactEmail: row.email || row.contact_email || "",
                propertyReference: row.imovel || row.empreendimento || row.property_reference || "",
                source: row.origem || row.source || "importacao",
                value: row.valor
                  ? Number(
                      String(row.valor)
                        .replace(/[^0-9,.-]/g, "")
                        .replace(",", "."),
                    )
                  : null,
                notes: row.observacoes || row.notes || "",
              }))
              .filter((row) => row.contactName.trim().length >= 2)
              .slice(0, 500);
            if (!rows.length)
              throw new Error("Nenhuma linha válida. Inclua ao menos a coluna nome.");
            const result = await importFn({
              data: { pipelineId, stageId: firstOpenStage.id, rows },
            });
            toast.success(`${result.imported} oportunidade(s) importada(s).`);
            await refresh();
          } catch (error) {
            toast.error(String((error as Error)?.message ?? "Falha na importação."));
          }
        }}
      />

      <Dialog open={opportunityOpen} onOpenChange={setOpportunityOpen}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar oportunidade" : "Nova oportunidade"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cliente *">
              <Input
                value={opportunityForm.contactName}
                onChange={(event) =>
                  setOpportunityForm({ ...opportunityForm, contactName: event.target.value })
                }
              />
            </Field>
            <Field label="WhatsApp / telefone">
              <Input
                value={opportunityForm.contactPhone}
                onChange={(event) =>
                  setOpportunityForm({ ...opportunityForm, contactPhone: event.target.value })
                }
              />
            </Field>
            <Field label="E-mail">
              <Input
                type="email"
                value={opportunityForm.contactEmail}
                onChange={(event) =>
                  setOpportunityForm({ ...opportunityForm, contactEmail: event.target.value })
                }
              />
            </Field>
            <Field label="Imóvel / empreendimento">
              <Input
                value={opportunityForm.propertyReference}
                onChange={(event) =>
                  setOpportunityForm({ ...opportunityForm, propertyReference: event.target.value })
                }
              />
            </Field>
            <Field label="Valor da oportunidade">
              <Input
                inputMode="decimal"
                value={opportunityForm.value}
                onChange={(event) =>
                  setOpportunityForm({ ...opportunityForm, value: event.target.value })
                }
                placeholder="350000"
              />
            </Field>
            <Field label="Origem">
              <Input
                value={opportunityForm.source}
                onChange={(event) =>
                  setOpportunityForm({ ...opportunityForm, source: event.target.value })
                }
                placeholder="WhatsApp, indicação, portal..."
              />
            </Field>
            <Field label="Previsão de fechamento">
              <Input
                type="date"
                value={opportunityForm.expectedCloseDate}
                onChange={(event) =>
                  setOpportunityForm({ ...opportunityForm, expectedCloseDate: event.target.value })
                }
              />
            </Field>
            <Field label="Próxima ação">
              <Input
                type="datetime-local"
                value={opportunityForm.nextActionAt}
                onChange={(event) =>
                  setOpportunityForm({ ...opportunityForm, nextActionAt: event.target.value })
                }
              />
            </Field>
            {workspace.data.customFields
              .filter((field) => field.is_active)
              .map((field) => (
                <CustomFieldInput
                  key={field.id}
                  field={field}
                  value={opportunityForm.customValues[field.field_key]}
                  onChange={(value) =>
                    setOpportunityForm({
                      ...opportunityForm,
                      customValues: { ...opportunityForm.customValues, [field.field_key]: value },
                    })
                  }
                />
              ))}
            <div className="sm:col-span-2">
              <Field label="Observações">
                <Textarea
                  rows={4}
                  value={opportunityForm.notes}
                  onChange={(event) =>
                    setOpportunityForm({ ...opportunityForm, notes: event.target.value })
                  }
                />
              </Field>
            </div>
          </div>

          {editing && (activitiesByOpportunity.get(editing.id)?.length ?? 0) > 0 && (
            <section className="rounded-2xl border border-[var(--mi-border)] p-4">
              <h3 className="flex items-center gap-2 text-sm font-black">
                <ListChecks className="h-4 w-4 text-blue-600" /> Próximas atividades
              </h3>
              <div className="mt-3 space-y-2">
                {(activitiesByOpportunity.get(editing.id) ?? []).map((activity) => (
                  <div
                    key={activity.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-[var(--mi-bg)] p-3 text-xs"
                  >
                    <div>
                      <p className="font-black">{activity.title}</p>
                      <p className="mt-1 text-[var(--mi-text-muted)]">
                        {activity.kind} · {when(activity.due_at)} · {activity.source}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await completeActivityFn({ data: { id: activity.id } });
                        await refresh();
                      }}
                    >
                      Concluir
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpportunityOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={saving || opportunityForm.contactName.trim().length < 2}
              onClick={() => void saveOpportunity()}
            >
              {saving ? "Salvando..." : "Salvar oportunidade"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-4">
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
        <Icon className="h-4 w-4 text-blue-600" /> {label}
      </div>
      <p className="mt-3 text-2xl font-black">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function SimplePanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 sm:p-6">
      <h2 className="text-xl font-black">{title}</h2>
      <p className="mt-1 text-sm text-[var(--mi-text-muted)]">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function FunnelPanel({
  pipelines,
  stages,
  pipelineId,
  setPipelineId,
  createPipeline,
  createStage,
  toggleStage,
}: {
  pipelines: Array<{
    id: string;
    name: string;
    description: string | null;
    is_default: boolean;
    is_active: boolean;
  }>;
  stages: CrmStage[];
  pipelineId: string;
  setPipelineId: (id: string) => void;
  createPipeline: (name: string, description: string) => Promise<void>;
  createStage: (form: {
    name: string;
    probability: number;
    statusType: "open" | "won" | "lost";
    color: string;
  }) => Promise<void>;
  toggleStage: (stage: CrmStage) => Promise<void>;
}) {
  const [pipelineName, setPipelineName] = useState("");
  const [pipelineDescription, setPipelineDescription] = useState("");
  const [stageName, setStageName] = useState("");
  const [probability, setProbability] = useState(20);
  const [statusType, setStatusType] = useState<"open" | "won" | "lost">("open");
  const [color, setColor] = useState("#2563eb");
  const selectedStages = stages
    .filter((stage) => stage.pipeline_id === pipelineId)
    .sort((a, b) => a.position - b.position);

  return (
    <SimplePanel
      title="Funis e etapas"
      description="Crie funis por produto, região, equipe ou modelo de venda e personalize suas etapas."
    >
      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--mi-border)] p-4">
            <h3 className="font-black">Novo funil</h3>
            <div className="mt-3 space-y-3">
              <Input
                value={pipelineName}
                onChange={(event) => setPipelineName(event.target.value)}
                placeholder="Ex.: Lançamentos Joinville"
              />
              <Textarea
                value={pipelineDescription}
                onChange={(event) => setPipelineDescription(event.target.value)}
                placeholder="Descrição opcional"
              />
              <Button
                className="w-full"
                disabled={pipelineName.trim().length < 2}
                onClick={async () => {
                  await createPipeline(pipelineName, pipelineDescription);
                  setPipelineName("");
                  setPipelineDescription("");
                  toast.success("Funil criado com etapas iniciais.");
                }}
              >
                <Plus className="mr-2 h-4 w-4" /> Criar funil
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            {pipelines.map((pipeline) => (
              <button
                key={pipeline.id}
                onClick={() => setPipelineId(pipeline.id)}
                className={classNames(
                  "flex w-full items-center justify-between rounded-xl border p-3 text-left",
                  pipeline.id === pipelineId
                    ? "border-blue-300 bg-blue-50"
                    : "border-[var(--mi-border)]",
                )}
              >
                <div>
                  <p className="text-sm font-black">{pipeline.name}</p>
                  <p className="mt-1 text-[10px] text-[var(--mi-text-soft)]">
                    {pipeline.is_default ? "Funil padrão" : "Funil personalizado"}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="grid gap-3 rounded-2xl border border-[var(--mi-border)] p-4 md:grid-cols-5">
            <Input
              value={stageName}
              onChange={(event) => setStageName(event.target.value)}
              placeholder="Nome da etapa"
            />
            <Input
              type="number"
              min={0}
              max={100}
              value={probability}
              onChange={(event) => setProbability(Number(event.target.value))}
              placeholder="Prob. %"
            />
            <select
              value={statusType}
              onChange={(event) => setStatusType(event.target.value as typeof statusType)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="open">Aberta</option>
              <option value="won">Ganha</option>
              <option value="lost">Perdida</option>
            </select>
            <Input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
            <Button
              disabled={stageName.trim().length < 2}
              onClick={async () => {
                await createStage({ name: stageName, probability, statusType, color });
                setStageName("");
                toast.success("Etapa adicionada.");
              }}
            >
              Adicionar etapa
            </Button>
          </div>
          <div className="mt-4 space-y-2">
            {selectedStages.map((stage) => (
              <div
                key={stage.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-3"
              >
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: stage.color }} />
                  <div>
                    <p className="text-sm font-black">{stage.name}</p>
                    <p className="mt-1 text-[10px] text-[var(--mi-text-soft)]">
                      {stage.status_type} · {stage.probability}% · posição {stage.position}
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => void toggleStage(stage)}>
                  {stage.is_active ? "Desativar" : "Ativar"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SimplePanel>
  );
}

function LossReasonPanel({
  reasons,
  onCreate,
  onToggle,
}: {
  reasons: Array<{ id: string; name: string; is_active: boolean }>;
  onCreate: (name: string) => Promise<void>;
  onToggle: (id: string, isActive: boolean) => Promise<void>;
}) {
  const [name, setName] = useState("");
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Novo motivo de perda"
        />
        <Button
          disabled={name.trim().length < 2}
          onClick={async () => {
            await onCreate(name);
            setName("");
            toast.success("Motivo cadastrado.");
          }}
        >
          Cadastrar
        </Button>
      </div>
      <div className="divide-y divide-[var(--mi-border)] rounded-2xl border border-[var(--mi-border)]">
        {reasons.map((reason) => (
          <div key={reason.id} className="flex items-center justify-between gap-3 p-3">
            <span className={classNames("text-sm font-bold", !reason.is_active && "opacity-50")}>
              {reason.name}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onToggle(reason.id, !reason.is_active)}
            >
              {reason.is_active ? "Desativar" : "Ativar"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ImportPanel({ onChoose }: { onChoose: () => void }) {
  return (
    <div className="max-w-3xl rounded-2xl border border-dashed border-blue-300 bg-blue-50 p-8 text-center">
      <Upload className="mx-auto h-9 w-9 text-blue-600" />
      <h3 className="mt-3 font-black text-blue-950">Importar oportunidades por CSV</h3>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-blue-800">
        Colunas aceitas: nome, telefone/WhatsApp, email, imóvel/empreendimento, origem, valor e
        observações. Até 500 linhas por importação. As oportunidades entram na primeira etapa aberta
        do funil selecionado.
      </p>
      <Button className="mt-5" onClick={onChoose}>
        Selecionar arquivo CSV
      </Button>
    </div>
  );
}

function CadencePanel({
  pipelineId,
  stages,
  cadences,
  steps,
  onCreate,
  onAddStep,
  onToggle,
}: {
  pipelineId: string;
  stages: CrmStage[];
  cadences: Array<{ id: string; name: string; stage_id: string | null; is_active: boolean }>;
  steps: Array<{
    id: string;
    cadence_id: string;
    delay_minutes: number;
    action_type: "task" | "call" | "whatsapp" | "email";
    title: string;
    message_template: string | null;
    position: number;
  }>;
  onCreate: (payload: { name: string; stageId: string | null }) => Promise<void>;
  onAddStep: (payload: {
    cadenceId: string;
    delayMinutes: number;
    actionType: "task" | "call" | "whatsapp" | "email";
    title: string;
    messageTemplate: string;
  }) => Promise<void>;
  onToggle: (id: string, isActive: boolean) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [stageId, setStageId] = useState("");
  const [cadenceId, setCadenceId] = useState("");
  const [delayMinutes, setDelayMinutes] = useState(1440);
  const [actionType, setActionType] = useState<"task" | "call" | "whatsapp" | "email">("task");
  const [title, setTitle] = useState("");
  const [messageTemplate, setMessageTemplate] = useState("");
  void pipelineId;
  return (
    <SimplePanel
      title="Cadência de funil"
      description="Ao entrar em uma etapa, o sistema agenda automaticamente tarefas, ligações, WhatsApp ou e-mail conforme os passos configurados."
    >
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-2xl border border-[var(--mi-border)] p-4">
          <h3 className="font-black">Nova cadência</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Follow-up visita"
            />
            <select
              value={stageId}
              onChange={(event) => setStageId(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Todas as etapas</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </div>
          <Button
            className="mt-3"
            disabled={name.trim().length < 2}
            onClick={async () => {
              await onCreate({ name, stageId: stageId || null });
              setName("");
              toast.success("Cadência criada.");
            }}
          >
            Criar cadência
          </Button>
        </div>

        <div className="rounded-2xl border border-[var(--mi-border)] p-4">
          <h3 className="font-black">Adicionar passo</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <select
              value={cadenceId}
              onChange={(event) => setCadenceId(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Selecione a cadência</option>
              {cadences.map((cadence) => (
                <option key={cadence.id} value={cadence.id}>
                  {cadence.name}
                </option>
              ))}
            </select>
            <select
              value={actionType}
              onChange={(event) => setActionType(event.target.value as typeof actionType)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="task">Tarefa</option>
              <option value="call">Ligação</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
            </select>
            <Input
              type="number"
              min={0}
              value={delayMinutes}
              onChange={(event) => setDelayMinutes(Number(event.target.value))}
              placeholder="Atraso em minutos"
            />
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Título da ação"
            />
            <Textarea
              className="sm:col-span-2"
              value={messageTemplate}
              onChange={(event) => setMessageTemplate(event.target.value)}
              placeholder="Mensagem/modelo opcional"
            />
          </div>
          <Button
            className="mt-3"
            disabled={!cadenceId || title.trim().length < 2}
            onClick={async () => {
              await onAddStep({ cadenceId, delayMinutes, actionType, title, messageTemplate });
              setTitle("");
              setMessageTemplate("");
              toast.success("Passo adicionado.");
            }}
          >
            Adicionar passo
          </Button>
        </div>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {cadences.map((cadence) => (
          <div
            key={cadence.id}
            className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-black">{cadence.name}</p>
                <p className="mt-1 text-[10px] text-[var(--mi-text-soft)]">
                  {stages.find((stage) => stage.id === cadence.stage_id)?.name ?? "Todas as etapas"}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void onToggle(cadence.id, !cadence.is_active)}
              >
                {cadence.is_active ? "Ativa" : "Inativa"}
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              {steps
                .filter((step) => step.cadence_id === cadence.id)
                .sort((a, b) => a.position - b.position)
                .map((step) => (
                  <div key={step.id} className="rounded-xl bg-[var(--mi-surface)] p-3 text-xs">
                    <p className="font-black">{step.title}</p>
                    <p className="mt-1 text-[var(--mi-text-muted)]">
                      {step.action_type} · após {step.delay_minutes} min
                    </p>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </SimplePanel>
  );
}

function AutomationPanel({
  pipelineId,
  stages,
  automations,
  onCreate,
  onToggle,
}: {
  pipelineId: string;
  stages: CrmStage[];
  automations: Array<{
    id: string;
    name: string;
    stage_id: string | null;
    trigger_event: "created" | "stage_entered";
    action_type: "create_task" | "schedule_followup" | "set_probability";
    action_config: Record<string, unknown>;
    is_active: boolean;
  }>;
  onCreate: (payload: {
    name: string;
    stageId: string | null;
    triggerEvent: "created" | "stage_entered";
    actionType: "create_task" | "schedule_followup" | "set_probability";
    delayMinutes: number;
    title: string;
    value?: number;
  }) => Promise<void>;
  onToggle: (id: string, isActive: boolean) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [stageId, setStageId] = useState("");
  const [triggerEvent, setTriggerEvent] = useState<"created" | "stage_entered">("stage_entered");
  const [actionType, setActionType] = useState<
    "create_task" | "schedule_followup" | "set_probability"
  >("create_task");
  const [delayMinutes, setDelayMinutes] = useState(0);
  const [title, setTitle] = useState("");
  const [value, setValue] = useState(50);
  void pipelineId;
  return (
    <SimplePanel
      title="Ações automáticas"
      description="Regras executadas pelo backend quando uma oportunidade é criada ou entra em determinada etapa."
    >
      <div className="grid gap-3 rounded-2xl border border-[var(--mi-border)] p-4 lg:grid-cols-4">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Nome da automação"
        />
        <select
          value={stageId}
          onChange={(event) => setStageId(event.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Qualquer etapa</option>
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
        <select
          value={triggerEvent}
          onChange={(event) => setTriggerEvent(event.target.value as typeof triggerEvent)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="created">Ao criar oportunidade</option>
          <option value="stage_entered">Ao entrar na etapa</option>
        </select>
        <select
          value={actionType}
          onChange={(event) => setActionType(event.target.value as typeof actionType)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="create_task">Criar tarefa</option>
          <option value="schedule_followup">Agendar follow-up</option>
          <option value="set_probability">Definir probabilidade</option>
        </select>
        {actionType !== "set_probability" && (
          <Input
            type="number"
            min={0}
            value={delayMinutes}
            onChange={(event) => setDelayMinutes(Number(event.target.value))}
            placeholder="Atraso em minutos"
          />
        )}
        {actionType === "create_task" && (
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Título da tarefa"
          />
        )}
        {actionType === "set_probability" && (
          <Input
            type="number"
            min={0}
            max={100}
            value={value}
            onChange={(event) => setValue(Number(event.target.value))}
            placeholder="Probabilidade"
          />
        )}
        <Button
          disabled={name.trim().length < 2}
          onClick={async () => {
            await onCreate({
              name,
              stageId: stageId || null,
              triggerEvent,
              actionType,
              delayMinutes,
              title,
              ...(actionType === "set_probability" ? { value } : {}),
            });
            setName("");
            setTitle("");
            toast.success("Automação criada.");
          }}
        >
          Criar automação
        </Button>
      </div>
      <div className="mt-4 space-y-2">
        {automations.map((automation) => (
          <div
            key={automation.id}
            className="flex flex-col justify-between gap-3 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-3 sm:flex-row sm:items-center"
          >
            <div>
              <p className="text-sm font-black">{automation.name}</p>
              <p className="mt-1 text-[10px] text-[var(--mi-text-soft)]">
                {automation.trigger_event} → {automation.action_type} ·{" "}
                {stages.find((stage) => stage.id === automation.stage_id)?.name ?? "qualquer etapa"}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onToggle(automation.id, !automation.is_active)}
            >
              {automation.is_active ? "Ativa" : "Inativa"}
            </Button>
          </div>
        ))}
      </div>
    </SimplePanel>
  );
}

function CustomFieldPanel({
  fields,
  onCreate,
}: {
  fields: CrmCustomField[];
  onCreate: (payload: {
    key: string;
    label: string;
    fieldType: "text" | "number" | "date" | "select" | "boolean";
    options: string[];
    isRequired: boolean;
  }) => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<"text" | "number" | "date" | "select" | "boolean">(
    "text",
  );
  const [options, setOptions] = useState("");
  const [isRequired, setIsRequired] = useState(false);
  return (
    <SimplePanel
      title="Campos customizados"
      description="Adicione informações específicas ao seu processo comercial imobiliário, como renda, entrada, FGTS, construtora ou temperatura do lead."
    >
      <div className="grid gap-3 rounded-2xl border border-[var(--mi-border)] p-4 lg:grid-cols-5">
        <Input
          value={label}
          onChange={(event) => {
            const next = event.target.value;
            setLabel(next);
            if (!key) setKey(normalizeHeader(next));
          }}
          placeholder="Nome do campo"
        />
        <Input
          value={key}
          onChange={(event) => setKey(normalizeHeader(event.target.value))}
          placeholder="chave_do_campo"
        />
        <select
          value={fieldType}
          onChange={(event) => setFieldType(event.target.value as typeof fieldType)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="text">Texto</option>
          <option value="number">Número</option>
          <option value="date">Data</option>
          <option value="select">Lista</option>
          <option value="boolean">Sim/Não</option>
        </select>
        <Input
          value={options}
          onChange={(event) => setOptions(event.target.value)}
          placeholder="Opções separadas por vírgula"
          disabled={fieldType !== "select"}
        />
        <Button
          disabled={label.trim().length < 2 || key.trim().length < 2}
          onClick={async () => {
            await onCreate({
              key,
              label,
              fieldType,
              options: options
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
              isRequired,
            });
            setKey("");
            setLabel("");
            setOptions("");
            setIsRequired(false);
            toast.success("Campo customizado criado.");
          }}
        >
          Criar campo
        </Button>
        <label className="flex items-center gap-2 text-xs font-bold">
          <input
            type="checkbox"
            checked={isRequired}
            onChange={(event) => setIsRequired(event.target.checked)}
          />{" "}
          Obrigatório
        </label>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {fields.map((field) => (
          <div
            key={field.id}
            className="rounded-xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-3"
          >
            <p className="text-sm font-black">{field.label}</p>
            <p className="mt-1 text-[10px] text-[var(--mi-text-soft)]">
              {field.field_key} · {field.field_type} {field.is_required ? "· obrigatório" : ""}
            </p>
          </div>
        ))}
      </div>
    </SimplePanel>
  );
}

function CustomFieldInput({
  field,
  value,
  onChange,
}: {
  field: CrmCustomField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (field.field_type === "boolean") {
    return (
      <Field label={`${field.label}${field.is_required ? " *" : ""}`}>
        <select
          value={value === true ? "sim" : value === false ? "nao" : ""}
          onChange={(event) =>
            onChange(event.target.value === "" ? null : event.target.value === "sim")
          }
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Não informado</option>
          <option value="sim">Sim</option>
          <option value="nao">Não</option>
        </select>
      </Field>
    );
  }
  if (field.field_type === "select") {
    return (
      <Field label={`${field.label}${field.is_required ? " *" : ""}`}>
        <select
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Selecione</option>
          {(Array.isArray(field.options) ? field.options : []).map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  return (
    <Field label={`${field.label}${field.is_required ? " *" : ""}`}>
      <Input
        type={
          field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"
        }
        value={String(value ?? "")}
        onChange={(event) =>
          onChange(field.field_type === "number" ? Number(event.target.value) : event.target.value)
        }
      />
    </Field>
  );
}
