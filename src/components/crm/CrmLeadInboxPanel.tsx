import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArchiveRestore,
  CheckCircle2,
  Flame,
  Download,
  Mail,
  MessageCircle,
  MoreVertical,
  Phone,
  SlidersHorizontal,
  Snowflake,
  Sparkles,
  ThermometerSun,
  Trash2,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  convertCrmLeadToOpportunity,
  discardCrmLead,
  listCrmLeadInbox,
  restoreCrmLead,
  updateCrmLeadQualification,
  type CrmLeadInboxItem,
  type CrmLeadInboxStatus,
} from "@/lib/crm-lead-inbox.functions";

type Filter = "active" | "hot" | "qualified" | "discarded" | "all";

type LeadForm = {
  contactName: string;
  contactEmail: string;
  city: string;
  neighborhood: string;
  propertyType: string;
  interest: string;
  income: string;
  downPayment: string;
  hasFgts: "" | "yes" | "no";
  creditStatus: string;
  notes: string;
};

const emptyForm: LeadForm = {
  contactName: "",
  contactEmail: "",
  city: "",
  neighborhood: "",
  propertyType: "",
  interest: "",
  income: "",
  downPayment: "",
  hasFgts: "",
  creditStatus: "",
  notes: "",
};

function formFromLead(lead: CrmLeadInboxItem): LeadForm {
  return {
    contactName: lead.contact_name || "",
    contactEmail: lead.contact_email || "",
    city: lead.city || "",
    neighborhood: lead.neighborhood || "",
    propertyType: lead.property_type || "",
    interest: lead.interest || "",
    income: lead.income == null ? "" : String(lead.income),
    downPayment: lead.down_payment == null ? "" : String(lead.down_payment),
    hasFgts: lead.has_fgts == null ? "" : lead.has_fgts ? "yes" : "no",
    creditStatus: lead.credit_status || "",
    notes: lead.notes || "",
  };
}

function money(value: number | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
}

function when(value: string | null) {
  if (!value) return "Sem atividade";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "LE";
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function statusLabel(status: CrmLeadInboxStatus) {
  return {
    new: "Novo",
    qualifying: "Em qualificação",
    qualified: "Qualificado",
    discarded: "Descartado",
    converted: "Convertido",
  }[status];
}

function temperatureClasses(temperature: CrmLeadInboxItem["temperature"]) {
  if (temperature === "hot") return "border-rose-200 bg-rose-50 text-rose-700";
  if (temperature === "warm") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function TemperatureIcon({ value }: { value: CrmLeadInboxItem["temperature"] }) {
  if (value === "hot") return <Flame className="h-4 w-4" />;
  if (value === "warm") return <ThermometerSun className="h-4 w-4" />;
  return <Snowflake className="h-4 w-4" />;
}

export function CrmLeadInboxPanel() {
  const navigate = useNavigate();
  const listFn = useServerFn(listCrmLeadInbox);
  const updateFn = useServerFn(updateCrmLeadQualification);
  const discardFn = useServerFn(discardCrmLead);
  const restoreFn = useServerFn(restoreCrmLead);
  const convertFn = useServerFn(convertCrmLeadToOpportunity);

  const leads = useQuery({
    queryKey: ["crm-lead-inbox"],
    queryFn: () => listFn(),
    refetchInterval: 60_000,
  });

  const [filter, setFilter] = useState<Filter>("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CrmLeadInboxItem | null>(null);
  const [form, setForm] = useState<LeadForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    const handler = (event: Event) => {
      const next = String((event as CustomEvent<string>).detail ?? "");
      setSearch(next);
    };
    window.addEventListener("mercadoimobi:crm-search", handler);
    return () => window.removeEventListener("mercadoimobi:crm-search", handler);
  }, []);

  const sources = useMemo(
    () =>
      [...new Set((leads.data ?? []).map((lead) => lead.source).filter(Boolean))].sort((a, b) =>
        String(a).localeCompare(String(b)),
      ),
    [leads.data],
  );

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (leads.data ?? []).filter((lead) => {
      const byFilter =
        filter === "all"
          ? true
          : filter === "active"
            ? ["new", "qualifying", "qualified"].includes(lead.status)
            : filter === "hot"
              ? lead.temperature === "hot" && lead.status !== "discarded"
              : filter === "qualified"
                ? lead.status === "qualified"
                : lead.status === "discarded";
      const bySource = sourceFilter === "all" || lead.source === sourceFilter;
      if (!byFilter || !bySource) return false;
      if (!query) return true;
      return [
        lead.contact_name,
        lead.contact_phone,
        lead.contact_email,
        lead.protocol_code,
        lead.city,
        lead.interest,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [filter, leads.data, search, sourceFilter]);

  const boardColumns = useMemo(() => {
    const discardedMode = filter === "discarded";
    return [
      {
        id: "new",
        label: discardedMode ? "Descartados" : "Novo",
        tone: "orange",
        items: discardedMode
          ? rows.filter((lead) => lead.status === "discarded")
          : rows.filter((lead) => lead.status === "new"),
      },
      {
        id: "open",
        label: "Aberto",
        tone: "blue",
        items: discardedMode ? [] : rows.filter((lead) => lead.status === "qualifying"),
      },
      {
        id: "progress",
        label: "Em andamento",
        tone: "yellow",
        items: discardedMode ? [] : rows.filter((lead) => lead.status === "qualified"),
      },
      {
        id: "deal",
        label: "Negócio aberto",
        tone: "cyan",
        items: discardedMode
          ? []
          : rows.filter((lead) => lead.status === "converted" || lead.status === "discarded"),
      },
    ];
  }, [filter, rows]);

  const exportVisibleLeads = () => {
    const header = [
      "Nome",
      "Telefone",
      "E-mail",
      "Status",
      "Score",
      "Origem",
      "Cidade",
      "Interesse",
    ];
    const csv = [
      header,
      ...rows.map((lead) => [
        lead.contact_name,
        lead.contact_phone ?? "",
        lead.contact_email ?? "",
        statusLabel(lead.status),
        String(lead.score),
        lead.source,
        lead.city ?? "",
        lead.interest ?? "",
      ]),
    ]
      .map((line) => line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mercadoimobi-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const openLead = (lead: CrmLeadInboxItem) => {
    setSelected(lead);
    setForm(formFromLead(lead));
  };

  const refresh = async () => {
    const refreshed = await leads.refetch();
    if (selected) {
      const next = refreshed.data?.find((lead) => lead.id === selected.id) ?? null;
      setSelected(next);
      if (next) setForm(formFromLead(next));
    }
  };

  const save = async () => {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const result = await updateFn({
        data: {
          id: selected.id,
          contactName: form.contactName.trim(),
          contactEmail: form.contactEmail.trim() || null,
          city: form.city.trim() || null,
          neighborhood: form.neighborhood.trim() || null,
          propertyType: form.propertyType.trim() || null,
          interest: form.interest.trim() || null,
          income: form.income ? Number(form.income.replace(",", ".")) : null,
          downPayment: form.downPayment ? Number(form.downPayment.replace(",", ".")) : null,
          hasFgts: form.hasFgts === "" ? null : form.hasFgts === "yes",
          creditStatus: form.creditStatus.trim() || null,
          notes: form.notes.trim() || null,
        },
      });
      toast.success(
        result.ready
          ? `Lead qualificado · score ${result.score}/100`
          : `Qualificação salva · score ${result.score}/100`,
      );
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o lead.");
    } finally {
      setSaving(false);
    }
  };

  const convert = async () => {
    if (!selected || converting) return;
    setConverting(true);
    try {
      await save();
      const result = await convertFn({ data: { id: selected.id } });
      toast.success("Lead convertido em oportunidade do Pipeline.");
      setSelected(null);
      await leads.refetch();
      void result;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível converter o lead.");
    } finally {
      setConverting(false);
    }
  };

  const openConversation = (lead: CrmLeadInboxItem) => {
    if (!lead.conversation_id) return;
    sessionStorage.setItem("mercadoimobi:selectedConversation", lead.conversation_id);
    void navigate({ to: "/atendimento" });
  };

  if (leads.isLoading) {
    return (
      <div className="p-8 text-sm text-[var(--mi-text-soft)]">Carregando caixa de leads...</div>
    );
  }

  if (leads.error) {
    return (
      <div className="m-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
        Não foi possível carregar a caixa de leads.
      </div>
    );
  }

  return (
    <div className="crm-template-leads">
      <header className="crm-template-page-head">
        <div>
          <h1>Leads</h1>
          <p>Pré-Pipeline de atendimento e qualificação imobiliária</p>
        </div>
        <Button className="crm-template-export" onClick={exportVisibleLeads}>
          <Download />
          Exportar
        </Button>
      </header>

      <div className="crm-template-filterbar">
        <div className="crm-template-filter-selects">
          <label>
            <span>Status</span>
            <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
              <option value="all">Todos os status</option>
              <option value="active">Ativos</option>
              <option value="hot">Quentes</option>
              <option value="qualified">Qualificados</option>
              <option value="discarded">Descartados</option>
            </select>
          </label>
          <label>
            <span>Origem</span>
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
              <option value="all">Todas as origens</option>
              {sources.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" className="crm-template-filter-button">
          <SlidersHorizontal />
          Filtrar
        </button>
      </div>

      {rows.length ? (
        <div className="crm-template-board">
          {boardColumns.map((column) => (
            <section key={column.id} className="crm-template-column">
              <header className="crm-template-column-head">
                <div>
                  <span className={`crm-template-column-dot is-${column.tone}`} />
                  <strong>{column.label}</strong>
                </div>
                <span>{column.items.length} Leads</span>
              </header>

              <div className="crm-template-column-list">
                {column.items.map((lead) => (
                  <article key={lead.id} className="crm-template-lead-card">
                    <div className="crm-template-lead-card-head">
                      <button
                        type="button"
                        onClick={() => openLead(lead)}
                        className="crm-template-card-avatar"
                        aria-label={"Abrir lead " + lead.contact_name}
                      >
                        <span>{initials(lead.contact_name || "Lead")}</span>
                        {lead.avatar_url && (
                          <img
                            src={lead.avatar_url}
                            alt=""
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                          />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => openLead(lead)}
                        className="crm-template-lead-card-title"
                      >
                        <strong>{lead.contact_name}</strong>
                        <span>{when(lead.last_activity_at)}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => openLead(lead)}
                        className="crm-template-kebab"
                        aria-label="Abrir detalhes do lead"
                      >
                        <MoreVertical />
                      </button>
                    </div>

                    <div className="crm-template-contact-lines">
                      <span>
                        <Phone />
                        {lead.contact_phone || "Telefone não informado"}
                      </span>
                      <span>
                        <Mail />
                        {lead.contact_email || "E-mail não informado"}
                      </span>
                    </div>

                    <div className="crm-template-card-footer">
                      <span className={`crm-template-status-pill is-${lead.status}`}>
                        {statusLabel(lead.status)}
                      </span>
                      <span className="crm-template-score">{lead.score}/100</span>
                    </div>

                    <div className="crm-template-hover-actions">
                      <button type="button" onClick={() => openLead(lead)}>
                        <UserCheck />
                        Qualificar
                      </button>
                      {lead.conversation_id && (
                        <button type="button" onClick={() => openConversation(lead)}>
                          <MessageCircle />
                          Conversa
                        </button>
                      )}
                      {lead.status === "discarded" ? (
                        <button
                          type="button"
                          onClick={async () => {
                            await restoreFn({ data: { id: lead.id } });
                            toast.success("Lead restaurado.");
                            await leads.refetch();
                          }}
                        >
                          <ArchiveRestore />
                          Restaurar
                        </button>
                      ) : lead.status !== "converted" ? (
                        <button
                          type="button"
                          onClick={async () => {
                            await discardFn({ data: { id: lead.id } });
                            toast.success("Lead descartado da fila ativa.");
                            await leads.refetch();
                          }}
                        >
                          <Trash2 />
                          Descartar
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="crm-template-empty">
          <Sparkles />
          <strong>Nenhum lead nesta visualização</strong>
          <span>Novos contatos válidos do WhatsApp entram aqui antes do Pipeline.</span>
        </div>
      )}

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Qualificação do lead</DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-5">
              <div className="grid gap-3 rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-4 sm:grid-cols-3">
                <Info label="Score" value={`${selected.score}/100`} />
                <Info label="Temperatura" value={selected.temperature.toUpperCase()} />
                <Info label="Etapa" value={statusLabel(selected.status)} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nome *">
                  <Input
                    value={form.contactName}
                    onChange={(event) => setForm({ ...form, contactName: event.target.value })}
                  />
                </Field>
                <Field label="E-mail">
                  <Input
                    type="email"
                    value={form.contactEmail}
                    onChange={(event) => setForm({ ...form, contactEmail: event.target.value })}
                  />
                </Field>
                <Field label="Cidade de interesse *">
                  <Input
                    value={form.city}
                    onChange={(event) => setForm({ ...form, city: event.target.value })}
                  />
                </Field>
                <Field label="Bairro / região">
                  <Input
                    value={form.neighborhood}
                    onChange={(event) => setForm({ ...form, neighborhood: event.target.value })}
                  />
                </Field>
                <Field label="Tipo de imóvel *">
                  <Input
                    value={form.propertyType}
                    onChange={(event) => setForm({ ...form, propertyType: event.target.value })}
                    placeholder="Apartamento, casa, terreno..."
                  />
                </Field>
                <Field label="Interesse / perfil *">
                  <Input
                    value={form.interest}
                    onChange={(event) => setForm({ ...form, interest: event.target.value })}
                    placeholder="2 quartos, região, empreendimento..."
                  />
                </Field>
                <Field label="Renda familiar">
                  <Input
                    inputMode="decimal"
                    value={form.income}
                    onChange={(event) => setForm({ ...form, income: event.target.value })}
                    placeholder="Ex.: 6500"
                  />
                </Field>
                <Field label="Entrada disponível">
                  <Input
                    inputMode="decimal"
                    value={form.downPayment}
                    onChange={(event) => setForm({ ...form, downPayment: event.target.value })}
                    placeholder="Ex.: 30000"
                  />
                </Field>
                <Field label="Possui FGTS?">
                  <select
                    value={form.hasFgts}
                    onChange={(event) =>
                      setForm({ ...form, hasFgts: event.target.value as LeadForm["hasFgts"] })
                    }
                    className="h-10 w-full rounded-md border border-[var(--mi-border)] bg-[var(--mi-surface)] px-3 text-sm"
                  >
                    <option value="">Não informado</option>
                    <option value="yes">Sim</option>
                    <option value="no">Não</option>
                  </select>
                </Field>
                <Field label="Status de crédito">
                  <Input
                    value={form.creditStatus}
                    onChange={(event) => setForm({ ...form, creditStatus: event.target.value })}
                    placeholder="Não analisado, pré-aprovado..."
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Observações">
                    <Textarea
                      rows={4}
                      value={form.notes}
                      onChange={(event) => setForm({ ...form, notes: event.target.value })}
                    />
                  </Field>
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                <p className="font-black">Regra para entrar no Pipeline</p>
                <p className="mt-1 leading-6">
                  Informe cidade, tipo de imóvel, interesse e pelo menos renda ou entrada. Depois
                  disso o lead fica qualificado e pode ser convertido em oportunidade.
                </p>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <Check ok={Boolean(form.city.trim())} label="Cidade de interesse" />
                  <Check ok={Boolean(form.propertyType.trim())} label="Tipo de imóvel" />
                  <Check ok={Boolean(form.interest.trim())} label="Interesse / perfil" />
                  <Check ok={Boolean(form.income || form.downPayment)} label="Renda ou entrada" />
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <div className="text-xs text-[var(--mi-text-soft)]">
                  Telefone: {selected.contact_phone || "não informado"} · Origem: {selected.source}
                  <br />
                  Renda: {money(selected.income)} · Entrada: {money(selected.down_payment)}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" disabled={saving} onClick={() => void save()}>
                    {saving ? "Salvando..." : "Salvar qualificação"}
                  </Button>
                  <Button
                    disabled={saving || converting || selected.status === "discarded"}
                    onClick={() => void convert()}
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {converting ? "Convertendo..." : "Converter para oportunidade"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Sparkles;
}) {
  return (
    <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-4">
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
        <Icon className="h-4 w-4 text-emerald-600" />
        {label}
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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
        {label}
      </p>
      <p className="mt-1 font-black">{value}</p>
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`grid h-5 w-5 place-items-center rounded-full ${ok ? "bg-emerald-600 text-white" : "border border-emerald-300 bg-white text-emerald-700"}`}
      >
        {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : "·"}
      </span>
      <span className={ok ? "font-bold" : ""}>{label}</span>
    </div>
  );
}
