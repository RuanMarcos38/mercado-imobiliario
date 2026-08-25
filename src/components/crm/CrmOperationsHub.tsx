import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileText, Mail, Paperclip, PenLine, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createCrmDocumentUploadTarget,
  createCrmProposal,
  createCrmSignatureRequest,
  deleteCrmDocument,
  getCrmOperationsWorkspace,
  registerCrmDocument,
  sendCrmOpportunityEmail,
  updateCrmProposalStatus,
  updateCrmSignatureStatus,
  type CrmOpportunitySummary,
} from "@/lib/crm-operations.functions";

export type CrmOperationsMode = "proposals" | "emails" | "documents" | "signatures";

const money = (value: number | null | undefined) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

function OpportunitySelect({
  opportunities,
  value,
  onChange,
}: {
  opportunities: CrmOpportunitySummary[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 w-full rounded-md border border-[var(--mi-border)] bg-[var(--mi-surface)] px-3 text-sm"
    >
      <option value="">Selecione a oportunidade</option>
      {opportunities.map((opportunity) => (
        <option key={opportunity.id} value={opportunity.id}>
          {opportunity.protocol_code} · {opportunity.contact_name}
        </option>
      ))}
    </select>
  );
}

export function CrmOperationsHub({ mode }: { mode: CrmOperationsMode }) {
  const workspaceFn = useServerFn(getCrmOperationsWorkspace);
  const proposalFn = useServerFn(createCrmProposal);
  const proposalStatusFn = useServerFn(updateCrmProposalStatus);
  const emailFn = useServerFn(sendCrmOpportunityEmail);
  const uploadFn = useServerFn(createCrmDocumentUploadTarget);
  const registerFn = useServerFn(registerCrmDocument);
  const deleteDocumentFn = useServerFn(deleteCrmDocument);
  const signatureFn = useServerFn(createCrmSignatureRequest);
  const signatureStatusFn = useServerFn(updateCrmSignatureStatus);
  const fileRef = useRef<HTMLInputElement>(null);
  const [opportunityId, setOpportunityId] = useState("");
  const [busy, setBusy] = useState(false);

  const workspace = useQuery({
    queryKey: ["crm-operations-workspace"],
    queryFn: () => workspaceFn(),
  });
  const opportunities = workspace.data?.opportunities ?? [];
  const selectedOpportunity = opportunities.find((item) => item.id === opportunityId) ?? null;
  const opportunityMap = useMemo(
    () => new Map(opportunities.map((item) => [item.id, item])),
    [opportunities],
  );

  const refresh = async () => {
    await workspace.refetch();
  };

  if (workspace.isLoading) {
    return (
      <div className="p-8 text-sm text-[var(--mi-text-soft)]">Carregando módulo do CRM...</div>
    );
  }
  if (workspace.error || !workspace.data) {
    return (
      <div className="m-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
        Não foi possível carregar este módulo. {String((workspace.error as Error)?.message ?? "")}
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8">
      {mode === "proposals" && (
        <ProposalModule
          opportunities={opportunities}
          opportunityMap={opportunityMap}
          opportunityId={opportunityId}
          setOpportunityId={setOpportunityId}
          proposals={workspace.data.proposals}
          create={async (payload) => {
            setBusy(true);
            try {
              await proposalFn({ data: payload });
              await refresh();
              toast.success("Proposta cadastrada.");
            } catch (error) {
              toast.error(
                error instanceof Error ? error.message : "Não foi possível cadastrar a proposta.",
              );
            } finally {
              setBusy(false);
            }
          }}
          setStatus={async (proposalId, status) => {
            await proposalStatusFn({ data: { proposalId, status } });
            await refresh();
          }}
          busy={busy}
        />
      )}

      {mode === "emails" && (
        <EmailModule
          opportunities={opportunities}
          opportunityMap={opportunityMap}
          opportunityId={opportunityId}
          setOpportunityId={setOpportunityId}
          selectedOpportunity={selectedOpportunity}
          emails={workspace.data.emails}
          send={async (recipient, subject, body) => {
            if (!opportunityId) return toast.error("Selecione uma oportunidade.");
            setBusy(true);
            try {
              await emailFn({ data: { opportunityId, recipient, subject, body } });
              await refresh();
              toast.success("E-mail enviado e registrado.");
            } catch (error) {
              toast.error(
                error instanceof Error ? error.message : "Não foi possível enviar o e-mail.",
              );
            } finally {
              setBusy(false);
            }
          }}
          busy={busy}
        />
      )}

      {mode === "documents" && (
        <DocumentModule
          opportunities={opportunities}
          opportunityMap={opportunityMap}
          opportunityId={opportunityId}
          setOpportunityId={setOpportunityId}
          documents={workspace.data.documents}
          fileRef={fileRef}
          upload={async (file, category) => {
            if (!opportunityId) return toast.error("Selecione uma oportunidade.");
            setBusy(true);
            try {
              const target = await uploadFn({
                data: {
                  opportunityId,
                  category,
                  fileName: file.name,
                  mimeType: file.type || "application/octet-stream",
                  size: file.size,
                },
              });
              const uploaded = await supabase.storage
                .from(target.bucket)
                .uploadToSignedUrl(target.path, target.token, file, {
                  contentType: file.type || "application/octet-stream",
                });
              if (uploaded.error) throw new Error(uploaded.error.message);
              await registerFn({
                data: {
                  opportunityId,
                  category,
                  fileName: file.name,
                  mimeType: file.type || "application/octet-stream",
                  size: file.size,
                  storagePath: target.path,
                },
              });
              await refresh();
              toast.success("Documento anexado.");
            } catch (error) {
              toast.error(
                error instanceof Error ? error.message : "Não foi possível anexar o documento.",
              );
            } finally {
              setBusy(false);
              if (fileRef.current) fileRef.current.value = "";
            }
          }}
          remove={async (documentId) => {
            if (!window.confirm("Excluir este documento?")) return;
            await deleteDocumentFn({ data: { documentId } });
            await refresh();
            toast.success("Documento removido.");
          }}
          busy={busy}
        />
      )}

      {mode === "signatures" && (
        <SignatureModule
          opportunities={opportunities}
          opportunityMap={opportunityMap}
          opportunityId={opportunityId}
          setOpportunityId={setOpportunityId}
          selectedOpportunity={selectedOpportunity}
          signatures={workspace.data.signatures}
          create={async (payload) => {
            setBusy(true);
            try {
              await signatureFn({ data: payload });
              await refresh();
              toast.success("Solicitação de assinatura cadastrada.");
            } catch (error) {
              toast.error(
                error instanceof Error ? error.message : "Não foi possível cadastrar a assinatura.",
              );
            } finally {
              setBusy(false);
            }
          }}
          setStatus={async (signatureId, status) => {
            await signatureStatusFn({ data: { signatureId, status } });
            await refresh();
          }}
          busy={busy}
        />
      )}
    </div>
  );
}

function ModuleHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof FileText;
  title: string;
  description: string;
}) {
  return (
    <header className="flex items-start gap-3">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-500/10 text-blue-600">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h1 className="text-2xl font-black">{title}</h1>
        <p className="mt-1 text-sm text-[var(--mi-text-muted)]">{description}</p>
      </div>
    </header>
  );
}

function ProposalModule({
  opportunities,
  opportunityMap,
  opportunityId,
  setOpportunityId,
  proposals,
  create,
  setStatus,
  busy,
}: any) {
  const [title, setTitle] = useState("Proposta comercial");
  const [amount, setAmount] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <>
      <ModuleHeader
        icon={FileText}
        title="Propostas"
        description="Cadastre e acompanhe propostas vinculadas às oportunidades do Pipeline."
      />
      <section className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
        <div className="grid gap-3 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Label>Oportunidade</Label>
            <OpportunitySelect
              opportunities={opportunities}
              value={opportunityId}
              onChange={setOpportunityId}
            />
          </div>
          <div>
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>Valor</Label>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <Label>Validade</Label>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
          <div className="lg:col-span-3">
            <Label>Observações</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <Button
          className="mt-4"
          disabled={busy || !opportunityId || !title.trim()}
          onClick={() =>
            void create({
              opportunityId,
              title: title.trim(),
              amount: amount ? Number(amount.replace(",", ".")) : null,
              validUntil: validUntil || null,
              notes: notes || null,
            })
          }
        >
          <Plus className="mr-2 h-4 w-4" /> Nova proposta
        </Button>
      </section>
      <ListShell>
        {proposals.map((row: any) => {
          const opp = opportunityMap.get(row.opportunity_id);
          return (
            <div
              key={row.id}
              className="grid gap-3 border-b border-[var(--mi-border)] px-4 py-4 last:border-0 md:grid-cols-[1fr_180px_170px] md:items-center"
            >
              <div>
                <p className="font-black">{row.title}</p>
                <p className="text-xs text-[var(--mi-text-soft)]">
                  {opp?.protocol_code} · {opp?.contact_name} · {money(row.amount)}
                  {row.valid_until
                    ? ` · válido até ${new Date(`${row.valid_until}T12:00:00`).toLocaleDateString("pt-BR")}`
                    : ""}
                </p>
              </div>
              <select
                value={row.status}
                onChange={(e) => void setStatus(row.id, e.target.value)}
                className="h-9 rounded-md border border-[var(--mi-border)] bg-[var(--mi-surface)] px-2 text-sm"
              >
                <option value="draft">Rascunho</option>
                <option value="sent">Enviada</option>
                <option value="accepted">Aceita</option>
                <option value="rejected">Recusada</option>
                <option value="expired">Expirada</option>
              </select>
              <span className="text-xs text-[var(--mi-text-soft)]">
                {new Date(row.created_at).toLocaleString("pt-BR")}
              </span>
            </div>
          );
        })}
      </ListShell>
    </>
  );
}

function EmailModule({
  opportunities,
  opportunityMap,
  opportunityId,
  setOpportunityId,
  selectedOpportunity,
  emails,
  send,
  busy,
}: any) {
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("Informações sobre sua oportunidade imobiliária");
  const [body, setBody] = useState("");
  const choose = (id: string) => {
    setOpportunityId(id);
    const opp = opportunities.find((item: any) => item.id === id);
    setRecipient(opp?.contact_email || "");
  };
  return (
    <>
      <ModuleHeader
        icon={Mail}
        title="E-mails"
        description="Envie e acompanhe comunicações relacionadas às oportunidades."
      />
      <section className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Oportunidade</Label>
            <OpportunitySelect
              opportunities={opportunities}
              value={opportunityId}
              onChange={choose}
            />
          </div>
          <div>
            <Label>Destinatário</Label>
            <Input
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={selectedOpportunity?.contact_email || "cliente@email.com"}
            />
          </div>
          <div className="md:col-span-2">
            <Label>Assunto</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>Mensagem</Label>
            <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
        </div>
        <Button
          className="mt-4"
          disabled={busy || !opportunityId || !recipient || !subject.trim() || !body.trim()}
          onClick={() => void send(recipient, subject, body)}
        >
          <Send className="mr-2 h-4 w-4" /> Enviar e-mail
        </Button>
      </section>
      <ListShell>
        {emails.map((row: any) => {
          const opp = opportunityMap.get(row.opportunity_id);
          return (
            <div
              key={row.id}
              className="border-b border-[var(--mi-border)] px-4 py-4 last:border-0"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-black">{row.subject}</p>
                  <p className="text-xs text-[var(--mi-text-soft)]">
                    {opp?.protocol_code} · {opp?.contact_name} · {row.recipient}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-black ${row.status === "sent" ? "bg-emerald-500/10 text-emerald-700" : "bg-rose-500/10 text-rose-700"}`}
                >
                  {row.status === "sent" ? "Enviado" : "Falha"}
                </span>
              </div>
            </div>
          );
        })}
      </ListShell>
    </>
  );
}

function DocumentModule({
  opportunities,
  opportunityMap,
  opportunityId,
  setOpportunityId,
  documents,
  fileRef,
  upload,
  remove,
  busy,
}: any) {
  const [category, setCategory] = useState("documentos_cliente");
  return (
    <>
      <ModuleHeader
        icon={Paperclip}
        title="Documentos"
        description="Anexe documentos do cliente, proposta, imóvel, crédito e contrato com armazenamento privado."
      />
      <section className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label>Oportunidade</Label>
            <OpportunitySelect
              opportunities={opportunities}
              value={opportunityId}
              onChange={setOpportunityId}
            />
          </div>
          <div>
            <Label>Categoria</Label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-10 w-full rounded-md border border-[var(--mi-border)] bg-[var(--mi-surface)] px-3 text-sm"
            >
              <option value="documentos_cliente">Documentos do cliente</option>
              <option value="proposta">Proposta</option>
              <option value="imovel">Documentos do imóvel</option>
              <option value="credito">Crédito / financiamento</option>
              <option value="contrato">Contrato</option>
              <option value="outros">Outros</option>
            </select>
          </div>
          <div>
            <Label>Arquivo</Label>
            <Input
              ref={fileRef}
              type="file"
              disabled={busy || !opportunityId}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file, category);
              }}
            />
          </div>
        </div>
      </section>
      <ListShell>
        {documents.map((row: any) => {
          const opp = opportunityMap.get(row.opportunity_id);
          return (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--mi-border)] px-4 py-4 last:border-0"
            >
              <div>
                <p className="font-black">{row.file_name}</p>
                <p className="text-xs text-[var(--mi-text-soft)]">
                  {opp?.protocol_code} · {opp?.contact_name} · {row.category} ·{" "}
                  {(row.size_bytes / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <div className="flex gap-2">
                {row.signed_url && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(row.signed_url, "_blank", "noopener,noreferrer")}
                  >
                    Abrir
                  </Button>
                )}
                <Button size="icon" variant="outline" onClick={() => void remove(row.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </ListShell>
    </>
  );
}

function SignatureModule({
  opportunities,
  opportunityMap,
  opportunityId,
  setOpportunityId,
  selectedOpportunity,
  signatures,
  create,
  setStatus,
  busy,
}: any) {
  const [title, setTitle] = useState("Assinatura de documento");
  const [provider, setProvider] = useState("Link externo");
  const [url, setUrl] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const choose = (id: string) => {
    setOpportunityId(id);
    const opp = opportunities.find((item: any) => item.id === id);
    setSignerName(opp?.contact_name || "");
    setSignerEmail(opp?.contact_email || "");
  };
  return (
    <>
      <ModuleHeader
        icon={PenLine}
        title="Assinaturas"
        description="Controle solicitações de assinatura e links do provedor oficial utilizado pela imobiliária."
      />
      <section className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label>Oportunidade</Label>
            <OpportunitySelect
              opportunities={opportunities}
              value={opportunityId}
              onChange={choose}
            />
          </div>
          <div>
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>Provedor</Label>
            <Input
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="Clicksign, ZapSign, D4Sign..."
            />
          </div>
          <div>
            <Label>Signatário</Label>
            <Input
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder={selectedOpportunity?.contact_name || "Nome"}
            />
          </div>
          <div>
            <Label>E-mail do signatário</Label>
            <Input
              type="email"
              value={signerEmail}
              onChange={(e) => setSignerEmail(e.target.value)}
            />
          </div>
          <div>
            <Label>Link de assinatura</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
          </div>
        </div>
        <Button
          className="mt-4"
          disabled={busy || !opportunityId || !title.trim() || !provider.trim()}
          onClick={() =>
            void create({
              opportunityId,
              title: title.trim(),
              provider: provider.trim(),
              signingUrl: url || null,
              signerName: signerName || null,
              signerEmail: signerEmail || null,
            })
          }
        >
          <Plus className="mr-2 h-4 w-4" /> Nova solicitação
        </Button>
      </section>
      <ListShell>
        {signatures.map((row: any) => {
          const opp = opportunityMap.get(row.opportunity_id);
          return (
            <div
              key={row.id}
              className="grid gap-3 border-b border-[var(--mi-border)] px-4 py-4 last:border-0 md:grid-cols-[1fr_180px_auto] md:items-center"
            >
              <div>
                <p className="font-black">{row.title}</p>
                <p className="text-xs text-[var(--mi-text-soft)]">
                  {opp?.protocol_code} · {opp?.contact_name} · {row.provider}
                </p>
              </div>
              <select
                value={row.status}
                onChange={(e) => void setStatus(row.id, e.target.value)}
                className="h-9 rounded-md border border-[var(--mi-border)] bg-[var(--mi-surface)] px-2 text-sm"
              >
                <option value="pending">Pendente</option>
                <option value="sent">Enviada</option>
                <option value="viewed">Visualizada</option>
                <option value="signed">Assinada</option>
                <option value="canceled">Cancelada</option>
                <option value="expired">Expirada</option>
              </select>
              {row.signing_url ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => window.open(row.signing_url, "_blank", "noopener,noreferrer")}
                >
                  Abrir assinatura
                </Button>
              ) : (
                <span className="text-xs text-[var(--mi-text-soft)]">Sem link</span>
              )}
            </div>
          );
        })}
      </ListShell>
    </>
  );
}

function ListShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)]">
      {children || <div className="p-6 text-sm text-[var(--mi-text-soft)]">Nenhum registro.</div>}
    </section>
  );
}
