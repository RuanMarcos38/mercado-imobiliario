import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Building2,
  CheckCheck,
  Link2,
  MessageCircle,
  MoreVertical,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  UserRound,
  Wifi,
  WifiOff,
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

export const Route = createFileRoute("/_authenticated/atendimento")({
  component: AtendimentoPage,
  head: () => ({
    title: "Atendimento | MercadoImobi",
    meta: [
      {
        name: "description",
        content: "Central de conversas do MercadoImobi para atendimento imobiliário pelo WhatsApp.",
      },
    ],
  }),
});

function AtendimentoPage() {
  const statusFn = useServerFn(getWhatsAppConnectionStatus);
  const qrFn = useServerFn(getWhatsAppQrCode);
  const prepareFn = useServerFn(prepareWhatsAppConnection);
  const conversationsFn = useServerFn(listWhatsAppConversations);
  const messagesFn = useServerFn(listWhatsAppMessages);
  const markReadFn = useServerFn(markWhatsAppConversationRead);
  const sendFn = useServerFn(sendWhatsAppText);
  const startFn = useServerFn(startWhatsAppConversation);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const connection = useQuery({
    queryKey: ["whatsapp-connection"],
    queryFn: () => statusFn(),
    refetchInterval: 30_000,
  });

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
    const channel = supabase
      .channel("mercadoimobi-atendimento")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_conversations" },
        () => void conversations.refetch(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_messages" },
        () => {
          void conversations.refetch();
          if (selectedId) void messages.refetch();
        },
      )
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
    const target = scrollRef.current;
    if (target) target.scrollTop = target.scrollHeight;
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
        toast.info("A conexão do WhatsApp ainda precisa ser ativada pelo administrador.");
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
    const phone = window.prompt("Número do WhatsApp com DDD e DDI (ex.: 5547999999999):");
    if (!phone?.trim()) return;
    const name = window.prompt("Nome do contato (opcional):") ?? "";
    try {
      const result = await startFn({ data: { phone, contactName: name || undefined } });
      await conversations.refetch();
      setSelectedId(result.id);
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha no envio.";
      toast.error(
        message.includes("WHATSAPP_NOT_CONFIGURED")
          ? "Conecte seu WhatsApp antes de enviar mensagens."
          : "A mensagem não foi enviada. Tente novamente.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#06101c] text-white">
      <header className="border-b border-white/10 bg-[#07111f]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Link
              to="/dashboard"
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-slate-300 transition hover:bg-white/5 hover:text-white"
              title="Voltar para imóveis"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <Link to="/dashboard" className="flex items-center gap-2 font-bold tracking-tight">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-300/10 text-cyan-200 ring-1 ring-cyan-300/20">
                <Building2 className="h-5 w-5" />
              </span>
              <span>
                Mercado<span className="text-cyan-300">Imobi</span>
              </span>
              <span className="hidden text-sm font-medium text-slate-500 sm:inline">/ Atendimento</span>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <ConnectionPill connected={Boolean(connection.data?.connected)} loading={connection.isLoading} />
            <Link
              to="/settings/security"
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-slate-300 hover:bg-white/5"
              title="Minha conta"
            >
              <UserRound className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto h-[calc(100vh-64px)] max-w-[1600px] p-0 sm:p-4 lg:p-6">
        <div className="grid h-full overflow-hidden border-white/10 bg-[#091626] shadow-2xl sm:rounded-[28px] sm:border lg:grid-cols-[370px_1fr]">
          <aside className={`${selectedId ? "hidden lg:flex" : "flex"} min-h-0 flex-col border-r border-white/10 bg-[#081421]`}>
            <div className="border-b border-white/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">Central</p>
                  <h1 className="mt-1 text-xl font-black">Conversas</h1>
                </div>
                <Button
                  onClick={() => void startConversation()}
                  className="rounded-xl bg-cyan-300 font-bold text-[#06101c] hover:bg-cyan-200"
                  size="sm"
                >
                  <MessageCircle className="mr-2 h-4 w-4" /> Nova
                </Button>
              </div>

              <div className="mt-4 flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-black/15 px-3 text-slate-400 focus-within:border-cyan-300/30">
                <Search className="h-4 w-4" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar conversa"
                  className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-600"
                />
                <button
                  onClick={() => void conversations.refetch()}
                  className="rounded-lg p-1.5 hover:bg-white/5 hover:text-white"
                  title="Atualizar conversas"
                >
                  <RefreshCw className={`h-4 w-4 ${conversations.isFetching ? "animate-spin" : ""}`} />
                </button>
              </div>

              {!connection.isLoading && !connection.data?.connected && (
                <button
                  onClick={() => void connect()}
                  className="mt-3 flex w-full items-center justify-between rounded-xl border border-amber-300/15 bg-amber-300/[0.05] px-3 py-2.5 text-left"
                >
                  <span>
                    <span className="block text-xs font-bold text-amber-100">Conecte seu WhatsApp</span>
                    <span className="mt-0.5 block text-[11px] text-slate-400">Para enviar e receber mensagens.</span>
                  </span>
                  <Link2 className="h-4 w-4 text-amber-200" />
                </button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {filtered.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  selected={conversation.id === selectedId}
                  onClick={() => setSelectedId(conversation.id)}
                />
              ))}
              {!conversations.isLoading && filtered.length === 0 && (
                <div className="px-6 py-12 text-center text-sm text-slate-500">
                  <MessageCircle className="mx-auto mb-3 h-8 w-8 opacity-50" />
                  Nenhuma conversa encontrada.
                </div>
              )}
            </div>
          </aside>

          <section className={`${selectedId ? "flex" : "hidden lg:flex"} min-h-0 flex-col bg-[#07111f]`}>
            {!selected ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="grid h-20 w-20 place-items-center rounded-3xl bg-cyan-300/[0.07] text-cyan-200 ring-1 ring-cyan-300/15">
                  <MessageCircle className="h-9 w-9" />
                </div>
                <h2 className="mt-6 text-2xl font-black">Atendimento MercadoImobi</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">
                  Selecione uma conversa para visualizar o histórico e continuar o atendimento em um único lugar.
                </p>
              </div>
            ) : (
              <>
                <div className="flex h-16 items-center justify-between border-b border-white/10 px-3 sm:px-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <button
                      onClick={() => setSelectedId(null)}
                      className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-slate-300 lg:hidden"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                    <Avatar conversation={selected} />
                    <div className="min-w-0">
                      <p className="truncate font-bold">{selected.contact_name || formatPhone(selected.phone_e164)}</p>
                      <p className="truncate text-xs text-slate-500">{formatPhone(selected.phone_e164)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => void messages.refetch()}
                      className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 hover:bg-white/5 hover:text-white"
                      title="Atualizar conversa"
                    >
                      <RefreshCw className={`h-4 w-4 ${messages.isFetching ? "animate-spin" : ""}`} />
                    </button>
                    <button
                      disabled
                      className="grid h-9 w-9 place-items-center rounded-xl text-slate-600"
                      title="Mais opções serão habilitadas quando disponíveis"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div
                  ref={scrollRef}
                  className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(34,211,238,.045),_transparent_35%)] px-4 py-6 sm:px-8"
                >
                  <div className="mx-auto max-w-4xl space-y-2">
                    {(messages.data ?? []).map((message) => (
                      <MessageBubble key={message.id} message={message} />
                    ))}
                    {!messages.isLoading && (messages.data?.length ?? 0) === 0 && (
                      <div className="py-16 text-center text-sm text-slate-500">
                        Ainda não há mensagens nesta conversa.
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-white/10 bg-[#091625] p-3 sm:p-4">
                  <div className="mx-auto flex max-w-4xl items-end gap-2">
                    <button
                      disabled
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 text-slate-600"
                      title="Envio de arquivos será habilitado quando o canal suportar mídia"
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
                      placeholder={connection.data?.connected ? "Digite uma mensagem" : "Conecte seu WhatsApp para enviar"}
                      disabled={!connection.data?.connected}
                      className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/30 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <button
                      onClick={() => void send()}
                      disabled={!text.trim() || sending || !connection.data?.connected}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-cyan-300 text-[#06101c] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-600"
                      title="Enviar mensagem"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </main>

      {showQr && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-md" onClick={() => setShowQr(false)}>
          <div className="w-full max-w-sm rounded-[28px] border border-white/10 bg-[#0b1727] p-6 text-center shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-xl font-black">Conectar WhatsApp</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">Abra o WhatsApp no celular e use a opção de conectar um dispositivo.</p>
            {qrBase64 ? (
              <img
                src={qrBase64.startsWith("data:") ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                alt="Código para conectar WhatsApp"
                className="mx-auto mt-5 aspect-square w-64 rounded-2xl bg-white p-3"
              />
            ) : qrCode ? (
              <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4 text-xs break-all text-slate-300">{qrCode}</div>
            ) : (
              <p className="mt-5 rounded-2xl border border-amber-300/15 bg-amber-300/[0.04] p-4 text-sm text-amber-100">A conexão foi iniciada. Atualize em alguns instantes para verificar o status.</p>
            )}
            <div className="mt-5 flex gap-2">
              <Button variant="outline" className="flex-1 border-white/10 bg-transparent text-white hover:bg-white/5" onClick={() => setShowQr(false)}>Fechar</Button>
              <Button className="flex-1 bg-cyan-300 font-bold text-[#06101c] hover:bg-cyan-200" onClick={() => void connection.refetch()}>Verificar conexão</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectionPill({ connected, loading }: { connected: boolean; loading: boolean }) {
  return (
    <span className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold sm:inline-flex ${connected ? "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-200" : "border-white/10 bg-white/[0.03] text-slate-400"}`}>
      {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
      {loading ? "Verificando" : connected ? "WhatsApp conectado" : "WhatsApp desconectado"}
    </span>
  );
}

function ConversationRow({ conversation, selected, onClick }: { conversation: WhatsAppConversation; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-3 border-b border-white/[0.06] px-4 py-3 text-left transition ${selected ? "bg-cyan-300/[0.08]" : "hover:bg-white/[0.035]"}`}>
      <Avatar conversation={conversation} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-bold text-slate-100">{conversation.contact_name || formatPhone(conversation.phone_e164)}</p>
          <span className="shrink-0 text-[10px] text-slate-600">{formatTime(conversation.last_message_at)}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-slate-500">{conversation.last_message || "Nova conversa"}</p>
          {conversation.unread_count > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-cyan-300 px-1 text-[10px] font-black text-[#06101c]">{conversation.unread_count > 99 ? "99+" : conversation.unread_count}</span>
          )}
        </div>
      </div>
    </button>
  );
}

function Avatar({ conversation }: { conversation: WhatsAppConversation }) {
  const initials = (conversation.contact_name || conversation.phone_e164).slice(0, 2).toUpperCase();
  return conversation.avatar_url ? (
    <img src={conversation.avatar_url} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
  ) : (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-300/20 to-blue-500/10 text-xs font-black text-cyan-100 ring-1 ring-white/10">{initials}</span>
  );
}

function MessageBubble({ message }: { message: { id: string; direction: "inbound" | "outbound"; body: string | null; media_url: string | null; message_type: string; status: string; sent_at: string } }) {
  const outgoing = message.direction === "outbound";
  return (
    <div className={`flex ${outgoing ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm shadow-lg sm:max-w-[68%] ${outgoing ? "rounded-br-md bg-cyan-300 text-[#06101c]" : "rounded-bl-md border border-white/10 bg-[#102236] text-slate-100"}`}>
        {message.media_url && (
          <a href={message.media_url} target="_blank" rel="noreferrer" className={`mb-1 block text-xs font-semibold underline ${outgoing ? "text-[#06101c]" : "text-cyan-200"}`}>Abrir {message.message_type === "text" ? "arquivo" : message.message_type}</a>
        )}
        <p className="whitespace-pre-wrap break-words">{message.body || (message.media_url ? "Mídia" : "Mensagem")}</p>
        <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${outgoing ? "text-[#143342]" : "text-slate-500"}`}>
          {formatTime(message.sent_at)}
          {outgoing && <CheckCheck className="h-3 w-3" />}
        </div>
      </div>
    </div>
  );
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  if (digits.length === 12 && digits.startsWith("55")) return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  return `+${digits}`;
}

function formatTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(date);
}
