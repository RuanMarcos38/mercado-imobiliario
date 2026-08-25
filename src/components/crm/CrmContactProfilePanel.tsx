import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Save, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getCrmContactProfile, saveCrmContactProfile } from "@/lib/crm-operations.functions";

type Form = {
  name: string;
  phone: string;
  email: string;
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

const emptyForm: Form = {
  name: "",
  phone: "",
  email: "",
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

export function CrmContactProfilePanel({ opportunityId }: { opportunityId: string }) {
  const getFn = useServerFn(getCrmContactProfile);
  const saveFn = useServerFn(saveCrmContactProfile);
  const [form, setForm] = useState<Form>(emptyForm);
  const [saving, setSaving] = useState(false);
  const profile = useQuery({
    queryKey: ["crm-contact-profile", opportunityId],
    queryFn: () => getFn({ data: { opportunityId } }),
  });

  useEffect(() => {
    if (!profile.data) return;
    setForm({
      name: profile.data.name || "",
      phone: profile.data.phone || "",
      email: profile.data.email || "",
      city: profile.data.city || "",
      neighborhood: profile.data.neighborhood || "",
      propertyType: profile.data.propertyType || "",
      interest: profile.data.interest || "",
      income: profile.data.income == null ? "" : String(profile.data.income),
      downPayment: profile.data.downPayment == null ? "" : String(profile.data.downPayment),
      hasFgts: profile.data.hasFgts == null ? "" : profile.data.hasFgts ? "yes" : "no",
      creditStatus: profile.data.creditStatus || "",
      notes: profile.data.notes || "",
    });
  }, [profile.data]);

  const update = (key: keyof Form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!form.name.trim()) return toast.error("Informe o nome do contato.");
    setSaving(true);
    try {
      await saveFn({
        data: {
          opportunityId,
          name: form.name.trim(),
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
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
      await profile.refetch();
      toast.success("Cadastro do contato atualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o contato.");
    } finally {
      setSaving(false);
    }
  };

  if (profile.isLoading) {
    return <div className="rounded-2xl border border-[var(--mi-border)] p-4 text-sm text-[var(--mi-text-soft)]">Carregando cadastro do contato...</div>;
  }
  if (profile.error || !profile.data) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">Não foi possível carregar o cadastro do contato.</div>;
  }

  return (
    <section className="rounded-2xl border border-[var(--mi-border)] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-500/10 text-blue-600"><UserRound className="h-4 w-4" /></span>
          <div>
            <h3 className="font-black">Cadastro completo do contato</h3>
            <p className="text-xs text-[var(--mi-text-soft)]">Dados sincronizados do WhatsApp e editáveis no CRM.</p>
          </div>
        </div>
        <span className="rounded-lg border border-[var(--mi-border)] px-2.5 py-1 text-xs font-black text-[var(--mi-text-soft)]">Protocolo {profile.data.protocolCode}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Nome"><Input value={form.name} onChange={(event) => update("name", event.target.value)} /></Field>
        <Field label="WhatsApp / telefone"><Input value={form.phone} onChange={(event) => update("phone", event.target.value)} /></Field>
        <Field label="E-mail"><Input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} /></Field>
        <Field label="Cidade de interesse"><Input value={form.city} onChange={(event) => update("city", event.target.value)} /></Field>
        <Field label="Bairro / região"><Input value={form.neighborhood} onChange={(event) => update("neighborhood", event.target.value)} /></Field>
        <Field label="Tipo de imóvel"><Input value={form.propertyType} onChange={(event) => update("propertyType", event.target.value)} /></Field>
        <Field label="Renda familiar"><Input inputMode="decimal" value={form.income} onChange={(event) => update("income", event.target.value)} /></Field>
        <Field label="Entrada disponível"><Input inputMode="decimal" value={form.downPayment} onChange={(event) => update("downPayment", event.target.value)} /></Field>
        <Field label="Possui FGTS?">
          <select value={form.hasFgts} onChange={(event) => update("hasFgts", event.target.value)} className="h-10 w-full rounded-md border border-[var(--mi-border)] bg-[var(--mi-surface)] px-3 text-sm">
            <option value="">Não informado</option><option value="yes">Sim</option><option value="no">Não</option>
          </select>
        </Field>
        <Field label="Status de crédito"><Input value={form.creditStatus} onChange={(event) => update("creditStatus", event.target.value)} placeholder="Não analisado, pré-aprovado..." /></Field>
        <div className="sm:col-span-2"><Field label="Interesse / perfil do imóvel"><Input value={form.interest} onChange={(event) => update("interest", event.target.value)} /></Field></div>
        <div className="sm:col-span-2 lg:col-span-3"><Field label="Observações do cadastro"><Textarea rows={3} value={form.notes} onChange={(event) => update("notes", event.target.value)} /></Field></div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[11px] text-[var(--mi-text-soft)]">Origem do cadastro: {profile.data.source}. Última atividade WhatsApp: {profile.data.lastWhatsappAt ? new Date(profile.data.lastWhatsappAt).toLocaleString("pt-BR") : "não registrada"}.</p>
        <Button onClick={() => void save()} disabled={saving}><Save className="mr-2 h-4 w-4" /> {saving ? "Salvando..." : "Salvar cadastro"}</Button>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
