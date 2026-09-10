import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bot,
  Camera,
  CheckCircle2,
  CircleAlert,
  Link2,
  LogOut,
  MessageCircle,
  PhoneCall,
  RefreshCw,
  Search,
  Send,
  Target,
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
  scanSocialInterestComments,
  sendSocialText,
} from "@/lib/meta-social.functions";
import type { SocialCommentScanResult, SocialInterestComment } from "@/lib/meta-social.server";

export const Route = createFileRoute("/_authenticated/midias-sociais")({
  component: SocialInboxPage,
  head: () => ({ title: "Facebook e Instagram | MercadoImobi" }),
});

type Channel = "all" | "facebook" | "instagram";
type Conversation = {
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
type SocialMessageView = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  senderName: string | null;
  createdTime: string | null;
  attachments: Array<{ type: string; url: string | null }>;
};

function ChannelIcon({
  channel,
  className = "h-4 w-4",
}: {
  channel: "facebook" | "instagram";
  className?: string;
}) {
  return channel === "instagram" ? (
    <Camera className={className} />
  ) : (
    <MessageCircle className={className} />
  );
}

function SocialInboxPage() {
  const statusFn = useServerFn(getMetaSocialStatus);
  const conversationsFn = useServerFn(listSocialConversations);
  const messagesFn = useServerFn(listSocialMessages);
  const sendFn = useServerFn(sendSocialText);
  const scanFn = useServerFn(scanSocialInterestComments);
  const disconnectFn = useServerFn(disconnectMetaSocialAccount);

  const [channel, setChannel] = useState<Channel>("all");
  const [scanChannel, setScanChannel] = useState<Channel>("all");
  const [scanPageId, setScanPageId] = useState("all");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [sendPrivateReplies, setSendPrivateReplies] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<SocialCommentScanResult | null>(null);
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

  const connect = (forceAccountSelection = false) => {
    const targetUrl = forceAccountSelection
      ? status.data?.switchAccountUrl || status.data?.connectUrl
      : status.data?.connectUrl;
    if (!status.data?.configured || !targetUrl) {
      toast.info("Configure META_APP_ID e META_APP_SECRET no servidor para liberar a conexão.");
      return;
    }
    window.location.assign(targetUrl);
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

  const scanInterestComments = async () => {
    if (!status.data?.connected || scanning) {
      toast.info("Conecte uma conta Meta antes de buscar comentários.");
      return;
    }
    const data = {
      channel: scanChannel,
      sourceLimit: 5,
      commentLimit: 30,
      sendPrivateReplies,
      ...(scanPageId !== "all" ? { pageId: scanPageId } : {}),
      ...(whatsappNumber.trim() ? { whatsappNumber: whatsappNumber.trim() } : {}),
    };
    setScanning(true);
    try {
      const result = await scanFn({ data });
      setScanResult(result);
      if (result.interestedComments.length) {
        toast.success(
          `${result.interestedComments.length} comentário(s) com interesse encontrados.`,
        );
      } else {
        toast.info("Nenhum comentário com intenção clara foi encontrado agora.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "A busca de comentários falhou.");
    } finally {
      setScanning(false);
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
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">
              Omnichannel
            </p>
            <h1 className="mt-1 text-2xl font-black">Facebook e Instagram</h1>
            <p className="mt-1 text-sm text-[var(--mi-text-muted)]">
              Conecte qualquer conta Meta que administre as páginas e perfis profissionais que serão
              atendidos aqui, sem depender de um perfil próprio do MercadoImobi.
            </p>
            <p className="mt-1 text-xs font-bold text-[var(--mi-text-soft)]">
              Para usar outra conta, escolha o login correto no Facebook/Instagram durante a
              autorização ou use a opção de trocar conta.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/atendimento">
              <Button variant="outline" className="rounded-xl border-[var(--mi-border)]">
                <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp
              </Button>
            </Link>
            {status.data?.connected ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => connect(true)}
                  className="rounded-xl border-[var(--mi-border)]"
                >
                  <Link2 className="mr-2 h-4 w-4" /> Trocar conta Meta
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void disconnect()}
                  className="rounded-xl border-[var(--mi-border)] text-rose-600"
                >
                  <LogOut className="mr-2 h-4 w-4" /> Desconectar Meta
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => connect(true)}
                  className="rounded-xl border-[var(--mi-border)]"
                >
                  <Link2 className="mr-2 h-4 w-4" /> Escolher conta Meta
                </Button>
                <Button
                  onClick={() => connect()}
                  className="rounded-xl bg-blue-600 font-black text-white hover:bg-blue-700"
                >
                  <Link2 className="mr-2 h-4 w-4" /> Conectar Facebook e Instagram
                </Button>
              </>
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
                    {status.data?.connected
                      ? `${status.data.pages.length} página(s) conectada(s)`
                      : "Nenhuma conta conectada"}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black ${status.data?.connected ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"}`}
                >
                  {status.data?.connected ? (
                    <Wifi className="h-3.5 w-3.5" />
                  ) : (
                    <WifiOff className="h-3.5 w-3.5" />
                  )}
                  {status.data?.connected ? "ONLINE" : "OFFLINE"}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <ChannelButton
                  active={channel === "all"}
                  onClick={() => setChannel("all")}
                  label="Todas"
                />
                <ChannelButton
                  active={channel === "facebook"}
                  onClick={() => setChannel("facebook")}
                  label="Facebook"
                  icon={<MessageCircle className="h-3.5 w-3.5" />}
                />
                <ChannelButton
                  active={channel === "instagram"}
                  onClick={() => setChannel("instagram")}
                  label="Instagram"
                  icon={<Camera className="h-3.5 w-3.5" />}
                />
              </div>

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
                  onClick={() => void conversations.refetch()}
                  className="h-10 w-10 rounded-xl border-[var(--mi-border)]"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${conversations.isFetching ? "animate-spin" : ""}`}
                  />
                </Button>
              </div>

              <div className="mt-4 rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-3">
                <div className="flex items-start gap-2">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-600">
                    <Target className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black">IA de comentários</p>
                    <p className="mt-0.5 text-[11px] text-[var(--mi-text-soft)]">
                      Captação para Direct, Messenger e WhatsApp.
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <select
                    value={scanChannel}
                    onChange={(event) => setScanChannel(event.target.value as Channel)}
                    className="h-10 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-3 text-xs font-bold outline-none focus:border-blue-500"
                  >
                    <option value="all">Todos</option>
                    <option value="facebook">Facebook</option>
                    <option value="instagram">Instagram</option>
                  </select>
                  <select
                    value={scanPageId}
                    onChange={(event) => setScanPageId(event.target.value)}
                    className="h-10 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-3 text-xs font-bold outline-none focus:border-blue-500"
                  >
                    <option value="all">Todas as páginas</option>
                    {(status.data?.pages ?? []).map((page) => (
                      <option key={page.pageId} value={page.pageId}>
                        {page.instagramUsername
                          ? `${page.pageName} / @${page.instagramUsername}`
                          : page.pageName}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <PhoneCall className="h-4 w-4 text-[var(--mi-text-soft)]" />
                  <input
                    value={whatsappNumber}
                    onChange={(event) => setWhatsappNumber(event.target.value)}
                    placeholder="WhatsApp do atendimento"
                    className="h-10 min-w-0 flex-1 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-3 text-xs outline-none focus:border-blue-500"
                  />
                </div>

                <label className="mt-3 flex items-center gap-2 text-[11px] font-bold text-[var(--mi-text-muted)]">
                  <input
                    type="checkbox"
                    checked={sendPrivateReplies}
                    onChange={(event) => setSendPrivateReplies(event.target.checked)}
                    className="h-4 w-4 rounded border-[var(--mi-border)]"
                  />
                  Chamar no privado automaticamente
                </label>

                <Button
                  type="button"
                  onClick={() => void scanInterestComments()}
                  disabled={!status.data?.connected || scanning}
                  className="mt-3 h-10 w-full rounded-xl bg-blue-600 text-xs font-black text-white hover:bg-blue-700"
                >
                  {scanning ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Bot className="mr-2 h-4 w-4" />
                  )}
                  {scanning ? "Buscando interessados" : "Buscar interessados"}
                </Button>

                {scanResult && (
                  <div className="mt-3 space-y-2">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <Metric value={scanResult.scannedSources} label="posts" />
                      <Metric value={scanResult.scannedComments} label="coment." />
                      <Metric value={scanResult.sentInvites} label="convites" />
                    </div>
                    {scanResult.interestedComments.slice(0, 3).map((item) => (
                      <InterestCommentPreview key={item.id} item={item} />
                    ))}
                    {scanResult.errors.length > 0 && (
                      <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{scanResult.errors[0]}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {!status.data?.connected && (
                <div className="p-5 text-center text-sm text-[var(--mi-text-soft)]">
                  Conecte sua conta Meta para carregar Messenger e Instagram Direct.
                </div>
              )}
              {status.data?.connected && filtered.length === 0 && !conversations.isFetching && (
                <div className="p-5 text-center text-sm text-[var(--mi-text-soft)]">
                  Nenhuma conversa encontrada.
                </div>
              )}
              {filtered.map((conversation: Conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => setSelectedId(conversation.id)}
                  className={`flex w-full items-start gap-3 border-b border-[var(--mi-border)] px-4 py-3 text-left transition ${selectedId === conversation.id ? "bg-blue-500/10" : "hover:bg-[var(--mi-surface)]"}`}
                >
                  <span
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${conversation.channel === "instagram" ? "bg-pink-500/10 text-pink-600" : "bg-blue-500/10 text-blue-600"}`}
                  >
                    <ChannelIcon channel={conversation.channel} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-black">
                        {conversation.contactName || "Contato"}
                      </span>
                      {conversation.updatedTime && (
                        <span className="shrink-0 text-[10px] text-[var(--mi-text-soft)]">
                          {new Date(conversation.updatedTime).toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] font-bold uppercase tracking-wide text-[var(--mi-text-soft)]">
                      {conversation.accountName}
                    </span>
                    <span className="mt-1 block truncate text-xs text-[var(--mi-text-muted)]">
                      {conversation.lastMessage || "Mensagem de mídia"}
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
                    <p className="truncate font-black">{selected.contactName || "Contato"}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--mi-text-soft)]">
                      <ChannelIcon channel={selected.channel} className="h-3.5 w-3.5" />{" "}
                      {selected.accountName}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void messages.refetch()}
                    className="rounded-xl border-[var(--mi-border)]"
                  >
                    <RefreshCw
                      className={`mr-2 h-3.5 w-3.5 ${messages.isFetching ? "animate-spin" : ""}`}
                    />{" "}
                    Atualizar
                  </Button>
                </header>

                <div className="flex-1 overflow-y-auto px-5 py-5">
                  <div className="space-y-3">
                    {((messages.data ?? []) as SocialMessageView[]).map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-5 shadow-sm ${message.direction === "outbound" ? "rounded-br-md bg-blue-600 text-white" : "rounded-bl-md border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] text-[var(--mi-text)]"}`}
                        >
                          {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
                          {message.attachments?.length > 0 && (
                            <div className="mt-2 space-y-1 text-xs">
                              {message.attachments.map((attachment, index) =>
                                attachment.url ? (
                                  <a
                                    key={`${attachment.type}-${index}`}
                                    href={attachment.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block font-bold underline"
                                  >
                                    Abrir {attachment.type}
                                  </a>
                                ) : (
                                  <span key={`${attachment.type}-${index}`} className="block">
                                    {attachment.type}
                                  </span>
                                ),
                              )}
                            </div>
                          )}
                          {message.createdTime && (
                            <p
                              className={`mt-1 text-right text-[10px] ${message.direction === "outbound" ? "text-blue-100" : "text-[var(--mi-text-soft)]"}`}
                            >
                              {new Date(message.createdTime).toLocaleTimeString("pt-BR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                    {(messages.data?.length ?? 0) === 0 && !messages.isFetching && (
                      <div className="py-20 text-center text-sm text-[var(--mi-text-soft)]">
                        Ainda não há mensagens disponíveis nesta conversa.
                      </div>
                    )}
                  </div>
                </div>

                <footer className="border-t border-[var(--mi-border)] p-4">
                  <div className="flex items-end gap-2">
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
                      placeholder={`Responder pelo ${selected.channel === "instagram" ? "Instagram" : "Facebook"}`}
                      className="max-h-32 min-h-12 flex-1 resize-none rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-4 py-3 text-sm outline-none focus:border-blue-500"
                    />
                    <Button
                      size="icon"
                      onClick={() => void send()}
                      disabled={sending || !text.trim()}
                      className="h-12 w-12 rounded-xl bg-blue-600 text-white hover:bg-blue-700"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </footer>
              </>
            ) : (
              <div className="grid flex-1 place-items-center p-8 text-center">
                <div>
                  <MessageCircle className="mx-auto h-11 w-11 text-[var(--mi-text-soft)]" />
                  <h2 className="mt-3 text-lg font-black">Central de mídias sociais</h2>
                  <p className="mt-1 max-w-md text-sm text-[var(--mi-text-soft)]">
                    Selecione uma conversa para responder sem sair do MercadoImobi.
                  </p>
                  {!status.data?.connected && (
                    <Button
                      onClick={() => connect()}
                      className="mt-5 rounded-xl bg-blue-600 text-white"
                    >
                      <Link2 className="mr-2 h-4 w-4" /> Conectar Meta
                    </Button>
                  )}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-2 py-2">
      <p className="text-sm font-black">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--mi-text-soft)]">
        {label}
      </p>
    </div>
  );
}

function InterestCommentPreview({ item }: { item: SocialInterestComment }) {
  const status =
    item.inviteStatus === "sent"
      ? "Convite enviado"
      : item.inviteStatus === "failed"
        ? "Falha no convite"
        : "Convite pendente";
  const content = (
    <div className="rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-3 py-2 text-left">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-black">{item.authorName || "Contato"}</span>
        <span
          className={`inline-flex shrink-0 items-center gap-1 text-[10px] font-black ${item.inviteStatus === "sent" ? "text-emerald-700" : item.inviteStatus === "failed" ? "text-rose-700" : "text-[var(--mi-text-soft)]"}`}
        >
          {item.inviteStatus === "sent" ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : item.inviteStatus === "failed" ? (
            <CircleAlert className="h-3 w-3" />
          ) : (
            <Target className="h-3 w-3" />
          )}
          {status}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] text-[var(--mi-text-muted)]">{item.text}</p>
      <p className="mt-1 text-[10px] font-bold text-blue-600">
        {item.channel === "instagram" ? "Instagram" : "Facebook"} · {item.interestScore}%
      </p>
    </div>
  );
  if (item.permalinkUrl) {
    return (
      <a href={item.permalinkUrl} target="_blank" rel="noreferrer" className="block">
        {content}
      </a>
    );
  }
  return content;
}

function ChannelButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-9 items-center justify-center gap-1 rounded-xl border px-2 text-[11px] font-black transition ${active ? "border-blue-500/30 bg-blue-500/10 text-blue-600" : "border-[var(--mi-border)] bg-[var(--mi-surface)] text-[var(--mi-text-muted)]"}`}
    >
      {icon}
      {label}
    </button>
  );
}
