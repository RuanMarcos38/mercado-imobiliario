import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCheck, MessageCircle, RefreshCw, Search, Send } from "lucide-react";
import { toast } from "sonner";
import {
  getWhatsAppConnectionStatus,
  listWhatsAppConversations,
  listWhatsAppMessages,
  sendWhatsAppText,
} from "@/lib/whatsapp-tenant.functions";

export function DashboardAtendimentoPanel() {
  const statusFn = useServerFn(getWhatsAppConnectionStatus);
  const conversationsFn = useServerFn(listWhatsAppConversations);
  const messagesFn = useServerFn(listWhatsAppMessages);
  const sendFn = useServerFn(sendWhatsAppText);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const connection = useQuery({
    queryKey: ["dashboard-whatsapp-status"],
    queryFn: () => statusFn(),
    refetchInterval: 30_000,
  });
  const conversations = useQuery({
    queryKey: ["dashboard-whatsapp-conversations"],
    queryFn: () => conversationsFn(),
    refetchInterval: 30_000,
  });
  const messages = useQuery({
    queryKey: ["dashboard-whatsapp-messages", selectedId],
    queryFn: () => messagesFn({ data: { conversationId: selectedId! } }),
    enabled: Boolean(selectedId),
    refetchInterval: selectedId ? 20_000 : false,
  });

  useEffect(() => {
    if (!selectedId && conversations.data?.[0]?.id) setSelectedId(conversations.data[0].id);
  }, [selectedId, conversations.data]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return conversations.data ?? [];
    return (conversations.data ?? []).filter((item) =>
      [item.contact_name, item.phone_e164, item.last_message]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [conversations.data, query]);

  const selected = (conversations.data ?? []).find((item) => item.id === selectedId) ?? null;
  const recentMessages = (messages.data ?? []).slice(-5);

  const send = async () => {
    if (!selectedId || !draft.trim() || sending) return;
    if (!connection.data?.connected) {
      toast.info("Conecte o WhatsApp no Atendimento para enviar mensagens.");
      return;
    }
    setSending(true);
    try {
      await sendFn({ data: { conversationId: selectedId, text: draft.trim() } });
      setDraft("");
      await Promise.all([messages.refetch(), conversations.refetch()]);
    } catch {
      toast.error("A mensagem não foi enviada.");
    } finally {
      setSending(false);
    }
  };

  return (
    <aside className="mi-results-card hidden min-h-[680px] flex-col overflow-hidden lg:sticky lg:top-20 lg:self-start lg:flex">
      <div className="mi-chat-header flex items-center justify-between border-b px-4 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-black">Atendimento</h2>
            <span
              className={`h-2 w-2 rounded-full ${connection.data?.connected ? "bg-emerald-500" : "bg-slate-400"}`}
            />
          </div>
          <p className="mt-1 text-[11px] text-[var(--mi-text-muted)]">
            {connection.isLoading
              ? "Verificando conexão"
              : connection.data?.connected
                ? "WhatsApp conectado"
                : "WhatsApp desconectado"}
          </p>
        </div>
        <Link to="/atendimento" className="mi-icon-button" title="Abrir Atendimento">
          <MessageCircle className="h-4 w-4" />
        </Link>
      </div>

      <div className="border-b border-[var(--mi-border)] p-3">
        <div className="mi-input flex h-10 items-center gap-2 px-3">
          <Search className="h-4 w-4 text-[var(--mi-text-muted)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar conversas..."
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--mi-text-soft)]"
          />
          <button onClick={() => void conversations.refetch()} title="Atualizar conversas">
            <RefreshCw
              className={`h-3.5 w-3.5 text-[var(--mi-text-muted)] ${conversations.isFetching ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </div>

      <div className="max-h-64 overflow-y-auto border-b border-[var(--mi-border)]">
        {filtered.slice(0, 6).map((item) => (
          <button
            key={item.id}
            onClick={() => setSelectedId(item.id)}
            className={`flex w-full items-center gap-3 border-b border-[var(--mi-border-soft)] px-4 py-3 text-left transition ${item.id === selectedId ? "bg-[var(--mi-accent-soft)]" : "hover:bg-[var(--mi-hover)]"}`}
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--mi-accent-soft)] text-xs font-black text-[var(--mi-accent)]">
              {(item.contact_name || item.phone_e164).slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-bold">
                  {item.contact_name || formatPhone(item.phone_e164)}
                </span>
                <span className="shrink-0 text-[10px] text-[var(--mi-text-soft)]">
                  {formatTime(item.last_message_at)}
                </span>
              </span>
              <span className="mt-0.5 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--mi-text-muted)]">
                  {item.last_message || "Nova conversa"}
                </span>
                {item.unread_count > 0 && (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-blue-600 px-1 text-[10px] font-black text-white">
                    {item.unread_count > 99 ? "99+" : item.unread_count}
                  </span>
                )}
              </span>
            </span>
          </button>
        ))}
        {!conversations.isLoading && filtered.length === 0 && (
          <div className="px-5 py-10 text-center text-xs text-[var(--mi-text-muted)]">
            Nenhuma conversa disponível.
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {selected ? (
          <>
            <div className="border-b border-[var(--mi-border)] px-4 py-3">
              <p className="text-xs font-black">
                {selected.contact_name || formatPhone(selected.phone_e164)}
              </p>
              <p className="mt-0.5 text-[10px] text-[var(--mi-text-muted)]">
                {formatPhone(selected.phone_e164)}
              </p>
            </div>
            <div className="mi-chat-canvas min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
              {recentMessages.map((message) => {
                const outgoing = message.direction === "outbound";
                return (
                  <div
                    key={message.id}
                    className={`flex ${outgoing ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[86%] rounded-2xl px-3 py-2 text-[11px] leading-5 ${outgoing ? "mi-chat-outgoing rounded-br-md" : "mi-chat-incoming rounded-bl-md"}`}
                    >
                      <p className="whitespace-pre-wrap">{message.body || "Mensagem"}</p>
                      <span className="mt-0.5 flex items-center justify-end gap-1 text-[9px] opacity-70">
                        {formatTime(message.sent_at)}{" "}
                        {outgoing && <CheckCheck className="h-3 w-3" />}
                      </span>
                    </div>
                  </div>
                );
              })}
              {!messages.isLoading && recentMessages.length === 0 && (
                <p className="py-10 text-center text-[11px] text-[var(--mi-text-muted)]">
                  Sem mensagens recentes.
                </p>
              )}
            </div>
            <div className="border-t border-[var(--mi-border)] p-3">
              <div className="mi-input flex min-h-11 items-end gap-2 p-2">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={1}
                  disabled={!connection.data?.connected}
                  placeholder={
                    connection.data?.connected
                      ? "Digite sua mensagem..."
                      : "Conecte o WhatsApp para responder"
                  }
                  className="max-h-24 min-h-7 flex-1 resize-none bg-transparent px-1 py-1 text-xs outline-none placeholder:text-[var(--mi-text-soft)] disabled:cursor-not-allowed"
                />
                <button
                  onClick={() => void send()}
                  disabled={!draft.trim() || sending || !connection.data?.connected}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-600 text-white disabled:bg-[var(--mi-surface-strong)] disabled:text-[var(--mi-text-soft)]"
                  title="Enviar mensagem"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <MessageCircle className="h-8 w-8 text-[var(--mi-text-soft)]" />
            <p className="mt-3 text-xs font-bold">Atendimento integrado</p>
            <p className="mt-1 text-[11px] leading-5 text-[var(--mi-text-muted)]">
              As conversas iniciadas pelos imóveis aparecerão aqui.
            </p>
          </div>
        )}
      </div>

      <Link
        to="/atendimento"
        className="border-t border-[var(--mi-border)] px-4 py-3 text-center text-xs font-bold text-blue-600 hover:bg-[var(--mi-hover)]"
      >
        Ver todas as conversas
      </Link>
    </aside>
  );
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55"))
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  return digits ? `+${digits}` : value;
}

function formatTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(date);
}
