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
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  getPropertySourceSummary,
  listPropertySources,
  registerPropertyFeed,
} from "@/lib/property-sources.functions";
import {
  getPropertyDiscoveryStatus,
  listDiscoveredPropertyDomains,
  runPropertyDiscovery,
} from "@/lib/property-discovery.functions";
import { getWhatsAppConnectionStatus } from "@/lib/whatsapp.functions";

export const Route = createFileRoute("/_authenticated/integracoes")({
  component: IntegrationsPage,
  head: () => ({ title: "Integrações | MercadoImobi" }),
});

function IntegrationsPage() {
  const sourcesFn = useServerFn(listPropertySources);
  const summaryFn = useServerFn(getPropertySourceSummary);
  const registerFeedFn = useServerFn(registerPropertyFeed);
  const discoveryStatusFn = useServerFn(getPropertyDiscoveryStatus);
  const discoveryFn = useServerFn(runPropertyDiscovery);
  const domainsFn = useServerFn(listDiscoveredPropertyDomains);
  const whatsappFn = useServerFn(getWhatsAppConnectionStatus);

  const sources = useQuery({ queryKey: ["property-sources"], queryFn: () => sourcesFn() });
  const summary = useQuery({ queryKey: ["property-source-summary"], queryFn: () => summaryFn() });
  const discoveryStatus = useQuery({ queryKey: ["property-discovery-status"], queryFn: () => discoveryStatusFn() });
  const domains = useQuery({ queryKey: ["property-discovered-domains"], queryFn: () => domainsFn() });
  const whatsapp = useQuery({ queryKey: ["whatsapp-integration-status"], queryFn: () => whatsappFn() });

  const [sourceCode, setSourceCode] = useState("agency_feeds");
  const [feedName, setFeedName] = useState("Minha imobiliária");
  const [feedUrl, setFeedUrl] = useState("");
  const [feedFormat, setFeedFormat] = useState<"xml" | "json">("xml");
  const [discoveryCity, setDiscoveryCity] = useState("");
  const [discoveryState, setDiscoveryState] = useState("");
  const [discovering, setDiscovering] = useState(false);

  const registerFeed = async () => {
    if (!feedUrl.trim()) return;
    try {
      await registerFeedFn({
        data: {
          sourceCode,
          name: feedName.trim() || "Feed imobiliário",
          feedUrl: feedUrl.trim(),
          format: feedFormat,
        },
      });
      setFeedUrl("");
      await sources.refetch();
      toast.success("Fonte registrada para validação e sincronização.");
    } catch {
      toast.error("Não foi possível registrar esta fonte.");
    }
  };

  const discover = async () => {
    if (!discoveryStatus.data?.configured) {
      toast.info("A inteligência de descoberta ainda precisa ser ativada no servidor.");
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

  return (
    <div className="min-h-screen bg-[#06101c] p-4 text-white sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1500px]">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">Conexões da plataforma</p>
          <h1 className="mt-2 text-3xl font-black">Integrações de imóveis e atendimento</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">
            Centralize fontes oficiais, feeds autorizados de imobiliárias, descoberta de novas fontes públicas e conexão do WhatsApp. Nenhuma fonte é marcada como ativa antes de uma conexão real.
          </p>
        </div>

        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard icon={<Database className="h-5 w-5" />} label="Imóveis indexados" value={summary.data?.total ?? 0} />
          <SummaryCard icon={<Building2 className="h-5 w-5" />} label="CAIXA" value={summary.data?.caixa ?? 0} />
          <SummaryCard icon={<Radar className="h-5 w-5" />} label="Leilões identificados" value={summary.data?.auctions ?? 0} />
          <SummaryCard icon={<MessageCircle className="h-5 w-5" />} label="WhatsApp" value={whatsapp.data?.connected ? "Conectado" : "Desconectado"} />
        </div>

        <div className="mt-7 grid gap-6 xl:grid-cols-[1fr_430px]">
          <section className="rounded-[26px] border border-white/10 bg-white/[0.04] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Fontes cadastradas</p><h2 className="mt-1 text-xl font-black">Portais, construtoras e imobiliárias</h2></div>
              <button onClick={() => void sources.refetch()} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-slate-400 hover:bg-white/5"><RefreshCw className={`h-4 w-4 ${sources.isFetching ? "animate-spin" : ""}`} /></button>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {(sources.data?.sources ?? []).map((source: any) => (
                <SourceCard key={source.code} source={source} />
              ))}
            </div>
          </section>

          <div className="space-y-6">
            <section className="rounded-[26px] border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-center gap-2"><Link2 className="h-5 w-5 text-cyan-300" /><h2 className="font-black">Adicionar feed autorizado</h2></div>
              <p className="mt-2 text-xs leading-5 text-slate-500">Use um endereço XML ou JSON fornecido pela imobiliária, construtora ou portal autorizado.</p>
              <div className="mt-4 space-y-3">
                <Field label="Fonte"><select value={sourceCode} onChange={(e) => setSourceCode(e.target.value)}>{(sources.data?.sources ?? []).map((source: any) => <option key={source.code} value={source.code}>{source.name}</option>)}</select></Field>
                <Field label="Nome da conexão"><input value={feedName} onChange={(e) => setFeedName(e.target.value)} /></Field>
                <Field label="Endereço do feed"><input value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="https://.../imoveis.xml" /></Field>
                <Field label="Formato"><select value={feedFormat} onChange={(e) => setFeedFormat(e.target.value as "xml" | "json")}><option value="xml">XML</option><option value="json">JSON</option></select></Field>
                <Button onClick={() => void registerFeed()} className="h-11 w-full rounded-xl bg-cyan-300 font-black text-[#06101c] hover:bg-cyan-200"><Plug className="mr-2 h-4 w-4" /> Registrar conexão</Button>
              </div>
            </section>

            <section className="rounded-[26px] border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-center gap-2"><Search className="h-5 w-5 text-cyan-300" /><h2 className="font-black">Descoberta de novas fontes</h2></div>
              <p className="mt-2 text-xs leading-5 text-slate-500">A inteligência pesquisa fontes públicas por região e cadastra candidatos para integração. Ela não contorna bloqueios nem transforma uma página protegida em feed.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <Field label="Cidade"><input value={discoveryCity} onChange={(e) => setDiscoveryCity(e.target.value)} placeholder="Joinville" /></Field>
                <Field label="UF"><input value={discoveryState} maxLength={2} onChange={(e) => setDiscoveryState(e.target.value.toUpperCase())} placeholder="SC" /></Field>
              </div>
              <Button onClick={() => void discover()} disabled={discovering || !discoveryStatus.data?.configured} className="mt-3 h-11 w-full rounded-xl border border-cyan-300/20 bg-cyan-300/[0.07] font-bold text-cyan-100 hover:bg-cyan-300/[0.12]">
                <Globe2 className="mr-2 h-4 w-4" /> {discovering ? "Pesquisando..." : "Pesquisar novas fontes"}
              </Button>
              {!discoveryStatus.isLoading && !discoveryStatus.data?.configured && <p className="mt-3 text-xs leading-5 text-amber-100">A descoberta automática ficará disponível quando a inteligência artificial for ativada no servidor.</p>}
            </section>
          </div>
        </div>

        <section className="mt-6 rounded-[26px] border border-white/10 bg-white/[0.04] p-5 sm:p-6">
          <div className="flex items-center gap-2"><Globe2 className="h-5 w-5 text-cyan-300" /><h2 className="font-black">Fontes encontradas na web</h2></div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(domains.data ?? []).slice(0, 30).map((domain: any) => (
              <div key={domain.id} className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-bold">{domain.business_name || domain.domain}</p><p className="mt-1 truncate text-xs text-slate-500">{domain.domain}</p></div><span className="rounded-full bg-amber-300/10 px-2 py-1 text-[10px] font-black text-amber-100">ANÁLISE</span></div>
                <p className="mt-3 text-xs text-slate-500">{[domain.city, domain.state].filter(Boolean).join(" - ") || "Cobertura a verificar"}</p>
              </div>
            ))}
            {!domains.isLoading && (domains.data?.length ?? 0) === 0 && <div className="col-span-full rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-500">Nenhuma nova fonte descoberta ainda.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="flex items-center gap-2 text-cyan-300">{icon}<span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</span></div><p className="mt-3 text-2xl font-black">{typeof value === "number" ? value.toLocaleString("pt-BR") : value}</p></div>;
}

function SourceCard({ source }: { source: any }) {
  const active = source.status === "active";
  const ready = source.status === "ready";
  const connected = (source.connections ?? []).some((connection: any) => connection.status === "connected");
  const status = connected ? "Conectado" : active ? "Ativo" : ready ? "Pronto para conectar" : "Requer autorização";
  return <div className="rounded-2xl border border-white/10 bg-black/10 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-bold">{source.name}</p><p className="mt-1 text-xs text-slate-500">{source.website_domain || "Feed de parceiro"}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${connected || active ? "bg-emerald-300/10 text-emerald-200" : ready ? "bg-cyan-300/10 text-cyan-100" : "bg-amber-300/10 text-amber-100"}`}>{status.toUpperCase()}</span></div><p className="mt-3 text-xs leading-5 text-slate-500">{source.notes}</p><div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold text-slate-500">{source.supports_updates && <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Atualizações</span>}{source.supports_contacts && <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Contatos quando fornecidos</span>}</div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</span><div className="flex min-h-11 items-center rounded-xl border border-white/10 bg-black/10 px-3 [&_input]:w-full [&_input]:bg-transparent [&_input]:text-sm [&_input]:text-white [&_input]:outline-none [&_input]:placeholder:text-slate-600 [&_select]:w-full [&_select]:bg-transparent [&_select]:text-sm [&_select]:text-white [&_select]:outline-none [&_option]:bg-[#0b1727]">{children}</div></label>;
}
