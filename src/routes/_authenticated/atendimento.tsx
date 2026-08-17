import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  CheckCheck,
  ExternalLink,
  FileText,
  Link2,
  MessageCircle,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Smile,
  Sparkles,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { generateConversationDraft, getAiRuntimeStatus } from "@/lib/ai-assistant.functions";
import { prepareWhatsAppConnection } from "@/lib/whatsapp-connection.functions";
import { startWhatsAppConversation } from "@/lib/whatsapp-conversation.functions";
import { sendWhatsAppAttachment } from "@/lib/whatsapp-media.functions";
import {
  getWhatsAppConnectionStatus,
  getWhatsAppQrCode,
  listWhatsAppConversations,
  listWhatsAppMessages,
  markWhatsAppConversationRead,
  sendWhatsAppText,
  type WhatsAppConversation,
} from "@/lib/whatsapp-tenant.functions";

export const Route = createFileRoute("/_authenticated/atendimento")({
  component: AtendimentoPage,
  head: () => ({ title: "Conversas | MercadoImobi" }),
});

type PropertyContext = {
  id?: string;
  title?: string;
  url?: string | null;
};

type PendingAttachment = {
  fileName: string;
  mimeType: string;
  base64: string;
  size: number;
};

const EMOJIS = [
  "😀", "😃", "😄", "😁", "😊", "😍", "🥰", "😉",
  "🙂", "🤩", "😎", "🤝", "👍", "👏", "🙏", "💪",
  "❤️", "💙", "💚", "✨", "🎉", "🔥", "✅", "⭐",
  "🏠", "🏡", "🏢", "🔑", "📍", "📅", "📞", "💬",
  "💰", "📄", "📎", "🚀", "👀", "🤔", "☺️", "🙌",
];

function readFileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const base64 = result.includes(",") ? result.split(",")[1] ?? "" : result;
      if (!base64) reject(new Error("Não foi possível ler o arquivo."));
      else resolve(base64);
    };
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

function AtendimentoPage() {
  const statusFn = useServerFn(getWhatsAppConnectionStatus);
  const qrFn = useServerFn(getWhatsAppQrCode);
  const prepareFn = useServerFn(prepareWhatsAppConnection);
  const conversationsFn = useServerFn(listWhatsAppConversations);
  const messagesFn = useServerFn(listWhatsAppMessages);
  const markReadFn = useServerFn(markWhatsAppConversationRead);
  const sendFn = useServerFn(sendWhatsAppText);
  const attachmentFn = useServerFn(sendWhatsAppAttachment);
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
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [propertyContext, setPropertyContext] = useState<PropertyContext | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const connection = useQuery({
    queryKey: ["whatsapp-connection"],
    queryFn: () => statusFn(),
    refetchInterval: showQr ? 4_000 : 30_000,
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
    setPendingAttachment(null);
    setShowEmoji(false);
    void markReadFn({ data: { conversationId: selectedId } }).then(() => conversations.refetch());
  }, [selectedId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.data?.length, selectedId]);

  useEffect(() => {
    if (!showQr) return;
    if (connection.data?.connected) {
      setShowQr(false);
      setQrBase64(null);
      setQrCode(null);
      setPairingCode(null);
      toast.success("WhatsApp conectado com sucesso.");
      void conversations.refetch();
    }
  }, [showQr, connection.data?.connected]);

  useEffect(() => {
    if (!showQr || connection.data?.connected) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const qr = await qrFn();
        if (cancelled) return;
        if (qr.base64) setQrBase64(qr.base64);
        if (qr.code) setQrCode(qr.code);
        if (qr.pairingCode) setPairingCode(qr.pairingCode);
      } catch {
        // O QR expira e é renovado pela Evolution; a próxima tentativa continua o polling.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [showQr, connection.data?.connected]);

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

  const refreshQr = async () => {
    setQrLoading(true);
    try {
      const qr = await qrFn();
      setQrBase64(qr.base64);
      setQrCode(qr.code);
      setPairingCode(qr.pairingCode);
      await connection.refetch();
    } catch {
      toast.error("Ainda não foi possível gerar o QR Code. Tente novamente em alguns segundos.");
    } finally {
      setQrLoading(false);
    }
  };

  const connect = async () => {
    setShowQr(true);
    setQrLoading(true);
    setQrBase64(null);
    setQrCode(null);
    setPairingCode(null);
    try {
      const prepared = await prepareFn();
      if (!prepared.configured) {
        setShowQr(false);
        toast.info("O gateway do WhatsApp ainda precisa ser ativado no servidor.");
        return;
      }
      if (prepared.connected) {
        setShowQr(false);
        await connection.refetch();
        toast.success("Seu WhatsApp já está conectado.");
        return;
      }
      if (prepared.qrBase64) setQrBase64(prepared.qrBase64);
      if (prepared.qrCode) setQrCode(prepared.qrCode);
      if (prepared.pairingCode) setPairingCode(prepared.pairingCode);
      if (!prepared.qrBase64 && !prepared.qrCode) await refreshQr();
      await connection.refetch();
    } catch (error) {
      setShowQr(false);
      toast.error(
        error instanceof Error
          ? `Não foi possível iniciar a conexão: ${error.message}`
          : "Não foi possível iniciar a conexão agora.",
      );
    } finally {
      setQrLoading(false);
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

  const selectAttachment = async (file: File | null) => {
    if (!file) return;
    const maxAttachmentMb = connection.data?.maxAttachmentMb ?? 8;
    if (file.size > maxAttachmentMb * 1024 * 1024) {
      toast.error(`O arquivo deve ter no máximo ${maxAttachmentMb} MB.`);
      return;
    }
    const mimeType = file.type || "application/octet-stream";
    try {
      const base64 = await readFileBase64(file);
      setPendingAttachment({ fileName: file.name, mimeType, base64, size: file.size });
      setShowEmoji(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível anexar o arquivo.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const send = async () => {
    if (!selectedId || sending || (!text.trim() && !pendingAttachment)) return;
    if (!connection.data?.connected) {
      toast.info("Conecte seu WhatsApp para enviar mensagens.");
      return;
    }
    const outgoing = text.trim();
    setSending(true);
    try {
      if (pendingAttachment) {
        await attachmentFn({
          data: {
            conversationId: selectedId,
            fileName: pendingAttachment.fileName,
            mimeType: pendingAttachment.mimeType,
            base64: pendingAttachment.base64,
            caption: outgoing || undefined,
          },
        });
        setPendingAttachment(null);
        setText("");
        toast.success("Arquivo enviado pelo WhatsApp.");
      } else {
        await sendFn({ data: { conversationId: selectedId, text: outgoing } });
        setText("");
      }
      setShowEmoji(false);
      await Promise.all([messages.refetch(), conversations.refetch()]);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "A mensagem não foi enviada. Verifique a conexão e tente novamente.",
      );
    } finally {
      setSending(false);
    }
  };

  const suggest = async () => {
    if (!selectedId || drafting) return;
    if (!aiStatus.data?.configured) {
      toast.info("A IA ainda precisa ser configurada no servidor.");
      return;
    }
    setDrafting(true);
    try {
      const result = await draftFn({ data: { conversationId: selectedId } });
      setText(result.text);
    } catch {
      toast.error("Não foi possível gerar uma sugestão agora.");
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-72px)] bg-[var(--mi-bg)] px-4 py-5 text-[var(--mi-text)] sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-112px)] max-w-[1500px] overflow-hidden rounded-[28px] border border-[var(--mi-border)] bg-[var(--mi-surface)] shadow-sm">
        <aside className="flex w-[360px] shrink-0 flex-col border-r border-[var(--mi-border)] bg-[var(--mi-surface-soft)]">
          <div className="border-b border-[var(--mi-border)] p-4">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => void startConversation()}
                className="h-10 flex-1 rounded-xl border-[var(--mi-border)] bg-[var(--mi-surface)] font-black"
              >
                <MessageCircle className="mr-2 h-4 w-4" /> Nova conversa
              </Button>
              <span
                className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-black ${connection.data?.connected ? "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-700 dark:text-emerald-200" : "border-amber-300/20 bg-amber-300/[0.05] text-amber-700 dark:text-amber-100"}`}
              >
                {connection.data?.connected ? <Link2 className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                {connection.data?.connected ? "Conectado" : "Desconectado"}
              </span>
            </div>
            {!connection.data?.connected && (
              <Button
                onClick={() => void connect()}
                className="mt-3 h-11 w-full rounded-xl bg-emerald-600 font-black text-white hover:bg-emerald-700"
              >
                <Link2 className="mr-2 h-4 w-4" /> Conectar meu WhatsApp por QR Code
              </Button>
            )}
            <div className="mt-3 flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--mi-text-soft)]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar conversa"
                  className="h-10 w-full rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface)] pl-9 pr-3 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <Button
                size="icon"
                variant="outline"
                onClick={() => {
                  void conversations.refetch();
                  if (selectedId) void messages.refetch();
                }}
                className="h-10 w-10 rounded-xl border-[var(--mi-border)]"
                title="Atualizar conversas"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.map((conversation: WhatsAppConversation) => (
              <button
                type="button"
                key={conversation.id}
                onClick={() => {
                  setSelectedId(conversation.id);
                  setPropertyContext(null);
                }}
                className={`flex w-full items-start gap-3 border-b border-[var(--mi-border)] px-4 py-3 text-left transition ${selectedId === conversation.id ? "bg-blue-500/10" : "hover:bg-[var(--mi-surface)]"}`}
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue-500/10 text-xs font-black text-blue-600">
                  {(conversation.contact_name || conversation.phone_e164).slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-black">
                      {conversation.contact_name || `+${conversation.phone_e164}`}
                    </span>
                    {conversation.last_message_at && (
                      <span className="shrink-0 text-[10px] text-[var(--mi-text-soft)]">
                        {new Date(conversation.last_message_at).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className="truncate text-xs text-[var(--mi-text-soft)]">
                      {conversation.last_message || "Nova conversa"}
                    </span>
                    {conversation.unread_count > 0 && (
                      <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-black text-white">
                        {conversation.unread_count}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              <header className="flex items-center justify-between gap-3 border-b border-[var(--mi-border)] px-5 py-4">
                <div className="min-w-0">
                  <p className="truncate font-black">{selected.contact_name || `+${selected.phone_e164}`}</p>
                  <p className="mt-0.5 text-xs text-[var(--mi-text-soft)]">+{selected.phone_e164}</p>
                </div>
                <div className="flex items-center gap-2 text-xs font-bold text-[var(--mi-text-soft)]">
                  {connection.data?.connected ? (
                    <>
                      <Wifi className="h-4 w-4 text-emerald-600" /> WhatsApp online
                    </>
                  ) : (
                    <>
                      <WifiOff className="h-4 w-4 text-amber-600" /> WhatsApp offline
                    </>
                  )}
                </div>
              </header>

              {propertyContext && (
                <div className="border-b border-[var(--mi-border)] bg-blue-500/[0.04] px-5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-blue-600">
                        Imóvel relacionado
                      </p>
                      <p className="mt-1 truncate text-sm font-bold">
                        {propertyContext.title || "Imóvel selecionado"}
                      </p>
                    </div>
                    {propertyContext.url && (
                      <a
                        href={propertyContext.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-black text-blue-600"
                      >
                        Abrir anúncio <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              )}

              <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5">
                <div className="space-y-3">
                  {(messages.data ?? []).map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-5 shadow-sm ${
                          message.direction === "outbound"
                            ? "rounded-br-md bg-blue-600 text-white"
                            : "rounded-bl-md border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] text-[var(--mi-text)]"
                        }`}
                      >
                        {message.message_type !== "text" && (
                          <div className="mb-1 flex items-center gap-2 text-xs font-black">
                            <FileText className="h-4 w-4" /> Arquivo do WhatsApp
                          </div>
                        )}
                        {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
                        {!message.body && message.media_url && (
                          <a
                            href={message.media_url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-bold underline"
                          >
                            Abrir mídia recebida
                          </a>
                        )}
                        <div
                          className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${message.direction === "outbound" ? "text-blue-100" : "text-[var(--mi-text-soft)]"}`}
                        >
                          {new Date(message.sent_at).toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {message.direction === "outbound" && <CheckCheck className="h-3 w-3" />}
                        </div>
                      </div>
                    </div>
                  ))}
                  {(messages.data?.length ?? 0) === 0 && (
                    <div className="py-20 text-center text-sm text-[var(--mi-text-soft)]">
                      Ainda não há mensagens nesta conversa.
                    </div>
                  )}
                </div>
              </div>

              <footer className="relative border-t border-[var(--mi-border)] p-4">
                <div className="mb-2 flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!aiStatus.data?.configured || drafting}
                    onClick={() => void suggest()}
                    className="rounded-xl border-blue-300/40 text-blue-600"
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    {drafting ? "Gerando..." : "Sugerir resposta com IA"}
                  </Button>
                </div>

                {pendingAttachment && (
                  <div className="mb-2 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-slate-800">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-blue-600">
                      <FileText className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-black">{pendingAttachment.fileName}</p>
                      <p className="text-[10px] text-slate-500">
                        {(pendingAttachment.size / 1024 / 1024).toFixed(2)} MB · pronto para enviar
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPendingAttachment(null)}
                      className="rounded-lg p-1 text-slate-500 hover:bg-white"
                      aria-label="Remover anexo"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {showEmoji && (
                  <div className="absolute bottom-[82px] left-16 z-20 w-72 rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-3 shadow-xl">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-black">Emojis</p>
                      <button type="button" onClick={() => setShowEmoji(false)} aria-label="Fechar emojis">
                        <X className="h-4 w-4 text-[var(--mi-text-soft)]" />
                      </button>
                    </div>
                    <div className="grid grid-cols-8 gap-1">
                      {EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => setText((current) => `${current}${emoji}`)}
                          className="grid h-8 w-8 place-items-center rounded-lg text-xl hover:bg-[var(--mi-surface-soft)]"
                          title={emoji}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*,video/mp4,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                  onChange={(event) => void selectAttachment(event.target.files?.[0] ?? null)}
                />

                <div className="flex items-end gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-12 w-12 rounded-xl"
                    disabled={sending || !connection.data?.connected}
                    onClick={() => fileInputRef.current?.click()}
                    title="Anexar documento, foto ou arquivo"
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-12 w-12 rounded-xl"
                    disabled={sending}
                    onClick={() => setShowEmoji((open) => !open)}
                    title="Adicionar emoji"
                  >
                    <Smile className="h-5 w-5" />
                  </Button>
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
                    placeholder={pendingAttachment ? "Adicione uma legenda (opcional)" : "Digite uma mensagem"}
                    className="max-h-32 min-h-12 flex-1 resize-none rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-4 py-3 text-sm outline-none focus:border-blue-500"
                  />
                  <Button
                    size="icon"
                    onClick={() => void send()}
                    disabled={sending || (!text.trim() && !pendingAttachment) || !connection.data?.connected}
                    className="h-12 w-12 rounded-xl bg-blue-600 text-white hover:bg-blue-700"
                  >
                    {sending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="mt-2 text-[10px] text-[var(--mi-text-soft)]">
                  Anexos: PDF, documentos Office, imagens, vídeo MP4 e arquivos de texto · até {connection.data?.maxAttachmentMb ?? 8} MB.
                </p>
              </footer>
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div>
                <MessageCircle className="mx-auto h-10 w-10 text-[var(--mi-text-soft)]" />
                <h2 className="mt-3 text-lg font-black">Selecione uma conversa</h2>
                <p className="mt-1 text-sm text-[var(--mi-text-soft)]">
                  As mensagens recebidas pelo WhatsApp aparecerão aqui em tempo real.
                </p>
                {!connection.data?.connected && (
                  <Button onClick={() => void connect()} className="mt-5 rounded-xl bg-emerald-600 text-white">
                    <Link2 className="mr-2 h-4 w-4" /> Conectar WhatsApp
                  </Button>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {showQr && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-slate-950 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-black">Conectar meu WhatsApp</h2>
              <button type="button" onClick={() => setShowQr(false)} aria-label="Fechar">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              No WhatsApp do celular, abra Configurações → Aparelhos conectados → Conectar aparelho e leia o QR Code abaixo.
            </p>
            <div className="mt-5 grid min-h-60 place-items-center rounded-2xl bg-slate-50 p-4">
              {qrBase64 ? (
                <img
                  src={qrBase64.startsWith("data:") ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                  alt="QR Code para conectar o WhatsApp"
                  className="h-56 w-56"
                />
              ) : qrCode ? (
                <div className="break-all rounded-xl bg-white p-3 text-xs text-slate-600">{qrCode}</div>
              ) : (
                <div className="text-center">
                  <RefreshCw className={`mx-auto h-7 w-7 text-slate-400 ${qrLoading ? "animate-spin" : ""}`} />
                  <p className="mt-3 text-sm text-slate-500">Gerando QR Code seguro para esta conta...</p>
                </div>
              )}
            </div>
            {pairingCode && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Código de pareamento</p>
                <p className="mt-1 font-mono text-xl font-black tracking-[0.18em]">{pairingCode}</p>
              </div>
            )}
            <p className="mt-3 text-center text-xs text-slate-500">
              O status é atualizado automaticamente. Após a leitura, esta janela fecha quando a conexão estiver online.
            </p>
            <Button
              variant="outline"
              onClick={() => void refreshQr()}
              disabled={qrLoading}
              className="mt-4 h-10 w-full rounded-xl"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${qrLoading ? "animate-spin" : ""}`} /> Atualizar QR Code
            </Button>
            <Button
              onClick={() => {
                setShowQr(false);
                void connection.refetch();
              }}
              className="mt-2 h-11 w-full rounded-xl bg-blue-600 font-black text-white"
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Voltar ao atendimento
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
