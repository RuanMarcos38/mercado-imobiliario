import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Facebook,
  Instagram,
  Link2,
  LogOut,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  disconnectMetaSocialAccount,
  getMetaSocialStatus,
  listSocialConversations,
  listSocialMessages,
  sendSocialText,
} from "@/lib/meta-social.functions";

export const Route = createFileRoute("/_authenticated/midias-sociais")({
  component: SocialInboxPage,
  head: () => ({ title: "Facebook e Instagram | MercadoImobi" }),
});

type Channel = "all" | "facebook" | "instagram";

type Conversation = Awaited<ReturnType<typeof listSocialConversations>> extends never
  ? never
  : {
      id: string;
      conversationId: string;
      channel: "facebook" | "instagram";
      pageId: string;
      accountName: string;
      contactId: string;
      contactName: string;
      lastMessage: string;
      updatedTime: string | null;
    };

function SocialInboxPage() {
  const statusFn = useServerFn(getMetaSocialStatus);
  const conversationsFn = useServerFn(listSocialConversations);
  const messagesFn = useServerFn(listSocialMessages);
  const sendFn = useServerFn(sendSocialText);
  const disconnectFn = useServerFn(disconnectMetaSocialAccount);

  const [channel, setChannel] = useState<Channel>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const status = useQuery({
    queryKey: ["meta-social-status"],
    queryFn: () => statusFn(),
    refetchInterval: 60_000,
  });
  const conversations = useQuery({
    queryKey: ["social-conversations", channel],
    queryFn: () => conversationsFn({ data: { channel } }),
    enabled: Boolean(status.data?.connected),
    refetchInterval: status.data?.connected ? 15_000 : false,
  });

  const selected = (conversations.data ?? []).find((item) => item.id === selectedId) ?? null;
  const messages = useQuery({
    queryKey: ["social-messages", selected?.id],
    queryFn: () =>
      messagesFn({
        data: {
          pageId: selected!.pageId,
          conversationId: selected!.conversationId,
          channel: selected!.channel,
        },
      }),
    enabled: Boolean(selected),
    refetchInterval: selected ? 12_000 : false,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const meta = params.get("meta");
    if (meta === "connected") {
      toast.success("Facebook/Instagram conectados com sucesso.");
      window.history.replaceState({}, "", "/midias-sociais");
      void status.refetch();
    } else if (meta === "error") {
      toast.error(params.get("reason") || "A conexão com o Meta não foi concluída.");
      window.history.replaceState({}, "", "/midias-sociais");
    }
  }, []);

  useEffect(() => {
    if (selectedId && !selected && !conversations.isFetching) setSelectedId(null);
  }, [selectedId, selected, conversations.isFetching]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return conversations.data ?? [];
    return (conversations.data ?? []).filter((item) =>
      [item.contactName, item.accountName, item.lastMessage, item.channel]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [conversations.data, search]);

  const connect = () => {
    if (!status.data?.configured || !status.data.connectUrl) {
      toast.info("Configure META_APP_ID e META_APP_SECRET no servidor para liberar a conexão.");
      return;
    }
    window.location.assign(status.data.connectUrl);
  };

  const disconnect = async () => {
    if (!window.confirm("Desconectar Facebook e Instagram desta conta?")) return;
    try {
      await disconnectFn();
      setSelectedId(null);
      await Promise.all([status.refetch(), conversations.refetch()]);
      toast.success("Integração Meta desconectada.");
    } catch {
      toast.error("Não foi possível desconectar agora.");
    }
  };

  const send = async () => {
    if (!selected || !text.trim() || sending) return;
    setSending(true);
    try {
      await sendFn({
        data: {
          pageId: selected.pageId,
          channel: selected.channel,
          recipientId: selected.contactId,
          text: text.trim(),
        },
      });
      setText("");
      await Promise.all([messages.refetch(), conversations.refetch()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "A mensagem não foi enviada.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[var(--mi-bg)] px-4 py-5 text-[var(--mi-text)] sm:px-6">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Omnichannel</p>
            <h1 className="mt-1 text-2xl font-black">Facebook e Instagram</h1>
            <p className="mt-1 text-sm text-[var(--mi-text-muted)]">
              Centralize as conversas das páginas e perfis profissionais conectados, sem misturar contas de outros usuários.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/atendimento">
              <Button variant="outline" className="rounded-xl border-[var(--mi-border)]">
                <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp
              </Button>
            </Link>
            {status.data?.connected ? (
              <Button variant="outline" onClick={() => void disconnect()} className="rounded-xl border-[var(--mi-border)] text-rose-600">
                <LogOut className="mr-2 h-4 w-4" /> Desconectar Meta
              </Button>
            ) : (
              <Button onClick={connect} className="rounded-xl bg-blue-600 font-black text-white hover:bg-blue-700">
                <Link2 className="mr-2 h-4 w-4" /> Conectar Facebook e Instagram
              </Button>
            )}
          </div>
        </div>

        <div className="flex min-h-[calc(100vh-170px)] overflow-hidden rounded-[28px] border border-[var(--mi-border)] bg-[var(--mi-surface)] shadow-sm">
          <aside className="flex w-[370px] shrink-0 flex-col border-r border-[var(--mi-border)] bg-[var(--mi-surface-soft)]">
            <div className="border-b border-[var(--mi-border)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-black">Conversas</p>
                  <p className="mt-0.5 text-[11px] text-[var(--mi-text-soft)]">
                    {status.data?.connected ? `${status.data.pages.length} página(s) conectada(s)` : "Nenhuma conta conectada"}
                  </p>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black ${status.data?.connected ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"}`}>
                  {status.data?.connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                  {status.data?.connected ? "ONLINE" : "OFFLINE"}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <ChannelButton active={channel === "all"} onClick={() => setChannel("all")} label="Todas" />
                <ChannelButton active={channel === "facebook"} onClick={() => setChannel("facebook")} label="Facebook" icon={<Facebook className="h-3.5 w-3.5" />} />
                <ChannelButton active={channel === "instagram"} onClick={() => setChannel("instagram")} label="Instagram" icon={<Instagram className="h-3.5 w-3.5" />} />
              </div>

              <div className="mt-3 flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--mi-text-soft)]" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar conversa" className="h-10 w-full rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface)] pl-9 pr-3 text-sm outline-none focus:border-blue-500" />
                </div>
                <Button size="icon" variant="outline" onClick={() => void conversations.refetch()} className="h-10 w-10 rounded-xl border-[var(--mi-border)]">
                  <RefreshCw className={`h-4 w-4 ${conversations.isFetching ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {!status.data?.connected && (
                <div className="p-5 text-center text-sm text-[var(--mi-text-soft)]">
                  Conecte sua conta Meta para carregar Messenger e Instagram Direct.
                </div>
              )}
              {status.data?.connected && filtered.length === 0 && !conversations.isFetching && (
                <div className="p-5 text-center text-sm text-[var(--mi-text-soft)]">Nenhuma conversa encontrada.</div>
              )}
              {filtered.map((conversation: Conversation) => (
                <button key={conversation.id} type="button" onClick={() => setSelectedId(conversation.id)} className={`flex w-full items-start gap-3 border-b border-[var(--mi-border)] px-4 py-3 text-left transition ${selectedId === conversation.id ? "bg-blue-500/10" : "hover:bg-[var(--mi-surface)]"}`}>
                  <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${conversation.channel === "instagram" ? "bg-pink-500/10 text-pink-600" : "bg-blue-500/10 text-blue-600"}`}>
                    {conversation.channel === "instagram" ? <Instagram className="h-5 w-5" /> : <Facebook className="h-5 w-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-black">{conversation.contactName || "Contato"}</span>
                      {conversation.updatedTime && <span className="shrink-0 text-[10px] text-[var(--mi-text-soft)]">{new Date(conversation.updatedTime).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] font-bold uppercase tracking-wide text-[var(--mi-text-soft)]">{conversation.accountName}</span>
                    <span className="mt-1 block truncate text-xs text-[var(--mi-text-muted)]">{conversation.lastMessage || "Mensagem de mídia"}</span>
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
                    <p className="truncate font-black">{selected.contactName || "Contato"}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--mi-text-soft)]">
                      {selected.channel === "instagram" ? <Instagram className="h-3.5 w-3.5" /> : <Facebook className="h-3.5 w-3.5" />}
                      {selected.accountName}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => void messages.refetch()} className="rounded-xl border-[var(--mi-border)]">
                    <RefreshCw className={`mr-2 h-3.5 w-3.5 ${messages.isFetching ? "animate-spin" : ""}`} /> Atualizar
                  </Button>
                </header>

                <div className="flex-1 overflow-y-auto px-5 py-5">
                  <div className="space-y-3">
                    {(messages.data ?? []).map((message) => (
                      <div key={message.id} className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-5 shadow-sm ${message.direction === "outbound" ? "rounded-br-md bg-blue-600 text-white" : "rounded-bl-md border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] text-[var(--mi-text)]"}`}>
                          {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
                          {message.attachments?.length > 0 && (
                            <div className="mt-2 space-y-1 text-xs">
                              {message.attachments.map((attachment, index) => attachment.url ? <a key={`${attachment.type}-${index}`} href={attachment.url} target="_blank" rel="noreferrer" className="block font-bold underline">Abrir {attachment.type}</a> : <span key={`${attachment.type}-${index}`} className="block">{attachment.type}</span>)}
                            </div>
                          )}
                          {message.createdTime && <p className={`mt-1 text-right text-[10px] ${message.direction === "outbound" ? "text-blue-100" : "text-[var(--mi-text-soft)]"}`}>{new Date(message.createdTime).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>}
                        </div>
                      </div>
                    ))}
                    {(messages.data?.length ?? 0) === 0 && !messages.isFetching && <div className="py-20 text-center text-sm text-[var(--mi-text-soft)]">Ainda não há mensagens disponíveis nesta conversa.</div>}
                  </div>
                </div>

                <footer className="border-t border-[var(--mi-border)] p-4">
                  <div className="flex items-end gap-2">
                    <textarea value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} rows={1} placeholder={`Responder pelo ${selected.channel === "instagram" ? "Instagram" : "Facebook"}`} className="max-h-32 min-h-12 flex-1 resize-none rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-4 py-3 text-sm outline-none focus:border-blue-500" />
                    <Button size="icon" onClick={() => void send()} disabled={sending || !text.trim()} className="h-12 w-12 rounded-xl bg-blue-600 text-white hover:bg-blue-700"><Send className="h-4 w-4" /></Button>
                  </div>
                </footer>
              </>
            ) : (
              <div className="grid flex-1 place-items-center p-8 text-center">
                <div>
                  <MessageCircle className="mx-auto h-11 w-11 text-[var(--mi-text-soft)]" />
                  <h2 className="mt-3 text-lg font-black">Central de mídias sociais</h2>
                  <p className="mt-1 max-w-md text-sm text-[var(--mi-text-soft)]">Selecione uma conversa para responder sem sair do MercadoImobi.</p>
                  {!status.data?.connected && <Button onClick={connect} className="mt-5 rounded-xl bg-blue-600 text-white"><Link2 className="mr-2 h-4 w-4" /> Conectar Meta</Button>}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function ChannelButton({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon?: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`flex h-9 items-center justify-center gap-1 rounded-xl border px-2 text-[11px] font-black transition ${active ? "border-blue-500/30 bg-blue-500/10 text-blue-600" : "border-[var(--mi-border)] bg-[var(--mi-surface)] text-[var(--mi-text-muted)]"}`}>{icon}{label}</button>;
}
