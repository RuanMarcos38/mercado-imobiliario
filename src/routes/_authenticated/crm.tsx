import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Building2,
  FileText,
  GripVertical,
  Mail,
  MessageCircle,
  Paperclip,
  Phone,
  Plus,
  Send,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  CRM_STAGE_LABELS,
  CRM_STAGES,
  createCrmLead,
  deleteCrmLead,
  listCrmLeads,
  updateCrmLeadStage,
  type CrmLead,
  type CrmStage,
} from "@/lib/crm.functions";
import {
  CCA_DOCUMENT_CATEGORIES,
  CCA_DOCUMENT_LABELS,
  createCcaUploadTarget,
  listCcaDocuments,
  removeCcaDocument,
  submitLeadToCca,
} from "@/lib/cca-documents.functions";

export const Route = createFileRoute("/_authenticated/crm")({
  component: CrmPage,
  head: () => ({ title: "CRM de Oportunidades | MercadoImobi" }),
});

function CrmPage() {
  const listFn = useServerFn(listCrmLeads);
  const createFn = useServerFn(createCrmLead);
  const stageFn = useServerFn(updateCrmLeadStage);
  const deleteFn = useServerFn(deleteCrmLead);
  const leads = useQuery({ queryKey: ["crm-leads"], queryFn: () => listFn() });
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<CrmLead | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    propertyReference: "",
    notes: "",
  });

  const byStage = useMemo(() => {
    const map = new Map<CrmStage, CrmLead[]>();
    for (const stage of CRM_STAGES) map.set(stage, []);
    for (const lead of leads.data ?? []) {
      const stage = CRM_STAGES.includes(lead.status as CrmStage) ? (lead.status as CrmStage) : "novo";
      map.get(stage)?.push(lead);
    }
    return map;
  }, [leads.data]);

  const create = async () => {
    setSaving(true);
    try {
      await createFn({ data: { ...form, stage: "novo" } });
      toast.success("Oportunidade criada.");
      setOpen(false);
      setForm({ name: "", email: "", phone: "", propertyReference: "", notes: "" });
      await leads.refetch();
    } catch (error) {
      toast.error(String((error as Error)?.message ?? "Não foi possível criar a oportunidade."));
    } finally {
      setSaving(false);
    }
  };

  const move = async (leadId: string, stage: CrmStage) => {
    try {
      await stageFn({ data: { leadId, stage } });
      await leads.refetch();
    } catch {
      toast.error("Não foi possível mover a oportunidade.");
    } finally {
      setDragging(null);
    }
  };

  const remove = async (lead: CrmLead) => {
    if (!window.confirm(`Excluir a oportunidade de ${lead.client_name}?`)) return;
    try {
      await deleteFn({ data: { leadId: lead.id } });
      if (selected?.id === lead.id) setSelected(null);
      await leads.refetch();
      toast.success("Oportunidade removida.");
    } catch {
      toast.error("Não foi possível excluir a oportunidade.");
    }
  };

  return (
    <div className="min-h-screen bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1800px]">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">CRM imobiliário</p>
            <h1 className="mt-2 text-3xl font-black">Pipeline de oportunidades</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--mi-text-muted)]">
              Organize clientes, imóveis, propostas, documentação e análise CAIXA em um único Kanban. O quadro exibe somente as oportunidades do usuário autenticado.
            </p>
          </div>
          <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" /> Nova oportunidade</Button>
        </div>

        <div className="mt-6 flex gap-4 overflow-x-auto pb-5">
          {CRM_STAGES.map((stage) => (
            <section
              key={stage}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => dragging && void move(dragging, stage)}
              className="w-[300px] shrink-0 rounded-[22px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-3"
            >
              <div className="flex items-center justify-between px-1 py-2">
                <h2 className="text-xs font-black uppercase tracking-[0.11em]">{CRM_STAGE_LABELS[stage]}</h2>
                <span className="grid h-6 min-w-6 place-items-center rounded-full bg-[var(--mi-bg)] px-1.5 text-[10px] font-black text-[var(--mi-text-muted)]">{byStage.get(stage)?.length ?? 0}</span>
              </div>
              <div className="mt-2 min-h-[150px] space-y-3">
                {(byStage.get(stage) ?? []).map((lead) => (
                  <article
                    key={lead.id}
                    draggable
                    onDragStart={() => setDragging(lead.id)}
                    onDragEnd={() => setDragging(null)}
                    className="group cursor-grab rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-4 shadow-sm active:cursor-grabbing"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button onClick={() => setSelected(lead)} className="min-w-0 flex-1 text-left">
                        <p className="truncate font-black">{lead.client_name}</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--mi-text-muted)]">{lead.ai_qualification_notes || "Sem imóvel vinculado"}</p>
                      </button>
                      <GripVertical className="h-4 w-4 shrink-0 text-[var(--mi-text-soft)]" />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {lead.client_phone && <Badge icon={Phone}>{lead.client_phone}</Badge>}
                      {lead.client_email && <Badge icon={Mail}>{lead.client_email}</Badge>}
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-[var(--mi-border)] pt-3">
                      <button onClick={() => setSelected(lead)} className="flex items-center gap-1.5 text-[10px] font-black text-blue-600"><Paperclip className="h-3.5 w-3.5" /> Documentos</button>
                      <button onClick={() => void remove(lead)} className="opacity-0 transition group-hover:opacity-100" aria-label="Excluir"><Trash2 className="h-3.5 w-3.5 text-rose-600" /></button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Nova oportunidade</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cliente"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome do cliente" /></Field>
            <Field label="WhatsApp / telefone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(47) 99999-9999" /></Field>
            <Field label="E-mail"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Imóvel / oportunidade"><Input value={form.propertyReference} onChange={(e) => setForm({ ...form, propertyReference: e.target.value })} placeholder="Empreendimento, endereço ou código" /></Field>
            <div className="sm:col-span-2"><Field label="Observações"><Textarea rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Perfil, renda, entrada, prazo, próximos passos..." /></Field></div>
          </div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={() => void create()} disabled={saving || form.name.trim().length < 2}>{saving ? "Salvando..." : "Criar oportunidade"}</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selected)} onOpenChange={(value) => !value && setSelected(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          {selected && <LeadDossier lead={selected} onStageChanged={() => leads.refetch()} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LeadDossier({ lead, onStageChanged }: { lead: CrmLead; onStageChanged: () => Promise<unknown> }) {
  const listDocsFn = useServerFn(listCcaDocuments);
  const targetFn = useServerFn(createCcaUploadTarget);
  const removeDocFn = useServerFn(removeCcaDocument);
  const submitFn = useServerFn(submitLeadToCca);
  const stageFn = useServerFn(updateCrmLeadStage);
  const docs = useQuery({ queryKey: ["cca-documents", lead.id], queryFn: () => listDocsFn({ data: { leadId: lead.id } }) });
  const [category, setCategory] = useState<(typeof CCA_DOCUMENT_CATEGORIES)[number]>("identificacao_comprador");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const target = await targetFn({ data: { leadId: lead.id, category, fileName: file.name, mimeType: file.type || "application/octet-stream", size: file.size } });
      const result = await supabase.storage.from(target.bucket).uploadToSignedUrl(target.path, target.token, file, { contentType: file.type, upsert: false });
      if (result.error) throw result.error;
      await docs.refetch();
      toast.success("Documento anexado ao dossiê.");
    } catch (error) {
      toast.error(String((error as Error)?.message ?? "Não foi possível anexar o documento."));
    } finally {
      setUploading(false);
    }
  };

  const send = async () => {
    setSubmitting(true);
    try {
      const result = await submitFn({ data: { leadId: lead.id } });
      if (result.submitted) {
        await stageFn({ data: { leadId: lead.id, stage: "analise_caixa" } });
        await onStageChanged();
        toast.success(result.message);
      } else {
        toast.info(result.message);
      }
    } catch (error) {
      toast.error(String((error as Error)?.message ?? "Não foi possível enviar o dossiê."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <DialogHeader><DialogTitle className="flex items-center gap-2"><UserRound className="h-5 w-5 text-blue-600" /> {lead.client_name}</DialogTitle></DialogHeader>
      <div className="grid gap-4 md:grid-cols-3">
        <Info icon={Phone} label="Telefone" value={lead.client_phone || "—"} />
        <Info icon={Mail} label="E-mail" value={lead.client_email || "—"} />
        <Info icon={Building2} label="Etapa" value={CRM_STAGE_LABELS[(CRM_STAGES.includes(lead.status as CrmStage) ? lead.status : "novo") as CrmStage]} />
      </div>
      <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-4"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--mi-text-soft)]">Oportunidade</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--mi-text-muted)]">{lead.ai_qualification_notes || "Sem observações."}</p></div>

      <section className="rounded-[22px] border border-[var(--mi-border)] p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div><h3 className="flex items-center gap-2 font-black"><FileText className="h-4 w-4 text-blue-600" /> Dossiê documental / CCA</h3><p className="mt-1 text-xs text-[var(--mi-text-muted)]">PDF, JPG, PNG ou WebP. Máximo de 12 MB por arquivo.</p></div>
          <Button variant="outline" onClick={() => void send()} disabled={submitting || (docs.data?.length ?? 0) === 0}><Send className="mr-2 h-4 w-4" /> {submitting ? "Enviando..." : "Enviar ao CCA"}</Button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-[260px_1fr]">
          <select value={category} onChange={(e) => setCategory(e.target.value as any)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            {CCA_DOCUMENT_CATEGORIES.map((value) => <option key={value} value={value}>{CCA_DOCUMENT_LABELS[value]}</option>)}
          </select>
          <label className="flex h-10 cursor-pointer items-center justify-center rounded-md border border-dashed border-blue-500/40 bg-blue-500/[0.04] px-4 text-sm font-bold text-blue-600 hover:bg-blue-500/[0.08]">
            <Paperclip className="mr-2 h-4 w-4" /> {uploading ? "Enviando..." : "Anexar documento"}
            <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} />
          </label>
        </div>
        <div className="mt-4 space-y-2">
          {(docs.data ?? []).map((document) => (
            <div key={document.path} className="flex items-center gap-3 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-3">
              <FileText className="h-4 w-4 shrink-0 text-blue-600" />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{document.name}</p><p className="text-[10px] text-[var(--mi-text-soft)]">{CCA_DOCUMENT_LABELS[document.category as keyof typeof CCA_DOCUMENT_LABELS] ?? document.category}</p></div>
              {document.signedUrl && <a href={document.signedUrl} target="_blank" rel="noreferrer" className="text-xs font-black text-blue-600">Abrir</a>}
              <button onClick={async () => { await removeDocFn({ data: { leadId: lead.id, path: document.path } }); await docs.refetch(); }} aria-label="Remover"><Trash2 className="h-4 w-4 text-rose-600" /></button>
            </div>
          ))}
          {!docs.isLoading && (docs.data?.length ?? 0) === 0 && <p className="rounded-xl bg-[var(--mi-bg)] p-4 text-center text-xs text-[var(--mi-text-muted)]">Nenhum documento anexado.</p>}
        </div>
        <p className="mt-4 text-[11px] leading-5 text-[var(--mi-text-soft)]">O envio direto é ativado somente quando o endpoint oficial ou contratado do seu CCA estiver configurado no servidor. Sem essa credencial, o MercadoImobi mantém o dossiê privado e pronto para envio.</p>
      </section>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>; }
function Badge({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) { return <span className="flex max-w-full items-center gap-1 rounded-full bg-[var(--mi-surface)] px-2 py-1 text-[9px] font-bold text-[var(--mi-text-muted)]"><Icon className="h-3 w-3 shrink-0" /><span className="truncate">{children}</span></span>; }
function Info({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) { return <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-4"><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]"><Icon className="h-3.5 w-3.5" /> {label}</div><p className="mt-2 truncate text-sm font-bold">{value}</p></div>; }
