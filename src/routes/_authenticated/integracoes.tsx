import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Building2,
  CheckCircle2,
  Database,
  Globe2,
  Link2,
  MessageCircle,
  Plug,
  Radar,
  RefreshCw,
  Search,
  ShieldCheck,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  getPropertySourceHealth,
  getPropertySourceSummary,
  listPropertySources,
  registerPropertyFeed,
  syncPropertyFeed,
} from "@/lib/property-sources.functions";
import {
  getPropertyDiscoveryStatus,
  listDiscoveredPropertyDomains,
  runPropertyDiscovery,
} from "@/lib/property-discovery.functions";
import { getWhatsAppConnectionStatus } from "@/lib/whatsapp.functions";

export const Route = createFileRoute("/_authenticated/integracoes")({
  component: IntegrationsPage,
  head: () => ({ title: "Fontes de imóveis | MercadoImobi" }),
});

function IntegrationsPage() {
  const sourcesFn = useServerFn(listPropertySources);
  const healthFn = useServerFn(getPropertySourceHealth);
  const summaryFn = useServerFn(getPropertySourceSummary);
  const registerFeedFn = useServerFn(registerPropertyFeed);
  const syncFeedFn = useServerFn(syncPropertyFeed);
  const discoveryStatusFn = useServerFn(getPropertyDiscoveryStatus);
  const discoveryFn = useServerFn(runPropertyDiscovery);
  const domainsFn = useServerFn(listDiscoveredPropertyDomains);
  const whatsappFn = useServerFn(getWhatsAppConnectionStatus);

  const sources = useQuery({ queryKey: ["property-sources"], queryFn: () => sourcesFn() });
  const health = useQuery({
    queryKey: ["property-source-health"],
    queryFn: () => healthFn(),
    staleTime: 4 * 60_000,
  });
  const summary = useQuery({ queryKey: ["property-source-summary"], queryFn: () => summaryFn() });
  const discoveryStatus = useQuery({
    queryKey: ["property-discovery-status"],
    queryFn: () => discoveryStatusFn(),
  });
  const domains = useQuery({
    queryKey: ["property-discovered-domains"],
    queryFn: () => domainsFn(),
  });
  const whatsapp = useQuery({
    queryKey: ["whatsapp-integration-status"],
    queryFn: () => whatsappFn(),
  });

  const [sourceCode, setSourceCode] = useState("canalpro");
  const [feedName, setFeedName] = useState("Minha fonte de imóveis");
  const [feedUrl, setFeedUrl] = useState("");
  const [feedFormat, setFeedFormat] = useState<"xml" | "json">("xml");
  const [discoveryCity, setDiscoveryCity] = useState("");
  const [discoveryState, setDiscoveryState] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [syncingConnection, setSyncingConnection] = useState<string | null>(null);

  const sourceList = sources.data?.sources ?? [];
  const healthRows = health.data ?? [];
  const onlineCount = healthRows.filter((row: any) => row.online === true).length;
  const onlineTotal = healthRows.filter((row: any) => row.online !== null).length;
  const activeDataSources = sourceList.filter(
    (source: any) =>
      source.status === "active" ||
      Number(source.public_discovery_count ?? 0) > 0 ||
      (source.connections ?? []).some((connection: any) => connection.status === "connected"),
  ).length;

  const registerFeed = async () => {
    if (!feedUrl.trim()) {
      toast.info("Informe o link fornecido pela imobiliária, construtora ou parceiro.");
      return;
    }
    try {
      const result = await registerFeedFn({
        data: {
          sourceCode,
          name: feedName.trim() || "Fonte imobiliária",
          feedUrl: feedUrl.trim(),
          format: feedFormat,
        },
      });
      setFeedUrl("");
      await Promise.all([sources.refetch(), summary.refetch()]);
      toast.success(`${result.imported.toLocaleString("pt-BR")} imóveis sincronizados com sucesso.`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível validar e sincronizar esta fonte.",
      );
    }
  };

  const syncConnection = async (connectionId: string) => {
    setSyncingConnection(connectionId);
    try {
      const result = await syncFeedFn({ data: { connectionId } });
      await Promise.all([sources.refetch(), summary.refetch()]);
      toast.success(`${result.count.toLocaleString("pt-BR")} imóveis atualizados.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "A atualização desta fonte não foi concluída.",
      );
    } finally {
      setSyncingConnection(null);
    }
  };

  const discover = async () => {
    if (!discoveryStatus.data?.configured) {
      toast.info(
        "A descoberta automática por sitemap já está ativa. A pesquisa ampliada por inteligência ainda precisa ser ativada no servidor.",
      );
      return;
    }
    setDiscovering(true);
    try {
      const result = await discoveryFn({
        data: {
          city: discoveryCity || undefined,
          state: discoveryState || undefined,
          query: "imóveis à venda, locação, lançamentos e imobiliárias com anúncios públicos",
        },
      });
      await domains.refetch();
      toast.success(`${result.candidates.length} fontes públicas encontradas para análise.`);
    } catch {
      toast.error("A busca de novas fontes não foi concluída agora.");
    } finally {
      setDiscovering(false);
    }
  };

  const refreshSources = async () => {
    await Promise.all([sources.refetch(), health.refetch(), summary.refetch()]);
  };

  return (
    <div className="min-h-screen bg-[#06101c] p-4 text-white sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1500px]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">
              Fontes de imóveis
            </p>
            <h1 className="mt-2 text-3xl font-black">Portais, construtoras e imobiliárias</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">
              A descoberta pública monitora páginas abertas e sitemaps automaticamente, sem login ou
              contorno de bloqueios. Integrações oficiais continuam disponíveis como opção adicional
              quando você quiser conectar um inventário autorizado.
            </p>
          </div>
          <Button
            onClick={() => void refreshSources()}
            variant="outline"
            className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.07]"
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${sources.isFetching || health.isFetching ? "animate-spin" : ""}`}
            />
            Verificar fontes
          </Button>
        </div>

        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <SummaryCard
            icon={<Database className="h-5 w-5" />}
            label="Imóveis na busca"
            value={summary.data?.total ?? 0}
          />
          <SummaryCard
            icon={<Building2 className="h-5 w-5" />}
            label="CAIXA"
            value={summary.data?.caixa ?? 0}
          />
          <SummaryCard
            icon={<Radar className="h-5 w-5" />}
            label="Descoberta pública"
            value={summary.data?.publicDiscovered ?? 0}
          />
          <SummaryCard
            icon={<Plug className="h-5 w-5" />}
            label="Fontes com dados"
            value={activeDataSources}
          />
          <SummaryCard
            icon={<Wifi className="h-5 w-5" />}
            label="Sites disponíveis"
            value={`${onlineCount}/${onlineTotal || 0}`}
          />
          <SummaryCard
            icon={<MessageCircle className="h-5 w-5" />}
            label="WhatsApp"
            value={whatsapp.data?.connected ? "Conectado" : "Desconectado"}
          />
        </div>

        <div className="mt-7 grid gap-6 xl:grid-cols-[1fr_430px]">
          <section className="rounded-[26px] border border-white/10 bg-white/[0.04] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                  Cobertura monitorada
                </p>
                <h2 className="mt-1 text-xl font-black">Status real das fontes</h2>
              </div>
              <Radar className="h-5 w-5 text-cyan-300" />
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {sourceList.map((source: any) => (
                <SourceCard
                  key={source.code}
                  source={source}
                  health={healthRows.find((row: any) => row.code === source.code)}
                  syncingConnection={syncingConnection}
                  onSync={syncConnection}
                />
              ))}
            </div>
          </section>

          <div className="space-y-6">
            <section className="rounded-[26px] border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-center gap-2">
                <Link2 className="h-5 w-5 text-cyan-300" />
                <h2 className="font-black">Integração oficial opcional</h2>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                A descoberta pública funciona sem esta etapa. Use este campo somente quando uma
                imobiliária, construtora ou parceiro fornecer um XML/JSON autorizado.
              </p>
              <div className="mt-4 space-y-3">
                <Field label="Origem dos imóveis">
                  <select value={sourceCode} onChange={(e) => setSourceCode(e.target.value)}>
                    {sourceList.map((source: any) => (
                      <option key={source.code} value={source.code}>
                        {source.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Nome da conexão">
                  <input value={feedName} onChange={(e) => setFeedName(e.target.value)} />
                </Field>
                <Field label="Link de integração">
                  <input
                    value={feedUrl}
                    onChange={(e) => setFeedUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </Field>
                <Field label="Tipo do arquivo">
                  <select
                    value={feedFormat}
                    onChange={(e) => setFeedFormat(e.target.value as "xml" | "json")}
                  >
                    <option value="xml">XML</option>
                    <option value="json">JSON</option>
                  </select>
                </Field>
                <Button
                  onClick={() => void registerFeed()}
                  className="h-11 w-full rounded-xl bg-cyan-300 font-black text-[#06101c] hover:bg-cyan-200"
                >
                  <Plug className="mr-2 h-4 w-4" /> Validar e conectar
                </Button>
              </div>
              <div className="mt-4 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.05] p-3 text-xs leading-5 text-slate-400">
                <strong className="text-cyan-100">Opcional:</strong> feeds oficiais aumentam a
                cobertura e podem trazer campos que não aparecem publicamente.
              </div>
            </section>

            <section className="rounded-[26px] border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-center gap-2">
                <Search className="h-5 w-5 text-cyan-300" />
                <h2 className="font-black">Descobrir novas imobiliárias</h2>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Os portais e construtoras cadastrados já são monitorados automaticamente. Esta busca
                ampliada encontra novos sites públicos por região quando o recurso de inteligência
                estiver disponível.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <Field label="Cidade">
                  <input
                    value={discoveryCity}
                    onChange={(e) => setDiscoveryCity(e.target.value)}
                    placeholder="Joinville"
                  />
                </Field>
                <Field label="UF">
                  <input
                    value={discoveryState}
                    maxLength={2}
                    onChange={(e) => setDiscoveryState(e.target.value.toUpperCase())}
                    placeholder="SC"
                  />
                </Field>
              </div>
              <Button
                onClick={() => void discover()}
                disabled={discovering || !discoveryStatus.data?.configured}
                className="mt-3 h-11 w-full rounded-xl border border-cyan-300/20 bg-cyan-300/[0.07] font-bold text-cyan-100 hover:bg-cyan-300/[0.12]"
              >
                <Globe2 className="mr-2 h-4 w-4" />
                {discovering ? "Pesquisando..." : "Pesquisar novas fontes"}
              </Button>
              {!discoveryStatus.isLoading && !discoveryStatus.data?.configured && (
                <p className="mt-3 text-xs leading-5 text-slate-400">
                  A descoberta automática por sitemap continua ativa. A pesquisa ampliada por região é
                  um recurso complementar.
                </p>
              )}
            </section>
          </div>
        </div>

        <section className="mt-6 rounded-[26px] border border-white/10 bg-white/[0.04] p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <Globe2 className="h-5 w-5 text-cyan-300" />
            <h2 className="font-black">Novas fontes encontradas</h2>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(domains.data ?? []).slice(0, 30).map((domain: any) => (
              <div key={domain.id} className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{domain.business_name || domain.domain}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">{domain.domain}</p>
                  </div>
                  <span className="rounded-full bg-cyan-300/10 px-2 py-1 text-[10px] font-black text-cyan-100">
                    DESCOBERTA PÚBLICA
                  </span>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  {[domain.city, domain.state].filter(Boolean).join(" - ") || "Cobertura a verificar"}
                </p>
              </div>
            ))}
            {!domains.isLoading && (domains.data?.length ?? 0) === 0 && (
              <div className="col-span-full rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-500">
                A descoberta automática dos portais cadastrados já está ativa. Novas imobiliárias
                aparecerão aqui quando forem encontradas pela busca ampliada.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center gap-2 text-cyan-300">
        {icon}
        <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
          {label}
        </span>
      </div>
      <p className="mt-3 text-2xl font-black">
        {typeof value === "number" ? value.toLocaleString("pt-BR") : value}
      </p>
    </div>
  );
}

function SourceCard({
  source,
  health,
  syncingConnection,
  onSync,
}: {
  source: any;
  health: any;
  syncingConnection: string | null;
  onSync: (connectionId: string) => Promise<void>;
}) {
  const connections = source.connections ?? [];
  const connected = connections.some((connection: any) => connection.status === "connected");
  const officialActive = source.status === "active";
  const publicCount = Number(source.public_discovery_count ?? 0);
  const publicEnabled = Boolean(source.public_discovery_enabled);
  const publicActive = source.public_discovery_status === "active" && publicCount > 0;
  const dataActive = connected || officialActive || publicActive;
  const online = health?.online;
  const latestSuccess =
    connections.find((connection: any) => connection.last_success_at)?.last_success_at ||
    source.latestRun?.finished_at ||
    source.last_public_discovery_at;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold">{source.name}</p>
          <p className="mt-1 truncate text-xs text-slate-500">
            {source.website_domain || "Descoberta por região e fontes públicas"}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${
            dataActive
              ? "bg-emerald-300/10 text-emerald-200"
              : publicEnabled
                ? "bg-cyan-300/10 text-cyan-100"
                : "bg-slate-300/10 text-slate-300"
          }`}
        >
          {dataActive ? "ATIVO" : publicEnabled ? "DESCOBERTA PÚBLICA" : "INTEGRAÇÃO OPCIONAL"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold">
        {publicEnabled && (
          <span className="inline-flex items-center gap-1 rounded-full bg-cyan-300/10 px-2 py-1 text-cyan-100">
            <Radar className="h-3 w-3" /> Descoberta pública
          </span>
        )}
        {source.official_integration_optional && (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.05] px-2 py-1 text-slate-400">
            <Plug className="h-3 w-3" /> Integração opcional
          </span>
        )}
        {online === true && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-300/10 px-2 py-1 text-emerald-200">
            <Wifi className="h-3 w-3" /> Site disponível
          </span>
        )}
        {online === false && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-300/10 px-2 py-1 text-rose-200">
            <WifiOff className="h-3 w-3" /> Site sem resposta
          </span>
        )}
        {online == null && !publicEnabled && (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.05] px-2 py-1 text-slate-500">
            <Globe2 className="h-3 w-3" /> Sem site público
          </span>
        )}
        {source.supports_updates && (
          <span className="inline-flex items-center gap-1 text-slate-500">
            <CheckCircle2 className="h-3 w-3" /> Atualizações
          </span>
        )}
        {source.supports_contacts && (
          <span className="inline-flex items-center gap-1 text-slate-500">
            <ShieldCheck className="h-3 w-3" /> Contatos quando públicos
          </span>
        )}
      </div>

      {publicEnabled && (
        <div className="mt-3 rounded-xl border border-cyan-300/10 bg-cyan-300/[0.035] px-3 py-2 text-[10px] text-slate-400">
          {publicCount > 0
            ? `${publicCount.toLocaleString("pt-BR")} anúncios públicos monitorados.`
            : source.public_discovery_status === "blocked"
              ? "O site restringiu a varredura automática; nenhum bloqueio será contornado."
              : "Varredura automática ativa; aguardando páginas públicas compatíveis."}
        </div>
      )}

      <p className="mt-3 text-xs leading-5 text-slate-500">{source.notes}</p>

      {latestSuccess && (
        <p className="mt-3 text-[10px] font-semibold text-slate-500">
          Última verificação: {formatDate(latestSuccess)}
        </p>
      )}

      {connections.map((connection: any) => (
        <div
          key={connection.id}
          className="mt-3 rounded-xl border border-white/10 bg-white/[0.035] p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold">{connection.name}</p>
              <p className="mt-1 text-[10px] text-slate-500">
                {connection.status === "connected"
                  ? "Integração oficial funcionando"
                  : connection.status === "error"
                    ? "Requer atenção"
                    : "Validação pendente"}
              </p>
            </div>
            {connection.connection_type?.startsWith("authorized_") && (
              <button
                type="button"
                onClick={() => void onSync(connection.id)}
                disabled={syncingConnection === connection.id}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.06] px-2.5 text-[10px] font-black text-cyan-100 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3 w-3 ${syncingConnection === connection.id ? "animate-spin" : ""}`}
                />
                Atualizar
              </button>
            )}
          </div>
          {connection.last_error && (
            <p className="mt-2 text-[10px] leading-4 text-rose-200">{connection.last_error}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
        {label}
      </span>
      <div className="flex min-h-11 items-center rounded-xl border border-white/10 bg-black/10 px-3 [&_input]:w-full [&_input]:bg-transparent [&_input]:text-sm [&_input]:text-white [&_input]:outline-none [&_input]:placeholder:text-slate-600 [&_select]:w-full [&_select]:bg-transparent [&_select]:text-sm [&_select]:text-white [&_select]:outline-none [&_option]:bg-[#0b1727]">
        {children}
      </div>
    </label>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "data indisponível";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    date,
  );
}
