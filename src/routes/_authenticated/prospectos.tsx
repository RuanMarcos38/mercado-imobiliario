import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bot,
  ExternalLink,
  Flame,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  UserRoundSearch,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  getProspectRadarStatus,
  searchHotRealEstateProspects,
  type ProspectSearchResponse,
} from "@/lib/prospect-leads.functions";
import { SOCIAL_NETWORKS, type ProspectLead, type SocialNetwork } from "@/lib/prospect-leads.core";

export const Route = createFileRoute("/_authenticated/prospectos")({
  component: ProspectRadarPage,
  head: () => ({ title: "Prospecção IA | MercadoImobi" }),
});

const NETWORK_LABELS: Record<SocialNetwork, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X / Twitter",
  linkedin: "LinkedIn",
  threads: "Threads",
  pinterest: "Pinterest",
};

type ChatMessage = { role: "user" | "assistant"; text: string };

function ProspectRadarPage() {
  const statusFn = useServerFn(getProspectRadarStatus);
  const searchFn = useServerFn(searchHotRealEstateProspects);
  const status = useQuery({ queryKey: ["prospect-radar-status"], queryFn: () => statusFn() });

  const [prompt, setPrompt] = useState(
    "Encontre pessoas demonstrando interesse real em comprar apartamento, perguntando preço, financiamento ou visita.",
  );
  const [location, setLocation] = useState("Brasil — todo território nacional");
  const [intent, setIntent] = useState<"qualquer" | "comprar" | "alugar" | "investir">("comprar");
  const [propertyType, setPropertyType] = useState("apartamento");
  const [selectedNetworks, setSelectedNetworks] = useState<SocialNetwork[]>([...SOCIAL_NETWORKS]);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<ProspectSearchResponse | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Diga qual perfil de comprador, locatário ou investidor você procura. Eu faço a varredura somente em conteúdo público e indexável e trago os sinais de intenção com a fonte para revisão.",
    },
  ]);

  const hotCount = useMemo(
    () => result?.leads.filter((lead) => lead.intentStage === "quente").length ?? 0,
    [result],
  );

  const toggleNetwork = (network: SocialNetwork) => {
    setSelectedNetworks((current) =>
      current.includes(network)
        ? current.filter((item) => item !== network)
        : [...current, network],
    );
  };

  const runSearch = async () => {
    const query = prompt.trim();
    if (query.length < 3) {
      toast.info("Descreva o perfil de prospecto que deseja localizar.");
      return;
    }
    if (!selectedNetworks.length) {
      toast.info("Selecione pelo menos uma rede social.");
      return;
    }
    if (!status.data?.configured) {
      toast.error("A Pesquisa Web IA precisa estar configurada no servidor.");
      return;
    }

    setSearching(true);
    setMessages((current) => [...current, { role: "user", text: query }]);
    try {
      const response = await searchFn({
        data: {
          query,
          location: location.trim() || undefined,
          intent,
          propertyType: propertyType.trim() || undefined,
          networks: selectedNetworks,
          limit: 24,
        },
      });
      setResult(response);
      setMessages((current) => [
        ...current,
        { role: "assistant", text: response.assistantMessage },
      ]);
    } catch {
      toast.error("Não foi possível concluir a varredura pública agora. Tente novamente.");
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: "A busca não foi concluída nesta tentativa. Nenhum contato foi inventado ou preenchido por aproximação.",
        },
      ]);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1500px]">
        <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-blue-600">
              <Radar className="h-4 w-4" /> Radar de leads imobiliários
            </p>
            <h1 className="mt-2 text-3xl font-black">Prospecção IA em redes sociais públicas</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--mi-text-muted)]">
              Localize sinais públicos de intenção de compra, aluguel ou investimento em imóveis em
              todo o Brasil. O radar nasce com cobertura nacional — Norte, Nordeste, Centro-Oeste,
              Sudeste e Sul — e permite refinar por cidade ou região quando necessário, sempre
              mantendo a fonte para conferência.
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.05] px-4 py-3">
            <p className="flex items-center gap-2 text-xs font-black text-emerald-700 dark:text-emerald-200">
              <ShieldCheck className="h-4 w-4" /> Fontes públicas e permitidas
            </p>
            <p className="mt-1 max-w-sm text-[11px] leading-5 text-[var(--mi-text-soft)]">
              Sem contornar login, privacidade ou anti-bot. Perfis privados e contatos ocultos não
              são coletados.
            </p>
          </div>
        </header>

        <div className="mt-7 grid gap-6 xl:grid-cols-[460px_1fr]">
          <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-blue-600" />
              <h2 className="text-lg font-black">Chatbot de prospecção</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--mi-text-muted)]">
              Descreva em linguagem natural quem você quer encontrar. Por padrão, a varredura cobre
              todo o território nacional; use o campo de localização somente quando quiser
              restringir a busca.
            </p>

            <div className="mt-5 max-h-72 space-y-3 overflow-y-auto rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-4">
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                      message.role === "user"
                        ? "bg-blue-600 text-white"
                        : "border border-[var(--mi-border)] bg-[var(--mi-surface)] text-[var(--mi-text)]"
                    }`}
                  >
                    {message.text}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-4">
              <Field label="O que o prospecto está demonstrando?">
                <textarea
                  rows={5}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Ex.: Pessoas procurando apartamento de 2 quartos e perguntando sobre entrada e financiamento."
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Cobertura nacional / filtro de região">
                  <input
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                    placeholder="Brasil — todo território nacional"
                  />
                </Field>
                <Field label="Tipo de imóvel">
                  <input
                    value={propertyType}
                    onChange={(event) => setPropertyType(event.target.value)}
                    placeholder="Ex.: apartamento"
                  />
                </Field>
              </div>

              <Field label="Intenção principal">
                <select
                  value={intent}
                  onChange={(event) => setIntent(event.target.value as typeof intent)}
                >
                  <option value="qualquer">Qualquer intenção imobiliária</option>
                  <option value="comprar">Comprar</option>
                  <option value="alugar">Alugar</option>
                  <option value="investir">Investir</option>
                </select>
              </Field>

              <div>
                <p className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--mi-text-soft)]">
                  Redes sociais públicas
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {SOCIAL_NETWORKS.map((network) => {
                    const checked = selectedNetworks.includes(network);
                    return (
                      <label
                        key={network}
                        className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold ${
                          checked
                            ? "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-200"
                            : "border-[var(--mi-border)] bg-[var(--mi-surface-soft)] text-[var(--mi-text-muted)]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleNetwork(network)}
                          className="accent-blue-600"
                        />
                        {NETWORK_LABELS[network]}
                      </label>
                    );
                  })}
                </div>
              </div>

              <Button
                onClick={() => void runSearch()}
                disabled={searching || !status.data?.configured}
                className="h-12 w-full rounded-xl bg-blue-600 font-black text-white hover:bg-blue-700"
              >
                <Search className="mr-2 h-4 w-4" />
                {searching ? "Varrendo fontes públicas..." : "Buscar leads quentes"}
              </Button>
            </div>
          </section>

          <section className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard
                icon={UserRoundSearch}
                label="Leads encontrados"
                value={result?.leads.length ?? 0}
              />
              <MetricCard icon={Flame} label="Leads quentes" value={hotCount} emphasis />
              <MetricCard
                icon={Target}
                label="Redes respondendo"
                value={result?.networks.filter((network) => network.operational).length ?? 0}
              />
            </div>

            {!result && (
              <div className="rounded-[26px] border border-dashed border-[var(--mi-border)] bg-[var(--mi-surface)] p-10 text-center">
                <Sparkles className="mx-auto h-8 w-8 text-blue-600" />
                <h2 className="mt-4 text-xl font-black">
                  Pronto para buscar sinais reais de intenção
                </h2>
                <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-[var(--mi-text-muted)]">
                  A busca não dispara mensagens automaticamente. Você revisa o perfil, a evidência e
                  a fonte antes de qualquer abordagem comercial.
                </p>
              </div>
            )}

            {result && (
              <>
                <NetworkStatus networks={result.networks} />

                {result.warnings.length > 0 && (
                  <div className="rounded-2xl border border-amber-300/25 bg-amber-300/[0.06] p-4 text-xs leading-5 text-amber-800 dark:text-amber-100">
                    {result.warnings.slice(0, 8).map((warning) => (
                      <p key={warning}>• {warning}</p>
                    ))}
                  </div>
                )}

                <div className="grid gap-4 lg:grid-cols-2">
                  {result.leads.map((lead) => (
                    <LeadCard key={lead.id} lead={lead} />
                  ))}
                </div>

                {!result.leads.length && (
                  <div className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-8 text-center text-sm text-[var(--mi-text-muted)]">
                    Nenhum sinal público suficientemente confiável foi localizado nesta tentativa.
                    Amplie os termos e pesquise novamente; a cobertura padrão já considera todo o
                    Brasil.
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function LeadCard({ lead }: { lead: ProspectLead }) {
  const hot = lead.intentStage === "quente";
  return (
    <article className="rounded-[24px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-blue-600">
            {NETWORK_LABELS[lead.network]}
          </p>
          <h3 className="mt-1 truncate text-lg font-black">{lead.displayName}</h3>
          {lead.profileHandle && (
            <p className="mt-1 truncate text-xs text-[var(--mi-text-soft)]">{lead.profileHandle}</p>
          )}
        </div>
        <div
          className={`shrink-0 rounded-xl border px-3 py-2 text-center ${
            hot
              ? "border-rose-400/25 bg-rose-400/[0.08] text-rose-700 dark:text-rose-200"
              : "border-amber-400/25 bg-amber-400/[0.08] text-amber-800 dark:text-amber-100"
          }`}
        >
          <p className="text-[10px] font-black uppercase">{lead.intentStage}</p>
          <p className="text-lg font-black">{lead.intentScore}</p>
        </div>
      </div>

      {lead.evidence && (
        <div className="mt-4 rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
            Sinal público observado
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--mi-text)]">{lead.evidence}</p>
        </div>
      )}

      {lead.intentSignals.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {lead.intentSignals.map((signal) => (
            <span
              key={signal}
              className="rounded-full border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-2.5 py-1 text-[10px] font-bold text-[var(--mi-text-muted)]"
            >
              {signal}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-2 text-xs text-[var(--mi-text-muted)]">
        {lead.location && (
          <p className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5" /> {lead.location}
          </p>
        )}
        {lead.publicPhone && (
          <p className="flex items-center gap-2">
            <Phone className="h-3.5 w-3.5" /> {lead.publicPhone}
          </p>
        )}
        {lead.publicEmail && (
          <p className="flex items-center gap-2 break-all">
            <Mail className="h-3.5 w-3.5" /> {lead.publicEmail}
          </p>
        )}
        {lead.publishedAt && (
          <p className="text-[11px]">Atividade pública informada: {lead.publishedAt}</p>
        )}
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <a
          href={lead.profileUrl}
          target="_blank"
          rel="noreferrer"
          className="flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 text-xs font-black text-white hover:bg-blue-700"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Abrir perfil público
        </a>
        {lead.publicWebsite ? (
          <a
            href={lead.publicWebsite}
            target="_blank"
            rel="noreferrer"
            className="flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--mi-border)] px-3 text-xs font-black text-[var(--mi-text)]"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Site profissional
          </a>
        ) : (
          <span className="flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--mi-border)] px-3 text-center text-[10px] font-bold text-[var(--mi-text-soft)]">
            <MessageCircle className="h-3.5 w-3.5" /> Revisão humana antes do contato
          </span>
        )}
      </div>

      {lead.profileType === "consumidor" && (
        <p className="mt-3 text-[10px] leading-4 text-[var(--mi-text-soft)]">
          Perfil de consumidor: por privacidade, o radar exibe o perfil e o sinal público, sem
          enriquecer telefone ou e-mail pessoal.
        </p>
      )}
    </article>
  );
}

function NetworkStatus({ networks }: { networks: ProspectSearchResponse["networks"] }) {
  return (
    <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-4">
      <div className="flex flex-wrap gap-2">
        {networks.map((item) => (
          <span
            key={item.network}
            className={`rounded-full border px-3 py-1.5 text-[10px] font-black ${
              item.operational
                ? "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-700 dark:text-emerald-200"
                : "border-slate-400/20 bg-slate-400/[0.05] text-[var(--mi-text-soft)]"
            }`}
          >
            {NETWORK_LABELS[item.network]} ·{" "}
            {item.operational ? `${item.found} sinais` : "indisponível"}
          </span>
        ))}
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  emphasis,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-4">
      <div className="flex items-center gap-2 text-[var(--mi-text-soft)]">
        <Icon className={`h-4 w-4 ${emphasis ? "text-rose-500" : "text-blue-600"}`} />
        <span className="text-[10px] font-black uppercase tracking-[0.12em]">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.14em] text-[var(--mi-text-soft)]">
        {label}
      </span>
      <div className="rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-3 py-2 [&_input]:w-full [&_input]:bg-transparent [&_input]:text-sm [&_input]:text-[var(--mi-text)] [&_input]:outline-none [&_select]:w-full [&_select]:bg-transparent [&_select]:text-sm [&_select]:text-[var(--mi-text)] [&_select]:outline-none [&_textarea]:w-full [&_textarea]:resize-none [&_textarea]:bg-transparent [&_textarea]:text-sm [&_textarea]:leading-6 [&_textarea]:text-[var(--mi-text)] [&_textarea]:outline-none">
        {children}
      </div>
    </label>
  );
}
