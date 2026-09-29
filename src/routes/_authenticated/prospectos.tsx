import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Mail, MapPin, Phone, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  getProspectRadarSnapshot,
  getProspectRadarStatus,
  searchHotRealEstateProspects,
  type ProspectSearchResponse,
} from "@/lib/prospect-leads.functions";
import { SOCIAL_NETWORKS, type ProspectLead, type SocialNetwork } from "@/lib/prospect-leads.core";

export const Route = createFileRoute("/_authenticated/prospectos")({
  component: ProspectRadarPage,
  head: () => ({ title: "Prospecção | MercadoImobi" }),
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

function ProspectRadarPage() {
  const statusFn = useServerFn(getProspectRadarStatus);
  const snapshotFn = useServerFn(getProspectRadarSnapshot);
  const searchFn = useServerFn(searchHotRealEstateProspects);

  const status = useQuery({ queryKey: ["prospect-radar-status"], queryFn: () => statusFn() });
  const snapshot = useQuery({
    queryKey: ["prospect-radar-auto-snapshot"],
    queryFn: () => snapshotFn(),
    refetchInterval: 60_000,
  });

  const [prompt, setPrompt] = useState(
    "Encontre pessoas demonstrando interesse real em comprar apartamento, perguntando preço, financiamento ou visita.",
  );
  const [location, setLocation] = useState("Brasil — todo território nacional");
  const [intent, setIntent] = useState<"qualquer" | "comprar" | "alugar" | "investir">("comprar");
  const [propertyType, setPropertyType] = useState("apartamento");
  const [selectedNetworks, setSelectedNetworks] = useState<SocialNetwork[]>([...SOCIAL_NETWORKS]);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<ProspectSearchResponse | null>(null);

  const displayResult = result ?? snapshot.data?.result ?? null;
  const hotCount = useMemo(
    () => displayResult?.leads.filter((lead) => lead.intentStage === "quente").length ?? 0,
    [displayResult],
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
      toast.error("A pesquisa de prospectos está indisponível no momento.");
      return;
    }

    setSearching(true);
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
    } catch {
      toast.error("Não foi possível concluir a pesquisa agora. Tente novamente.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="prospect-corporate-page">
      <header className="prospect-corporate-header">
        <div>
          <h1>Prospecção</h1>
          <span>Leads imobiliários</span>
        </div>
        <Button
          onClick={() => void runSearch()}
          disabled={searching || !status.data?.configured}
          className="prospect-primary-action"
        >
          <Search />
          {searching ? "Buscando..." : "Buscar leads"}
        </Button>
      </header>

      <section className="prospect-toolbar">
        <Field label="Perfil procurado" wide>
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ex.: interessados em apartamento, financiamento ou visita"
          />
        </Field>

        <Field label="Localização">
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Brasil"
          />
        </Field>

        <Field label="Tipo de imóvel">
          <input
            value={propertyType}
            onChange={(event) => setPropertyType(event.target.value)}
            placeholder="Apartamento"
          />
        </Field>

        <Field label="Intenção">
          <select
            value={intent}
            onChange={(event) => setIntent(event.target.value as typeof intent)}
          >
            <option value="qualquer">Todas</option>
            <option value="comprar">Comprar</option>
            <option value="alugar">Alugar</option>
            <option value="investir">Investir</option>
          </select>
        </Field>
      </section>

      <section className="prospect-network-bar" aria-label="Fontes selecionadas">
        <strong>Fontes</strong>
        <div>
          {SOCIAL_NETWORKS.map((network) => {
            const checked = selectedNetworks.includes(network);
            return (
              <label key={network} className={checked ? "is-active" : ""}>
                <input type="checkbox" checked={checked} onChange={() => toggleNetwork(network)} />
                <span>{NETWORK_LABELS[network]}</span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="prospect-summary-row">
        <Metric label="Leads encontrados" value={displayResult?.leads.length ?? 0} />
        <Metric label="Leads quentes" value={hotCount} />
        <Metric
          label="Fontes respondendo"
          value={displayResult?.networks.filter((network) => network.operational).length ?? 0}
        />
        <div className="prospect-update-status">
          <span>Atualização</span>
          <strong>
            {snapshot.data
              ? new Date(snapshot.data.searchedAt).toLocaleString("pt-BR")
              : "Aguardando"}
          </strong>
        </div>
      </section>

      <section className="prospect-results">
        <div className="prospect-results-head">
          <div>
            <h2>Prospectos</h2>
            <span>{displayResult?.leads.length ?? 0} registros</span>
          </div>
        </div>

        {displayResult?.leads.length ? (
          <div className="prospect-card-grid">
            {displayResult.leads.map((lead) => (
              <LeadCard key={lead.id} lead={lead} />
            ))}
          </div>
        ) : (
          <div className="prospect-empty">
            <strong>Nenhum prospecto exibido</strong>
            <span>Use os filtros acima e execute uma nova busca.</span>
          </div>
        )}
      </section>
    </div>
  );
}

function LeadCard({ lead }: { lead: ProspectLead }) {
  const initials = lead.displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <article className="prospect-card">
      <div className="prospect-card-head">
        <span className="prospect-card-avatar">{initials || "LE"}</span>
        <div>
          <strong>{lead.displayName}</strong>
          <span>{lead.profileHandle || NETWORK_LABELS[lead.network]}</span>
        </div>
        <span
          className={lead.intentStage === "quente" ? "prospect-score is-hot" : "prospect-score"}
        >
          {lead.intentScore}
        </span>
      </div>

      <div className="prospect-card-meta">
        <span>
          <MapPin />
          {lead.location || "Localização não informada"}
        </span>
        {lead.publicPhone && (
          <span>
            <Phone />
            {lead.publicPhone}
          </span>
        )}
        {lead.publicEmail && (
          <span>
            <Mail />
            {lead.publicEmail}
          </span>
        )}
      </div>

      {lead.evidence && <p className="prospect-card-note">{lead.evidence}</p>}

      <div className="prospect-card-footer">
        <span>{NETWORK_LABELS[lead.network]}</span>
        <div>
          <a href={lead.profileUrl} target="_blank" rel="noreferrer">
            <ExternalLink />
            Perfil
          </a>
          {lead.publicWebsite && (
            <a href={lead.publicWebsite} target="_blank" rel="noreferrer">
              Site
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="prospect-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? "prospect-field is-wide" : "prospect-field"}>
      <span>{label}</span>
      <div>{children}</div>
    </label>
  );
}
