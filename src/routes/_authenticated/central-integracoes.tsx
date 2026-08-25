import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bot,
  CalendarClock,
  CheckCircle2,
  Cloud,
  Code2,
  DatabaseBackup,
  ExternalLink,
  KeyRound,
  Link2,
  Plug,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  backupToGoogleDriveNow,
  createMyApiToken,
  disconnectGoogle,
  getGoogleConnectUrl,
  getIntegrationHubOverview,
  revokeMyApiToken,
} from "@/lib/integrations-hub.functions";
import {
  listExternalPropertyLinks,
  registerExternalPropertyLink,
  syncExternalPropertyLinkNow,
} from "@/lib/property-links.functions";

export const Route = createFileRoute("/_authenticated/central-integracoes")({
  component: IntegrationsHubPage,
  head: () => ({ title: "Central de Integrações | MercadoImobi" }),
});

function dateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

function IntegrationsHubPage() {
  const overviewFn = useServerFn(getIntegrationHubOverview);
  const googleUrlFn = useServerFn(getGoogleConnectUrl);
  const disconnectGoogleFn = useServerFn(disconnectGoogle);
  const driveBackupFn = useServerFn(backupToGoogleDriveNow);
  const createTokenFn = useServerFn(createMyApiToken);
  const revokeTokenFn = useServerFn(revokeMyApiToken);
  const listLinksFn = useServerFn(listExternalPropertyLinks);
  const registerLinkFn = useServerFn(registerExternalPropertyLink);
  const syncLinkFn = useServerFn(syncExternalPropertyLinkNow);

  const overview = useQuery({
    queryKey: ["integration-hub"],
    queryFn: () => overviewFn(),
    refetchInterval: 60_000,
  });
  const links = useQuery({
    queryKey: ["external-property-links"],
    queryFn: () => listLinksFn(),
    refetchInterval: 60_000,
  });
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState("Minha integração");
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [propertyUrl, setPropertyUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of overview.data?.catalog ?? []) map.set(item.categoryKey, item.categoryLabel);
    return [...map.entries()].map(([key, label]) => ({ key, label }));
  }, [overview.data?.catalog]);
  const selectedCategory = activeCategory || categories[0]?.key || null;
  const providers = (overview.data?.catalog ?? []).filter(
    (item) => !selectedCategory || item.categoryKey === selectedCategory,
  );

  const connectGoogle = async () => {
    try {
      const result = await googleUrlFn();
      window.location.href = result.url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Google ainda não está configurado.");
    }
  };

  const createToken = async () => {
    if (tokenName.trim().length < 2) return;
    try {
      const result = await createTokenFn({ data: { name: tokenName.trim() } });
      setRevealedToken(result.token);
      await overview.refetch();
      toast.success("Token individual criado. Copie agora: ele não será exibido novamente.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar token.");
    }
  };

  const importProperty = async () => {
    if (!propertyUrl.trim() || busy) return;
    setBusy(true);
    try {
      const result = await registerLinkFn({ data: { url: propertyUrl.trim() } });
      setPropertyUrl("");
      await links.refetch();
      if (result.syncStatus === "active") {
        toast.success("Anúncio reconhecido e incluído na base de imóveis.");
      } else if (result.syncStatus === "partner_required") {
        toast.info(
          "O portal exige integração oficial. O link foi salvo para monitoramento sem contornar o bloqueio.",
        );
      } else {
        toast.info("Link registrado. A plataforma continuará tentando a atualização horária.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível consultar o anúncio.");
    } finally {
      setBusy(false);
    }
  };

  if (overview.isLoading) {
    return <div className="p-8 text-sm text-[var(--mi-text-muted)]">Carregando integrações...</div>;
  }
  if (overview.error || !overview.data) {
    return (
      <div className="m-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
        Não foi possível carregar a Central de Integrações.{" "}
        {String((overview.error as Error)?.message ?? "")}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1700px] space-y-6">
        <header className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">
              Ecossistema
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">Central de Integrações</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--mi-text-muted)]">
              Conecte agenda, Google Meet, Drive, automações, APIs e fontes imobiliárias sem
              misturar dados entre usuários. Cada token e conexão pertence ao usuário e à
              organização autenticada.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-black text-emerald-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Integrações
              isoladas por usuário
            </span>
            <Button
              variant="outline"
              onClick={() => void Promise.all([overview.refetch(), links.refetch()])}
            >
              <RefreshCw className="h-4 w-4" /> Atualizar
            </Button>
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
          <aside className="h-fit rounded-[24px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-2 xl:sticky xl:top-20">
            <p className="px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--mi-text-soft)]">
              Categorias
            </p>
            <div className="space-y-1">
              {categories.map((category) => (
                <button
                  key={category.key}
                  type="button"
                  onClick={() => setActiveCategory(category.key)}
                  className={`w-full rounded-lg px-3 py-2.5 text-left text-xs font-bold transition ${
                    selectedCategory === category.key
                      ? "bg-emerald-500/10 text-emerald-700"
                      : "text-[var(--mi-text-muted)] hover:bg-[var(--mi-bg)]"
                  }`}
                >
                  {category.label}
                </button>
              ))}
            </div>
          </aside>

          <main className="space-y-6">
            <section className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {providers.map((item) => (
                <div
                  key={item.key}
                  className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-500/10 text-blue-600">
                      <Plug className="h-5 w-5" />
                    </span>
                    <StatusBadge status={item.status} />
                  </div>
                  <h2 className="mt-4 font-black">{item.name}</h2>
                  <p className="mt-2 text-xs leading-5 text-[var(--mi-text-muted)]">
                    {item.description}
                  </p>
                </div>
              ))}
            </section>

            <section className="grid gap-6 2xl:grid-cols-2">
              <div className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-500/10 text-blue-600">
                      <CalendarClock className="h-5 w-5" />
                    </span>
                    <div>
                      <h2 className="font-black">Google Agenda + Meet + Drive</h2>
                      <p className="mt-1 text-xs text-[var(--mi-text-muted)]">
                        OAuth individual, agendamentos do CRM e backup automático diário.
                      </p>
                    </div>
                  </div>
                  <StatusBadge
                    status={overview.data.google.connected ? "configured" : "available"}
                  />
                </div>
                {overview.data.google.connected ? (
                  <div className="mt-5 space-y-3">
                    <div className="rounded-xl bg-emerald-500/[0.06] p-3 text-xs">
                      <strong className="text-emerald-700">Conectado:</strong>{" "}
                      {overview.data.google.email || "Conta Google"}
                      <br />
                      <span className="text-[var(--mi-text-muted)]">
                        Desde {dateTime(overview.data.google.connectedAt)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={async () => {
                          try {
                            const result = await driveBackupFn();
                            toast.success(`${result.name} salvo no Google Drive.`);
                            await overview.refetch();
                          } catch (error) {
                            toast.error(
                              error instanceof Error ? error.message : "Falha no backup.",
                            );
                          }
                        }}
                      >
                        <DatabaseBackup className="h-4 w-4" /> Fazer backup agora
                      </Button>
                      <Button
                        variant="outline"
                        onClick={async () => {
                          await disconnectGoogleFn();
                          await overview.refetch();
                          toast.success("Google desconectado desta conta.");
                        }}
                      >
                        Desconectar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5">
                    <Button
                      onClick={() => void connectGoogle()}
                      disabled={!overview.data.google.configured}
                    >
                      <Cloud className="h-4 w-4" /> Conectar Google
                    </Button>
                    {!overview.data.google.configured && (
                      <p className="mt-3 text-xs leading-5 text-amber-700">
                        A interface está pronta. Para ativar o OAuth em produção, o servidor precisa
                        das credenciais GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET do projeto Google
                        Cloud.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-violet-500/10 text-violet-700">
                    <KeyRound className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="font-black">API Token individual</h2>
                    <p className="mt-1 text-xs text-[var(--mi-text-muted)]">
                      Token exclusivo por usuário para N8N, Make, Zapier, BI ou integrações
                      próprias.
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <Input value={tokenName} onChange={(event) => setTokenName(event.target.value)} />
                  <Button onClick={() => void createToken()}>
                    <Code2 className="h-4 w-4" /> Gerar token
                  </Button>
                </div>
                {revealedToken && (
                  <div className="mt-3 rounded-xl border border-amber-300/40 bg-amber-500/[0.06] p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.1em] text-amber-700">
                      Copie agora — exibido uma única vez
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Input readOnly value={revealedToken} className="font-mono text-xs" />
                      <Button
                        variant="outline"
                        onClick={async () => {
                          await navigator.clipboard.writeText(revealedToken);
                          toast.success("Token copiado.");
                        }}
                      >
                        Copiar
                      </Button>
                    </div>
                  </div>
                )}
                <div className="mt-4 space-y-2">
                  {overview.data.apiTokens.map((token) => (
                    <div
                      key={token.id}
                      className="flex items-center justify-between gap-3 rounded-xl bg-[var(--mi-bg)] p-3 text-xs"
                    >
                      <div>
                        <p className="font-black">{token.name}</p>
                        <p className="mt-1 font-mono text-[10px] text-[var(--mi-text-soft)]">
                          {token.prefix}•••• · último uso {dateTime(token.lastUsedAt)}
                        </p>
                      </div>
                      {!token.revokedAt && (
                        <Button
                          size="icon"
                          variant="outline"
                          title="Revogar token"
                          onClick={async () => {
                            await revokeTokenFn({ data: { tokenId: token.id } });
                            await overview.refetch();
                            toast.success("Token revogado.");
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-xl border border-[var(--mi-border)] p-3 text-[11px] text-[var(--mi-text-muted)]">
                  <strong className="text-[var(--mi-text)]">Base API:</strong>{" "}
                  {overview.data.apiBaseUrl}
                  <br />
                  Endpoints iniciais: <code>/properties</code>, <code>/leads</code> e{" "}
                  <code>/appointments</code>.
                </div>
              </div>
            </section>

            <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
              <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <Bot className="h-5 w-5 text-blue-600" />
                    <h2 className="font-black">Consulta inteligente de anúncio por link</h2>
                  </div>
                  <p className="mt-2 max-w-4xl text-xs leading-5 text-[var(--mi-text-muted)]">
                    Cole um link público de imóvel. A plataforma lê metadados estruturados e, quando
                    a IA está disponível, ajuda a classificar o anúncio sem inventar dados. O
                    registro é revisitado no máximo a cada 1 hora; se a origem retornar remoção, o
                    imóvel importado deixa a base.
                  </p>
                </div>
                <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-black text-blue-700">
                  Atualização horária
                </span>
              </div>
              <div className="mt-4 flex flex-col gap-2 lg:flex-row">
                <Input
                  value={propertyUrl}
                  onChange={(event) => setPropertyUrl(event.target.value)}
                  placeholder="https://portal.com.br/anuncio/imovel..."
                  className="flex-1"
                />
                <Button
                  onClick={() => void importProperty()}
                  disabled={busy || !propertyUrl.trim()}
                >
                  <Link2 className="h-4 w-4" /> {busy ? "Consultando..." : "Consultar e acompanhar"}
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-[var(--mi-text-soft)]">
                Portais que exigem autenticação, parceria ou proteção anti-bot não são contornados:
                nesses casos o sistema sinaliza que é necessária uma integração oficial.
              </p>
              <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {(links.data ?? []).map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black">{item.title || item.host}</p>
                        <p className="mt-1 truncate text-[10px] text-[var(--mi-text-soft)]">
                          {item.url}
                        </p>
                      </div>
                      <StatusBadge status={item.status} />
                    </div>
                    <p className="mt-3 text-[11px] text-[var(--mi-text-muted)]">
                      Última consulta: {dateTime(item.lastCheckedAt)}
                    </p>
                    {item.lastError && (
                      <p className="mt-2 text-[11px] text-amber-700">{item.lastError}</p>
                    )}
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          await syncLinkFn({ data: { id: item.id } });
                          await links.refetch();
                          toast.success("Link verificado novamente.");
                        }}
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> Verificar
                      </Button>
                      <Button size="sm" variant="outline" asChild>
                        <a href={item.url} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" /> Origem
                        </a>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-amber-500/10 text-amber-700">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-black">Rauzee / CCA</h2>
                    <StatusBadge status="partner_required" />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[var(--mi-text-muted)]">
                    O conector está reservado na arquitetura, porém o endereço de cadastro de
                    corretor não é uma API. A integração automática de documentos deve usar a
                    API/homologação oficial da Rauzee para evitar automação frágil de login, mistura
                    de dados ou quebra quando o portal mudar. Assim que a credencial e o contrato
                    técnico forem liberados, o adaptador pode usar os documentos já registrados no
                    CRM.
                  </p>
                  <a
                    href="https://rauzee.com/recursos/integracoes/"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-1 text-xs font-black text-blue-600"
                  >
                    Abrir página oficial de integrações Rauzee{" "}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status === "connected" ? "configured" : status;
  const style =
    normalized === "configured" || normalized === "active"
      ? "bg-emerald-500/10 text-emerald-700"
      : normalized === "partner_required"
        ? "bg-amber-500/10 text-amber-700"
        : normalized === "removed" || normalized === "error"
          ? "bg-rose-500/10 text-rose-700"
          : "bg-blue-500/10 text-blue-700";
  const label =
    normalized === "configured"
      ? "Conectado"
      : normalized === "partner_required"
        ? "Requer parceria/API"
        : normalized === "planned"
          ? "Planejado"
          : normalized === "active"
            ? "Ativo"
            : normalized === "removed"
              ? "Removido"
              : normalized === "error"
                ? "Erro"
                : normalized === "unavailable"
                  ? "Indisponível"
                  : "Disponível";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.06em] ${style}`}
    >
      {normalized === "configured" && <CheckCircle2 className="mr-1 inline h-3 w-3" />}
      {label}
    </span>
  );
}
