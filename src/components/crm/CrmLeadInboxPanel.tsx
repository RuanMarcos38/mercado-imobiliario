import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArchiveRestore,
  CheckCircle2,
  Flame,
  MessageCircle,
  Search,
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

  const [filter, setFilter] = useState<Filter>("active");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CrmLeadInboxItem | null>(null);
  const [form, setForm] = useState<LeadForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);

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
      if (!byFilter) return false;
      if (!query) return true;
      return [lead.contact_name, lead.contact_phone, lead.protocol_code, lead.city, lead.interest]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [filter, leads.data, search]);

  const metrics = useMemo(() => {
    const data = leads.data ?? [];
    return {
      active: data.filter((lead) => ["new", "qualifying", "qualified"].includes(lead.status)).length,
      hot: data.filter((lead) => lead.temperature === "hot" && lead.status !== "discarded").length,
      qualified: data.filter((lead) => lead.status === "qualified").length,
      discarded: data.filter((lead) => lead.status === "discarded").length,
    };
  }, [leads.data]);

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
    return <div className="p-8 text-sm text-[var(--mi-text-soft)]">Carregando caixa de leads...</div>;
  }

  if (leads.error) {
    return (
      <div className="m-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
        Não foi possível carregar a caixa de leads.
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-600">
            Pré-Pipeline
          </p>
          <h1 className="mt-2 text-3xl font-black">Caixa de Leads</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--mi-text-muted)]">
            Conversas entram primeiro aqui. O Pipeline recebe somente leads qualificados e
            convertidos de forma controlada, evitando oportunidades sem contexto ou de outra
            conexão.
          </p>
        </div>
        <div className="relative w-full xl:w-[380px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--mi-text-soft)]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar nome, telefone, protocolo ou interesse..."
            className="pl-9"
          />
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Leads ativos" value={metrics.active} icon={Sparkles} />
        <Metric label="Leads quentes" value={metrics.hot} icon={Flame} />
        <Metric label="Qualificados" value={metrics.qualified} icon={UserCheck} />
        <Metric label="Descartados" value={metrics.discarded} icon={Trash2} />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {[
          ["active", "Ativos"],
          ["hot", "Quentes"],
          ["qualified", "Qualificados"],
          ["discarded", "Descartados"],
          ["all", "Todos"],
        ].map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? "default" : "outline"}
            className="shrink-0 rounded-xl"
            onClick={() => setFilter(value as Filter)}
          >
            {label}
          </Button>
        ))}
      </div>

      {rows.length ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {rows.map((lead) => (
            <article
              key={lead.id}
              className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-black">{lead.contact_name}</p>
                  <p className="mt-1 text-xs text-[var(--mi-text-muted)]">
                    {lead.contact_phone || "Sem telefone"}
                  </p>
                  {lead.protocol_code && (
                    <p className="mt-1 text-[10px] font-black uppercase tracking-[0.08em] text-blue-600">
                      {lead.protocol_code}
                    </p>
                  )}
                </div>
                <div
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-black ${temperatureClasses(lead.temperature)}`}
                >
                  <TemperatureIcon value={lead.temperature} />
                  {lead.score}/100
                </div>
              </div>

              <div className="mt-4 rounded-xl bg-[var(--mi-bg)] p-3">
                <p className="line-clamp-2 text-sm leading-5 text-[var(--mi-text-muted)]">
                  {lead.last_message || "Lead capturado sem mensagem resumida."}
                </p>
                <p className="mt-2 text-[10px] text-[var(--mi-text-soft)]">
                  Última atividade: {when(lead.last_activity_at)}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black">
                <span className="rounded-lg border border-[var(--mi-border)] px-2 py-1">
                  {statusLabel(lead.status)}
                </span>
                {lead.city && (
                  <span className="rounded-lg border border-[var(--mi-border)] px-2 py-1">
                    {lead.city}
                  </span>
                )}
                {lead.property_type && (
                  <span className="rounded-lg border border-[var(--mi-border)] px-2 py-1">
                    {lead.property_type}
                  </span>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => openLead(lead)}>
                  <UserCheck className="h-4 w-4" />
                  Qualificar
                </Button>
                {lead.conversation_id && (
                  <Button size="sm" variant="outline" onClick={() => openConversation(lead)}>
                    <MessageCircle className="h-4 w-4" />
                    Conversa
                  </Button>
                )}
                {lead.status === "discarded" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await restoreFn({ data: { id: lead.id } });
                      toast.success("Lead restaurado.");
                      await leads.refetch();
                    }}
                  >
                    <ArchiveRestore className="h-4 w-4" />
                    Restaurar
                  </Button>
                ) : lead.status !== "converted" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await discardFn({ data: { id: lead.id } });
                      toast.success("Lead descartado da fila ativa.");
                      await leads.refetch();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Descartar
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--mi-border)] bg-[var(--mi-surface)] py-16 text-center">
          <Sparkles className="mx-auto h-9 w-9 text-[var(--mi-text-soft)]" />
          <p className="mt-3 font-black">Nenhum lead nesta visualização</p>
          <p className="mt-1 text-sm text-[var(--mi-text-soft)]">
            Novos contatos válidos do WhatsApp entram aqui antes do Pipeline.
          </p>
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
                  <Check
                    ok={Boolean(form.city.trim())}
                    label="Cidade de interesse"
                  />
                  <Check
                    ok={Boolean(form.propertyType.trim())}
                    label="Tipo de imóvel"
                  />
                  <Check ok={Boolean(form.interest.trim())} label="Interesse / perfil" />
                  <Check
                    ok={Boolean(form.income || form.downPayment)}
                    label="Renda ou entrada"
                  />
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
