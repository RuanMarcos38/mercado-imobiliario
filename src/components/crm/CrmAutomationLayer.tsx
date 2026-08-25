import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createCrmAppointment,
  listMyCrmAppointments,
  type CrmAppointmentItem,
} from "@/lib/crm-appointments.functions";
import {
  getPipelineAgeAlerts,
  getUnansweredCustomerAlerts,
} from "@/lib/customer-automation.functions";
import { getCrmWorkspace } from "@/lib/crm-advanced.functions";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function toLocalInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function CrmAutomationLayer() {
  const pipelineAlertsFn = useServerFn(getPipelineAgeAlerts);
  const unansweredFn = useServerFn(getUnansweredCustomerAlerts);
  const appointmentsFn = useServerFn(listMyCrmAppointments);
  const workspaceFn = useServerFn(getCrmWorkspace);
  const createAppointmentFn = useServerFn(createCrmAppointment);

  const ageAlerts = useQuery({
    queryKey: ["crm-age-alerts"],
    queryFn: () => pipelineAlertsFn(),
    refetchInterval: 5 * 60_000,
  });
  const unanswered = useQuery({
    queryKey: ["crm-unanswered-alerts"],
    queryFn: () => unansweredFn(),
    refetchInterval: 60_000,
  });
  const appointments = useQuery({
    queryKey: ["crm-appointments"],
    queryFn: () => appointmentsFn(),
    refetchInterval: 60_000,
  });
  const workspace = useQuery({
    queryKey: ["crm-automation-booking-context"],
    queryFn: () => workspaceFn(),
    staleTime: 60_000,
  });

  const [agendaOpen, setAgendaOpen] = useState(false);
  const [opportunityId, setOpportunityId] = useState("");
  const [title, setTitle] = useState("Atendimento imobiliário");
  const [notes, setNotes] = useState("");
  const [meetingType, setMeetingType] = useState<"meet" | "phone" | "in_person" | "other">("meet");
  const [startsAt, setStartsAt] = useState(() => {
    const next = new Date(Date.now() + 24 * 60 * 60 * 1000);
    next.setMinutes(0, 0, 0);
    return toLocalInput(next);
  });
  const [duration, setDuration] = useState(60);
  const [saving, setSaving] = useState(false);

  const counts = useMemo(() => {
    const rows = ageAlerts.data ?? [];
    return {
      five: rows.filter((item) => item.level === 5).length,
      ten: rows.filter((item) => item.level === 10).length,
      thirty: rows.filter((item) => item.level === 30).length,
    };
  }, [ageAlerts.data]);

  const openOpportunities = (workspace.data?.opportunities ?? []).filter(
    (item) => item.status === "open",
  );
  const selected = openOpportunities.find((item) => item.id === opportunityId) ?? null;
  const upcoming = (appointments.data ?? [])
    .filter(
      (item) => item.status !== "cancelled" && new Date(item.startsAt).getTime() >= Date.now(),
    )
    .slice(0, 8);

  const saveAppointment = async () => {
    if (!selected || !startsAt || saving) return;
    setSaving(true);
    try {
      const start = new Date(startsAt);
      const end = new Date(start.getTime() + duration * 60_000);
      const result = await createAppointmentFn({
        data: {
          opportunityId: selected.id,
          contactName: selected.contact_name,
          contactPhone: selected.contact_phone || null,
          contactEmail: selected.contact_email || null,
          title,
          notes: notes || null,
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          timezone: "America/Sao_Paulo",
          meetingType,
          location: null,
        },
      });
      await appointments.refetch();
      toast.success("Agendamento registrado no CRM.");
      if (result.googleWarning) toast.info(result.googleWarning);
      setAgendaOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar o agendamento.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="border-b border-[var(--mi-border)] bg-[var(--mi-surface)] px-4 py-3 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1900px] flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <WatchBadge label="Etapa +5 dias" value={counts.five} tone="amber" />
            <WatchBadge label="Etapa +10 dias" value={counts.ten} tone="orange" />
            <WatchBadge label="Etapa +30 dias" value={counts.thirty} tone="rose" />
            <WatchBadge
              label="Cliente sem resposta +24h"
              value={unanswered.data?.length ?? 0}
              tone="red"
            />
            <span className="hidden text-[10px] text-[var(--mi-text-soft)] 2xl:inline">
              O alerta de 24h usa a última mensagem recebida do cliente e só permanece quando não
              existe resposta posterior.
            </span>
          </div>
          <Button
            size="sm"
            onClick={() => setAgendaOpen(true)}
            className="shrink-0 rounded-xl bg-blue-600 text-white"
          >
            <CalendarClock className="h-4 w-4" /> Agenda de atendimento
          </Button>
        </div>
      </div>

      <Dialog open={agendaOpen} onOpenChange={setAgendaOpen}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Agenda inteligente do Pipeline</DialogTitle>
          </DialogHeader>
          <div className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
            <section className="space-y-4 rounded-2xl border border-[var(--mi-border)] p-4">
              <div>
                <p className="text-sm font-black">Novo atendimento</p>
                <p className="mt-1 text-xs text-[var(--mi-text-muted)]">
                  Vincule o horário a uma oportunidade. Quando o Google estiver conectado, o evento
                  e o Meet são criados automaticamente.
                </p>
              </div>
              <Field label="Cliente / oportunidade">
                <select
                  value={opportunityId}
                  onChange={(event) => setOpportunityId(event.target.value)}
                  className="h-10 w-full rounded-md border border-[var(--mi-border)] bg-[var(--mi-bg)] px-3 text-sm"
                >
                  <option value="">Selecione o cliente...</option>
                  {openOpportunities.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.contact_name} ·{" "}
                      {item.property_reference || item.contact_phone || "Oportunidade"}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Título">
                <Input value={title} onChange={(event) => setTitle(event.target.value)} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Data e hora">
                  <Input
                    type="datetime-local"
                    value={startsAt}
                    onChange={(event) => setStartsAt(event.target.value)}
                  />
                </Field>
                <Field label="Duração">
                  <select
                    value={duration}
                    onChange={(event) => setDuration(Number(event.target.value))}
                    className="h-10 w-full rounded-md border border-[var(--mi-border)] bg-[var(--mi-bg)] px-3 text-sm"
                  >
                    <option value={30}>30 minutos</option>
                    <option value={45}>45 minutos</option>
                    <option value={60}>1 hora</option>
                    <option value={90}>1h30</option>
                  </select>
                </Field>
              </div>
              <Field label="Tipo de atendimento">
                <select
                  value={meetingType}
                  onChange={(event) => setMeetingType(event.target.value as typeof meetingType)}
                  className="h-10 w-full rounded-md border border-[var(--mi-border)] bg-[var(--mi-bg)] px-3 text-sm"
                >
                  <option value="meet">Google Meet</option>
                  <option value="phone">Telefone</option>
                  <option value="in_person">Presencial</option>
                  <option value="other">Outro</option>
                </select>
              </Field>
              <Field label="Observações">
                <Textarea
                  rows={3}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </Field>
              {selected && (
                <div className="rounded-xl bg-blue-500/[0.06] p-3 text-xs text-[var(--mi-text-muted)]">
                  <strong className="text-[var(--mi-text)]">{selected.contact_name}</strong>
                  <br />
                  {selected.contact_phone || "Sem telefone"} ·{" "}
                  {selected.contact_email || "Sem e-mail"}
                </div>
              )}
              <Button
                className="w-full"
                disabled={!selected || !startsAt || title.trim().length < 2 || saving}
                onClick={() => void saveAppointment()}
              >
                <Video className="h-4 w-4" /> {saving ? "Agendando..." : "Agendar atendimento"}
              </Button>
              <p className="text-[11px] leading-5 text-[var(--mi-text-soft)]">
                O sistema envia confirmação automática pelo WhatsApp aproximadamente 24 horas e 5
                horas antes do atendimento. Respostas como “SIM” confirmam o compromisso; pedidos de
                “REMARCAR” ficam sinalizados no CRM.
              </p>
            </section>

            <section className="rounded-2xl border border-[var(--mi-border)] p-4">
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-blue-600" />
                <h3 className="text-sm font-black">Próximos atendimentos</h3>
              </div>
              <div className="mt-4 space-y-2">
                {upcoming.map((item: CrmAppointmentItem) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black">{item.contactName}</p>
                        <p className="mt-1 text-xs text-[var(--mi-text-muted)]">
                          {formatDate(item.startsAt)} · {item.title}
                        </p>
                      </div>
                      {item.confirmationStatus === "confirmed" ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                      ) : item.confirmationStatus === "reschedule_requested" ? (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                      ) : (
                        <Clock3 className="h-4 w-4 shrink-0 text-amber-600" />
                      )}
                    </div>
                    {item.meetUrl && (
                      <a
                        href={item.meetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex text-[11px] font-black text-blue-600"
                      >
                        Abrir Google Meet
                      </a>
                    )}
                  </div>
                ))}
                {!upcoming.length && (
                  <p className="py-10 text-center text-xs text-[var(--mi-text-soft)]">
                    Nenhum atendimento futuro agendado.
                  </p>
                )}
              </div>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function WatchBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "orange" | "rose" | "red";
}) {
  const classes = {
    amber: "border-amber-300/40 bg-amber-500/[0.06] text-amber-700",
    orange: "border-orange-300/40 bg-orange-500/[0.06] text-orange-700",
    rose: "border-rose-300/40 bg-rose-500/[0.06] text-rose-700",
    red: "border-red-300/40 bg-red-500/[0.06] text-red-700",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[10px] font-black ${classes}`}
    >
      {label}
      <strong className="grid h-5 min-w-5 place-items-center rounded-full bg-current/10 px-1">
        {value}
      </strong>
    </span>
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
