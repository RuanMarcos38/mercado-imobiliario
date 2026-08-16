import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Building2,
  CheckCheck,
  ExternalLink,
  Link2,
  MessageCircle,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  getWhatsAppConnectionStatus,
  getWhatsAppQrCode,
  listWhatsAppConversations,
  listWhatsAppMessages,
  markWhatsAppConversationRead,
  sendWhatsAppText,
  type WhatsAppConversation,
} from "@/lib/whatsapp.functions";
import { prepareWhatsAppConnection } from "@/lib/whatsapp-connection.functions";
import { startWhatsAppConversation } from "@/lib/whatsapp-conversation.functions";
import { generateConversationDraft, getAiRuntimeStatus } from "@/lib/ai-assistant.functions";

export const Route = createFileRoute("/_authenticated/atendimento")({
  component: AtendimentoPage,
  head: () => ({ title: "Conversas | MercadoImobi" }),
});

type PropertyContext = {
  id?: string;
  title?: string;
  url?: string | null;
};

function AtendimentoPage() {
  const statusFn = useServerFn(getWhatsAppConnectionStatus);
  const qrFn = useServerFn(getWhatsAppQrCode);
  const prepareFn = useServerFn(prepareWhatsAppConnection);
  const conversationsFn = useServerFn(listWhatsAppConversations);
  const messagesFn = useServerFn(listWhatsAppMessages);
  const markReadFn = useServerFn(markWhatsAppConversationRead);
  const sendFn = useServerFn(sendWhatsAppText);
  const startFn = useServerFn(startWhatsAppConversation);
  const draftFn = useServerFn(generateConversationDraft);
  const aiStatusFn = useServerFn(getAiRuntimeStatus);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [propertyContext, setPropertyContext] = useState<PropertyContext | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const connection = useQuery({
    queryKey: ["whatsapp-connection"],
    queryFn: () => statusFn(),
    refetchInterval: 30_000,
  });
  const aiStatus = useQuery({ queryKey: ["ai-runtime-status"], queryFn: () => aiStatusFn() });
  const conversations = useQuery({
    queryKey: ["whatsapp-conversations"],
    queryFn: () => conversationsFn(),
    refetchInterval: 30_000,
  });
  const messages = useQuery({
    queryKey: ["whatsapp-messages", selectedId],
    queryFn: () => messagesFn({ data: { conversationId: selectedId! } }),
    enabled: Boolean(selectedId),
    refetchInterval: selectedId ? 15_000 : false,
  });

  useEffect(() => {
    const storedConversation = sessionStorage.getItem("mercadoimobi:selectedConversation");
    if (storedConversation) {
      setSelectedId(storedConversation);
      sessionStorage.removeItem("mercadoimobi:selectedConversation");
    }
    const storedProperty = sessionStorage.getItem("mercadoimobi:propertyContext");
    if (storedProperty) {
      try {
        setPropertyContext(JSON.parse(storedProperty) as PropertyContext);
      } catch {
        setPropertyContext(null);
      }
      sessionStorage.removeItem("mercadoimobi:propertyContext");
    }
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("mercadoimobi-atendimento-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_conversations" },
        () => void conversations.refetch(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_messages" }, () => {
        void conversations.refetch();
        if (selectedId) void messages.refetch();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    void markReadFn({ data: { conversationId: selectedId } }).then(() => conversations.refetch());
  }, [selectedId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.data?.length, selectedId]);

  const selected = (conversations.data ?? []).find((item) => item.id === selectedId) ?? null;
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return conversations.data ?? [];
    return (conversations.data ?? []).filter((conversation) =>
      [conversation.contact_name, conversation.phone_e164, conversation.last_message]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [conversations.data, search]);

  const connect = async () => {
    try {
      const prepared = await prepareFn();
      if (!prepared.configured) {
        toast.info("A conexão do WhatsApp ainda precisa ser ativada no servidor.");
        return;
      }
      const qr = await qrFn();
      setQrBase64(qr.base64);
      setQrCode(qr.code);
      setShowQr(true);
      await connection.refetch();
    } catch {
      toast.error("Não foi possível iniciar a conexão agora.");
    }
  };

  const startConversation = async () => {
    const phone = window.prompt("Número do WhatsApp com DDI e DDD (ex.: 5547999999999):");
    if (!phone?.trim()) return;
    const name = window.prompt("Nome do contato (opcional):") ?? "";
    try {
      const result = await startFn({ data: { phone, contactName: name || undefined } });
      await conversations.refetch();
      setSelectedId(result.id);
      setPropertyContext(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível abrir a conversa.");
    }
  };

  const send = async () => {
    if (!selectedId || !text.trim() || sending) return;
    if (!connection.data?.connected) {
      toast.info("Conecte seu WhatsApp para enviar mensagens.");
      return;
    }
    const outgoing = text.trim();
    setSending(true);
    try {
      await sendFn({ data: { conversationId: selectedId, text: outgoing } });
      setText("");
      await Promise.all([messages.refetch(), conversations.refetch()]);
    } catch {
      toast.error("A mensagem não foi enviada. Verifique a conexão e tente novamente.");
    } finally {
      setSending(false);
    }
  };

  const draftReply = async () => {
    if (!selectedId) return;
    if (!aiStatus.data?.configured) {
      toast.info("A inteligência artificial ainda não está conectada no servidor.");
      return;
    }
    setDrafting(true);
    try {
      const result = await draftFn({ data: { conversationId: selectedId } });
      setText(result.text);
      toast.success("Sugestão criada. Revise antes de enviar.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(
        message.includes("AI_DISABLED")
          ? "Ative o Assistente IA antes de gerar sugestões."
          : "Não foi possível gerar uma sugestão agora.",
      );
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div className="h-screen min-h-[720px] bg-[var(--mi-bg)] p-0 text-[var(--mi-text)] lg:h-screen lg:p-4">
      <div className="mx-auto grid h-full max-w-[1600px] overflow-hidden border-[var(--mi-border)] bg-[var(--mi-surface)] shadow-2xl lg:grid-cols-[360px_1fr] lg:rounded-[28px] lg:border">
        <aside
          className={`${selectedId ? "hidden lg:flex" : "flex"} min-h-0 flex-col border-r border-[var(--mi-border)] bg-[var(--mi-surface-soft)]`}
        >
          <div className="border-b border-[var(--mi-border)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">
                  Atendimento
                </p>
                <h1 className="mt-1 text-xl font-black">Conversas</h1>
              </div>
              <ConnectionPill
                connected={Boolean(connection.data?.connected)}
                loading={connection.isLoading}
              />
            </div>
            <div className="mt-4 flex h-11 items-center gap-2 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-3 text-[var(--mi-text-muted)] focus-within:border-blue-500/30">
              <Search className="h-4 w-4" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar conversa"
                className="min-w-0 flex-1 bg-transparent text-sm text-[var(--mi-text)] outline-none placeholder:text-slate-600"
              />
              <button onClick={() => void conversations.refetch()} title="Atualizar">
                <RefreshCw
                  className={`h-4 w-4 ${conversations.isFetching ? "animate-spin" : ""}`}
                />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => void startConversation()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--mi-border)] text-xs font-bold text-[var(--mi-text)] hover:bg-white/5"
              >
                <MessageCircle className="h-4 w-4" /> Nova conversa
              </button>
              <button
                onClick={() => void connect()}
                className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl border text-xs font-bold ${connection.data?.connected ? "border-emerald-300/15 bg-emerald-300/[0.05] text-emerald-200" : "border-amber-300/15 bg-amber-300/[0.04] text-amber-100"}`}
              >
                <Link2 className="h-4 w-4" />{" "}
                {connection.data?.connected ? "Conectado" : "Conectar"}
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filtered.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                selected={conversation.id === selectedId}
                onClick={() => {
                  setSelectedId(conversation.id);
                  setPropertyContext(null);
                }}
              />
            ))}
            {!conversations.isLoading && filtered.length === 0 && (
              <div className="px-6 py-12 text-center text-sm text-[var(--mi-text-soft)]">
                <MessageCircle className="mx-auto mb-3 h-8 w-8 opacity-50" />
                Nenhuma conversa encontrada.
              </div>
            )}
          </div>
        </aside>

        <section
          className={`${selectedId ? "flex" : "hidden lg:flex"} min-h-0 flex-col bg-[var(--mi-bg)]`}
        >
          {!selected ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="grid h-20 w-20 place-items-center rounded-3xl bg-blue-600/[0.07] text-blue-600 ring-1 ring-cyan-300/15">
                <MessageCircle className="h-9 w-9" />
              </div>
              <h2 className="mt-6 text-2xl font-black">Central de Atendimento</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-[var(--mi-text-muted)]">
                Selecione uma conversa ou abra o WhatsApp de um imóvel para iniciar o atendimento
                com o contexto da oportunidade.
              </p>
            </div>
          ) : (
            <>
              <div className="flex min-h-16 items-center justify-between border-b border-[var(--mi-border)] px-3 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    onClick={() => setSelectedId(null)}
                    className="grid h-9 w-9 place-items-center rounded-xl border border-[var(--mi-border)] text-[var(--mi-text-muted)] lg:hidden"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <Avatar conversation={selected} />
                  <div className="min-w-0">
                    <p className="truncate font-bold">
                      {selected.contact_name || formatPhone(selected.phone_e164)}
                    </p>
                    <p className="truncate text-xs text-[var(--mi-text-soft)]">
                      {formatPhone(selected.phone_e164)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => void messages.refetch()}
                  className="grid h-9 w-9 place-items-center rounded-xl text-[var(--mi-text-muted)] hover:bg-white/5"
                  title="Atualizar conversa"
                >
                  <RefreshCw className={`h-4 w-4 ${messages.isFetching ? "animate-spin" : ""}`} />
                </button>
              </div>

              {propertyContext?.title && (
                <div className="border-b border-blue-500/15 bg-blue-600/[0.035] px-4 py-3 sm:px-6">
                  <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 rounded-xl border border-blue-500/15 bg-[var(--mi-surface-soft)] px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-blue-600">
                        Imóvel relacionado
                      </p>
                      <p className="mt-0.5 truncate text-sm font-bold text-[var(--mi-text)]">
                        {propertyContext.title}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {propertyContext.url && (
                        <a
                          href={propertyContext.url}
                          target="_blank"
                          rel="noreferrer"
                          className="grid h-9 w-9 place-items-center rounded-lg text-blue-600 hover:bg-white/5"
                          title="Abrir anúncio"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                      <button
                        onClick={() => setPropertyContext(null)}
                        className="grid h-9 w-9 place-items-center rounded-lg text-[var(--mi-text-soft)] hover:bg-white/5"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div
                ref={scrollRef}
                className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(34,211,238,.045),_transparent_35%)] px-4 py-6 sm:px-8"
              >
                <div className="mx-auto max-w-4xl space-y-2">
                  {(messages.data ?? []).map((message) => (
                    <MessageBubble key={message.id} message={message} />
                  ))}
                  {!messages.isLoading && (messages.data?.length ?? 0) === 0 && (
                    <div className="py-16 text-center text-sm text-[var(--mi-text-soft)]">
                      Ainda não há mensagens nesta conversa.
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-[var(--mi-border)] bg-[var(--mi-surface)] p-3 sm:p-4">
                <div className="mx-auto max-w-4xl">
                  <div className="mb-2 flex justify-end">
                    <button
                      onClick={() => void draftReply()}
                      disabled={drafting || !aiStatus.data?.configured}
                      className="inline-flex h-8 items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-600/[0.04] px-3 text-[11px] font-bold text-blue-600 disabled:opacity-40"
                    >
                      <Sparkles className="h-3.5 w-3.5" />{" "}
                      {drafting ? "Criando sugestão..." : "Sugerir resposta com IA"}
                    </button>
                  </div>
                  <div className="flex items-end gap-2">
                    <button
                      disabled
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[var(--mi-border)] text-slate-600"
                      title="Anexos serão habilitados quando o canal suportar envio de mídia"
                    >
                      <Paperclip className="h-4 w-4" />
                    </button>
                    <textarea
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void send();
                        }
                      }}
                      rows={1}
                      placeholder={
                        connection.data?.connected
                          ? "Digite uma mensagem"
                          : "Conecte seu WhatsApp para enviar"
                      }
                      disabled={!connection.data?.connected}
                      className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-4 py-3 text-sm text-[var(--mi-text)] outline-none placeholder:text-slate-600 focus:border-blue-500/30 disabled:opacity-50"
                    />
                    <button
                      onClick={() => void send()}
                      disabled={!text.trim() || sending || !connection.data?.connected}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:bg-white/5 disabled:text-slate-600"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {showQr && (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4 backdrop-blur-md"
          onClick={() => setShowQr(false)}
        >
          <div
            className="w-full max-w-sm rounded-[28px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-6 text-center shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-xl font-black">Conectar WhatsApp</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--mi-text-muted)]">
              No WhatsApp do celular, abra a opção para conectar um dispositivo.
            </p>
            {qrBase64 ? (
              <img
                src={qrBase64.startsWith("data:") ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                alt="Código para conectar WhatsApp"
                className="mx-auto mt-5 aspect-square w-64 rounded-2xl bg-white p-3"
              />
            ) : qrCode ? (
              <div className="mt-5 break-all rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-4 text-xs text-[var(--mi-text-muted)]">
                {qrCode}
              </div>
            ) : (
              <p className="mt-5 rounded-2xl border border-amber-300/15 bg-amber-300/[0.04] p-4 text-sm text-amber-100">
                A conexão foi iniciada. Atualize o status em alguns instantes.
              </p>
            )}
            <Button
              className="mt-5 w-full bg-blue-600 font-black text-white hover:bg-blue-700"
              onClick={() => setShowQr(false)}
            >
              Fechar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectionPill({ connected, loading }: { connected: boolean; loading: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${connected ? "border-emerald-300/15 bg-emerald-300/[0.05] text-emerald-200" : "border-[var(--mi-border)] bg-white/[0.03] text-[var(--mi-text-soft)]"}`}
    >
      {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
      {loading ? "VERIFICANDO" : connected ? "ONLINE" : "OFFLINE"}
    </span>
  );
}

function ConversationRow({
  conversation,
  selected,
  onClick,
}: {
  conversation: WhatsAppConversation;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 border-b border-white/[0.06] px-4 py-3 text-left transition ${selected ? "bg-blue-600/[0.08]" : "hover:bg-[var(--mi-surface-soft)]"}`}
    >
      <Avatar conversation={conversation} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-bold text-[var(--mi-text)]">
            {conversation.contact_name || formatPhone(conversation.phone_e164)}
          </p>
          <span className="shrink-0 text-[10px] text-slate-600">
            {formatTime(conversation.last_message_at)}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-[var(--mi-text-soft)]">
            {conversation.last_message || "Nova conversa"}
          </p>
          {conversation.unread_count > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-blue-600 px-1 text-[10px] font-black text-[var(--mi-text)]">
              {conversation.unread_count > 99 ? "99+" : conversation.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function Avatar({ conversation }: { conversation: WhatsAppConversation }) {
  const initials = (conversation.contact_name || conversation.phone_e164).slice(0, 2).toUpperCase();
  return conversation.avatar_url ? (
    <img
      src={conversation.avatar_url}
      alt=""
      className="h-11 w-11 shrink-0 rounded-full object-cover"
    />
  ) : (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-300/20 to-blue-500/10 text-xs font-black text-blue-600 ring-1 ring-white/10">
      {initials}
    </span>
  );
}

function MessageBubble({
  message,
}: {
  message: {
    id: string;
    direction: "inbound" | "outbound";
    body: string | null;
    media_url: string | null;
    message_type: string;
    status: string;
    sent_at: string;
  };
}) {
  const outgoing = message.direction === "outbound";
  return (
    <div className={`flex ${outgoing ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm shadow-lg sm:max-w-[68%] ${outgoing ? "rounded-br-md bg-blue-600 text-[var(--mi-text)]" : "rounded-bl-md border border-[var(--mi-border)] bg-[var(--mi-surface)] text-[var(--mi-text)]"}`}
      >
        {message.media_url && (
          <a
            href={message.media_url}
            target="_blank"
            rel="noreferrer"
            className={`mb-1 block text-xs font-semibold underline ${outgoing ? "text-[var(--mi-text)]" : "text-blue-600"}`}
          >
            Abrir mídia
          </a>
        )}
        <p className="whitespace-pre-wrap break-words">
          {message.body || (message.media_url ? "Mídia" : "Mensagem")}
        </p>
        <div
          className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${outgoing ? "text-[#143342]" : "text-[var(--mi-text-soft)]"}`}
        >
          {formatTime(message.sent_at)}
          {outgoing && <CheckCheck className="h-3 w-3" />}
        </div>
      </div>
    </div>
  );
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55"))
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  if (digits.length === 12 && digits.startsWith("55"))
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  return `+${digits}`;
}
function formatTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date)
    : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(date);
}
