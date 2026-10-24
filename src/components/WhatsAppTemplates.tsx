import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { JOINVILLE_PRESENTATION } from "@/lib/whatsapp-templates.core";
import { listWhatsAppTemplates, submitWhatsAppTemplate } from "@/lib/whatsapp-templates.functions";

const statusLabels: Record<string, string> = { APPROVED: "Aprovado", PENDING: "Em análise", REJECTED: "Rejeitado", PAUSED: "Pausado", DISABLED: "Desativado", IN_APPEAL: "Em recurso" };

export function WhatsAppTemplates() {
  const list = useServerFn(listWhatsAppTemplates);
  const submit = useServerFn(submitWhatsAppTemplate);
  const templates = useQuery({ queryKey: ["whatsapp-message-templates"], queryFn: () => list(), refetchInterval: 60_000 });
  const [name, setName] = useState("ruan_joinville_mcmv_apresentacao_v1");
  const [body, setBody] = useState(JOINVILLE_PRESENTATION);
  const [exampleName, setExampleName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: string; status: string } | null>(null);
  async function sendForReview() {
    setBusy(true);
    setResult(null);
    try {
      const response = await submit({ data: { name, body, exampleName } });
      setResult(response);
      toast.success("Modelo recebido pela Meta. Consulte o status abaixo.");
      await templates.refetch();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível submeter o modelo."); }
    finally { setBusy(false); }
  }
  return <section id="whatsapp-templates" className="mt-6 border-t border-[var(--mi-border)] pt-5">
    <h3 className="font-black">Modelos de mensagem do WhatsApp</h3>
    <p className="mt-1 text-sm text-[var(--mi-text-muted)]">Crie modelos de marketing em português e acompanhe a análise da Meta. Submeter um modelo não envia mensagens aos clientes.</p>
    <div className="mt-4 grid gap-3">
      <label htmlFor="wa-template-name">Nome do modelo</label>
      <Input id="wa-template-name" value={name} onChange={e => setName(e.target.value)} pattern="[a-z0-9_]+" disabled={busy} />
      <label htmlFor="wa-template-body">Mensagem — use {"{{primeiro_nome}}"} para personalizar</label>
      <textarea id="wa-template-body" className="min-h-40 rounded-lg border bg-transparent p-3" value={body} maxLength={1024} onChange={e => setBody(e.target.value)} disabled={busy} />
      <label htmlFor="wa-template-example">Nome de exemplo para a análise da Meta</label>
      <Input id="wa-template-example" value={exampleName} onChange={e => setExampleName(e.target.value)} maxLength={80} disabled={busy} />
      <div className="flex flex-wrap gap-2"><Button onClick={() => void sendForReview()} disabled={busy || !name || !body || !exampleName}>{busy ? "Enviando para análise…" : "Enviar modelo para aprovação da Meta"}</Button><Button variant="outline" onClick={() => void templates.refetch()} disabled={templates.isFetching}>Atualizar aprovação</Button></div>
      {result && <p role="status">Recebido pela Meta: {result.id} — {statusLabels[result.status] ?? result.status}</p>}
      {templates.error && <p role="alert">{templates.error.message}</p>}
      {templates.isLoading && <p>Consultando modelos…</p>}
      {templates.data?.length === 0 && <p>Nenhum modelo encontrado nesta conta.</p>}
      {templates.data?.map(t => <article key={t.id} className="rounded-lg border p-3"><p className="font-semibold">{t.name} — {statusLabels[t.status] ?? t.status}</p><p className="text-xs">{t.language} · {t.category}</p><p className="mt-2 whitespace-pre-wrap text-sm">{t.body}</p>{t.rejectedReason && <p className="mt-2 text-sm">Motivo informado pela Meta: {t.rejectedReason}</p>}</article>)}
    </div>
    <p className="mt-4 text-xs text-[var(--mi-text-muted)]">A aprovação não autoriza disparos: o destinatário precisa ter autorizado o contato. O envio desta apresentação permanece bloqueado enquanto a validação e a proteção contra reenvio estiverem pendentes.</p>
  </section>;
}
