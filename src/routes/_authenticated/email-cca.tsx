import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileCheck2, FileText, Mail, RefreshCw, Send, ShieldCheck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { listCcaDocuments } from "@/lib/cca-documents.functions";
import {
  getEmailCcaStatus,
  listEmailCcaLeads,
  sendCcaDocumentsByEmail,
} from "@/lib/email-cca.functions";

export const Route = createFileRoute("/_authenticated/email-cca")({
  component: EmailCcaPage,
  head: () => ({ title: "E-mail / CCA | MercadoImobi" }),
});

function EmailCcaPage() {
  const statusFn = useServerFn(getEmailCcaStatus);
  const leadsFn = useServerFn(listEmailCcaLeads);
  const docsFn = useServerFn(listCcaDocuments);
  const sendFn = useServerFn(sendCcaDocumentsByEmail);

  const status = useQuery({ queryKey: ["cca-email-status"], queryFn: () => statusFn() });
  const leads = useQuery({ queryKey: ["cca-email-leads"], queryFn: () => leadsFn() });
  const [leadId, setLeadId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("Análise de crédito habitacional — documentação do cliente");
  const [message, setMessage] = useState(
    "Olá, segue o dossiê do cliente para análise de crédito. Por favor, confirme o recebimento e sinalize se houver necessidade de documentação complementar.",
  );
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (status.data?.defaultRecipient && !recipient) setRecipient(status.data.defaultRecipient);
  }, [status.data?.defaultRecipient, recipient]);

  const selectedLead = useMemo(
    () => (leads.data ?? []).find((lead: any) => lead.id === leadId) ?? null,
    [leadId, leads.data],
  );
  const documents = useQuery({
    queryKey: ["cca-email-documents", leadId],
    queryFn: () => docsFn({ data: { leadId } }),
    enabled: Boolean(leadId),
  });

  useEffect(() => {
    if (!selectedLead) return;
    setSubject(`Análise de crédito habitacional — ${selectedLead.client_name}`);
  }, [selectedLead]);

  const send = async () => {
    if (!status.data?.configured) {
      toast.info("Configure RESEND_API_KEY e EMAIL_FROM no servidor para liberar o envio de e-mail.");
      return;
    }
    if (!leadId) return toast.info("Selecione um cliente/oportunidade do CRM.");
    if (!recipient.trim()) return toast.info("Informe o e-mail do CCA.");
    if (!documents.data?.length) return toast.info("Anexe os documentos no CRM antes de enviar.");
    setSending(true);
    try {
      const result = await sendFn({
        data: { leadId, to: recipient.trim(), subject: subject.trim(), message: message.trim() },
      });
      toast.success(`${result.attachmentCount} documento(s) enviados ao CCA por e-mail.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar o dossiê.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1400px]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Crédito imobiliário</p>
            <h1 className="mt-2 text-3xl font-black">E-mail / CCA</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--mi-text-muted)]">
              Envie o dossiê privado do CRM diretamente para o e-mail do correspondente ou CCA, com os documentos anexados ao próprio e-mail.
            </p>
          </div>
          <div className={`inline-flex items-center gap-2 self-start rounded-full px-3 py-1.5 text-xs font-black ${status.data?.configured ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"}`}>
            {status.data?.configured ? <ShieldCheck className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
            {status.data?.configured ? "E-mail configurado" : "Aguardando provedor de e-mail"}
          </div>
        </div>

        {!status.isLoading && !status.data?.configured && (
          <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-sm leading-6 text-[var(--mi-text-muted)]">
            Para envio real, configure <strong>RESEND_API_KEY</strong> e <strong>EMAIL_FROM</strong> no EasyPanel. Opcionalmente use <strong>CCA_EMAIL_TO</strong> para deixar o destinatário padrão preenchido.
          </div>
        )}

        <div className="mt-6 grid gap-6 xl:grid-cols-[420px_1fr]">
          <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--mi-text-soft)]">CRM</p>
                <h2 className="mt-1 text-lg font-black">Selecione o cliente</h2>
              </div>
              <Button size="icon" variant="outline" onClick={() => void leads.refetch()} className="rounded-xl border-[var(--mi-border)]">
                <RefreshCw className={`h-4 w-4 ${leads.isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <div className="mt-4 max-h-[540px] space-y-2 overflow-y-auto pr-1">
              {(leads.data ?? []).map((lead: any) => (
                <button key={lead.id} type="button" onClick={() => setLeadId(lead.id)} className={`w-full rounded-2xl border p-4 text-left transition ${leadId === lead.id ? "border-blue-500/40 bg-blue-500/[0.08]" : "border-[var(--mi-border)] bg-[var(--mi-surface-soft)] hover:border-blue-500/25"}`}>
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-500/10 text-blue-600"><UserRound className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black">{lead.client_name}</span>
                      <span className="mt-1 block truncate text-xs text-[var(--mi-text-soft)]">{lead.client_email || lead.client_phone || "Sem contato cadastrado"}</span>
                      <span className="mt-2 inline-flex rounded-full bg-[var(--mi-bg)] px-2 py-1 text-[10px] font-black uppercase text-[var(--mi-text-muted)]">{lead.status || "novo"}</span>
                    </span>
                  </div>
                </button>
              ))}
              {(leads.data?.length ?? 0) === 0 && !leads.isFetching && (
                <div className="rounded-2xl border border-dashed border-[var(--mi-border)] p-6 text-center text-sm text-[var(--mi-text-soft)]">
                  Nenhuma oportunidade cadastrada no CRM.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--mi-text-soft)]">Dossiê</p>
                <h2 className="mt-1 text-xl font-black">Enviar documentação para análise</h2>
                <p className="mt-1 text-xs text-[var(--mi-text-soft)]">Os arquivos permanecem privados no CRM e são anexados somente no momento do envio.</p>
              </div>
              {selectedLead && (
                <Link to="/crm">
                  <Button variant="outline" size="sm" className="rounded-xl border-[var(--mi-border)]"><FileText className="mr-2 h-4 w-4" /> Abrir CRM</Button>
                </Link>
              )}
            </div>

            {selectedLead ? (
              <div className="mt-6 space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <InfoCard label="Cliente" value={selectedLead.client_name} />
                  <InfoCard label="Etapa CRM" value={selectedLead.status || "novo"} />
                  <InfoCard label="Documentos" value={documents.isLoading ? "Carregando..." : String(documents.data?.length ?? 0)} />
                </div>

                <Field label="E-mail do CCA / analista">
                  <input type="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="analise@cca.com.br" />
                </Field>
                <Field label="Assunto">
                  <input value={subject} onChange={(event) => setSubject(event.target.value)} />
                </Field>
                <Field label="Mensagem">
                  <textarea rows={7} value={message} onChange={(event) => setMessage(event.target.value)} />
                </Field>

                <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-4">
                  <div className="flex items-center gap-2">
                    <FileCheck2 className="h-4 w-4 text-blue-600" />
                    <p className="text-sm font-black">Arquivos que serão enviados</p>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {(documents.data ?? []).map((doc) => (
                      <div key={doc.path} className="truncate rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface)] px-3 py-2 text-xs">📎 {doc.name}</div>
                    ))}
                  </div>
                  {(documents.data?.length ?? 0) === 0 && !documents.isLoading && <p className="mt-3 text-xs text-amber-700">Nenhum documento anexado. Abra o CRM e anexe o dossiê antes do envio.</p>}
                </div>

                <Button onClick={() => void send()} disabled={sending || !status.data?.configured || !documents.data?.length} className="h-12 w-full rounded-xl bg-blue-600 font-black text-white hover:bg-blue-700">
                  <Send className="mr-2 h-4 w-4" /> {sending ? "Enviando dossiê..." : "Enviar documentação por e-mail"}
                </Button>
              </div>
            ) : (
              <div className="grid min-h-[440px] place-items-center text-center">
                <div>
                  <Mail className="mx-auto h-12 w-12 text-[var(--mi-text-soft)]" />
                  <h3 className="mt-3 font-black">Selecione um cliente do CRM</h3>
                  <p className="mt-1 max-w-sm text-sm text-[var(--mi-text-soft)]">O MercadoImobi carrega automaticamente o dossiê documental daquela oportunidade.</p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-4"><p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">{label}</p><p className="mt-1 truncate text-sm font-black">{value}</p></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-black text-[var(--mi-text-muted)]">{label}</span><div className="[&_input]:h-11 [&_input]:w-full [&_input]:rounded-xl [&_input]:border [&_input]:border-[var(--mi-border)] [&_input]:bg-[var(--mi-surface-soft)] [&_input]:px-3 [&_input]:text-sm [&_input]:outline-none [&_textarea]:w-full [&_textarea]:rounded-xl [&_textarea]:border [&_textarea]:border-[var(--mi-border)] [&_textarea]:bg-[var(--mi-surface-soft)] [&_textarea]:p-3 [&_textarea]:text-sm [&_textarea]:outline-none">{children}</div></label>;
}
