import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  BadgeCheck,
  Building2,
  Check,
  Copy,
  ExternalLink,
  Handshake,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  getPartnerSearchStatus,
  searchRealEstatePartners,
  type PartnerSearchResponse,
} from "@/lib/partner-search.functions";
import { partnerCompletenessScore, type PartnerCandidate } from "@/lib/partner-search.core";

export const Route = createFileRoute("/_authenticated/parcerias")({
  component: ParceriasPage,
  head: () => ({ title: "Parcerias imobiliárias | MercadoImobi" }),
});

type EntityFilter = "todos" | "corretor" | "imobiliaria";

const ENTITY_LABELS: Record<EntityFilter, string> = {
  todos: "Corretores e imobiliárias",
  corretor: "Somente corretores",
  imobiliaria: "Somente imobiliárias",
};

function whatsappUrl(phone: string | null) {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (digits.length < 12) return null;
  return `https://wa.me/${digits}`;
}

function sourceLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Fonte";
  }
}

function creciBadge(candidate: PartnerCandidate) {
  if (candidate.creciStatus === "verificado") {
    return {
      label: candidate.creciNumber
        ? `CRECI ${candidate.creciNumber}${candidate.creciUf ? ` · ${candidate.creciUf}` : ""}`
        : "CRECI verificado",
      className:
        "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200",
      icon: BadgeCheck,
    };
  }
  if (candidate.creciNumber) {
    return {
      label: `CRECI ${candidate.creciNumber}${candidate.creciUf ? ` · ${candidate.creciUf}` : ""} · confirmar`,
      className:
        "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200",
      icon: ShieldCheck,
    };
  }
  return {
    label: "CRECI não localizado",
    className: "border-[var(--mi-border)] bg-[var(--mi-surface-soft)] text-[var(--mi-text-soft)]",
    icon: ShieldCheck,
  };
}

function ParceriasPage() {
  const statusFn = useServerFn(getPartnerSearchStatus);
  const searchFn = useServerFn(searchRealEstatePartners);
  const [location, setLocation] = useState("");
  const [entityType, setEntityType] = useState<EntityFilter>("todos");
  const [specialty, setSpecialty] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PartnerSearchResponse | null>(null);

  const status = useQuery({
    queryKey: ["partner-search-status"],
    queryFn: () => statusFn(),
    staleTime: 60_000,
  });

  const verifiedCount = useMemo(
    () => result?.partners.filter((partner) => partner.creciStatus === "verificado").length ?? 0,
    [result],
  );

  const runSearch = async () => {
    const target = location.trim();
    if (target.length < 2) {
      toast.info("Informe uma cidade, bairro, região ou estado para pesquisar.");
      return;
    }
    if (loading) return;
    setLoading(true);
    try {
      const response = await searchFn({
        data: {
          location: target,
          entityType,
          specialty: specialty.trim() || undefined,
          limit: 24,
        },
      });
      setResult(response);
      if (!response.partners.length) {
        toast.info("Nenhum parceiro foi localizado. Tente ampliar ou ajustar a região.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(
        message.includes("PARTNER_SEARCH_NOT_CONFIGURED")
          ? "A pesquisa externa ainda precisa ser configurada no servidor."
          : "Não foi possível concluir a busca de parceiros agora.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[var(--mi-bg)] px-4 py-6 text-[var(--mi-text)] sm:px-6">
      <div className="mx-auto max-w-[1500px]">
        <header className="rounded-[24px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 shadow-sm sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 flex items-center gap-2 text-blue-600">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600/10">
                  <Handshake className="h-5 w-5" />
                </span>
                <span className="text-[10px] font-black uppercase tracking-[0.16em]">
                  Rede de parceiros
                </span>
              </div>
              <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
                Encontre corretores e imobiliárias em todo o Brasil
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--mi-text-muted)]">
                Pesquise parceiros por cidade, bairro, região ou estado quando seu cliente procura
                um imóvel fora da sua área de atuação. A busca combina fontes públicas da web e,
                quando configurado, Google Places, priorizando nome, CRECI, telefone, e-mail, site e
                fontes de confirmação.
              </p>
            </div>

            <div className="grid min-w-[260px] grid-cols-2 gap-2">
              <ProviderStatus
                label="Pesquisa Web IA"
                configured={Boolean(status.data?.openaiWeb)}
                loading={status.isLoading}
              />
              <ProviderStatus
                label="Google Places"
                configured={Boolean(status.data?.googlePlaces)}
                loading={status.isLoading}
              />
            </div>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
            className="mt-6 grid gap-3 lg:grid-cols-[1.35fr_0.8fr_1fr_auto]"
          >
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
                Cidade, bairro, região ou estado
              </span>
              <div className="flex h-12 items-center gap-2 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-3 focus-within:border-blue-500">
                <MapPin className="h-4 w-4 shrink-0 text-blue-600" />
                <input
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="Ex.: Balneário Camboriú, SC"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--mi-text-soft)]"
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
                Tipo de parceiro
              </span>
              <select
                value={entityType}
                onChange={(event) => setEntityType(event.target.value as EntityFilter)}
                className="h-12 w-full rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-3 text-sm outline-none focus:border-blue-500"
              >
                {Object.entries(ENTITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
                Especialidade opcional
              </span>
              <input
                value={specialty}
                onChange={(event) => setSpecialty(event.target.value)}
                placeholder="Ex.: alto padrão, lançamentos, rural"
                className="h-12 w-full rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-3 text-sm outline-none placeholder:text-[var(--mi-text-soft)] focus:border-blue-500"
              />
            </label>

            <div className="flex items-end">
              <Button
                type="submit"
                disabled={loading}
                className="h-12 w-full rounded-xl bg-blue-600 px-6 font-black text-white hover:bg-blue-700 lg:w-auto"
              >
                {loading ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                {loading ? "Pesquisando..." : "Buscar parceiros"}
              </Button>
            </div>
          </form>
        </header>

        <div className="mt-4 rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-4 py-3 text-xs leading-5 text-[var(--mi-text-muted)]">
          <strong className="text-[var(--mi-text)]">Critério de segurança:</strong> o sistema não
          inventa contatos. Dados ausentes aparecem como não localizados. O selo de CRECI verificado
          só deve ser considerado confirmado quando houver fonte pública oficial do CRECI/COFECI;
          antes de formalizar parceria, confirme inscrição, identidade profissional, regras de
          comissão e disponibilidade do imóvel diretamente com o parceiro.
        </div>

        {result && (
          <section className="mt-6">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-blue-600">
                  Resultado da pesquisa
                </p>
                <h2 className="mt-1 text-xl font-black">
                  {result.partners.length} parceiro{result.partners.length === 1 ? "" : "s"}{" "}
                  localizado
                  {result.partners.length === 1 ? "" : "s"}
                </h2>
                <p className="mt-1 text-xs text-[var(--mi-text-soft)]">
                  {verifiedCount} com CRECI confirmado em fonte oficial · busca realizada em{" "}
                  {new Date(result.searchedAt).toLocaleString("pt-BR")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-[10px] font-bold">
                {result.providers.openaiWeb && (
                  <span className="rounded-full border border-[var(--mi-border)] bg-[var(--mi-surface)] px-3 py-1.5">
                    Web Search ativo
                  </span>
                )}
                {result.providers.googlePlaces && (
                  <span className="rounded-full border border-[var(--mi-border)] bg-[var(--mi-surface)] px-3 py-1.5">
                    Google Places ativo
                  </span>
                )}
              </div>
            </div>

            {result.warnings.length > 0 && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                {result.warnings.join(" ")}
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {result.partners.map((partner) => (
                <PartnerCard key={partner.id} partner={partner} />
              ))}
            </div>

            {!result.partners.length && (
              <div className="rounded-[24px] border border-dashed border-[var(--mi-border)] bg-[var(--mi-surface)] px-6 py-16 text-center">
                <Search className="mx-auto h-8 w-8 text-[var(--mi-text-soft)]" />
                <p className="mt-3 font-black">Nenhum parceiro encontrado nesta busca.</p>
                <p className="mt-1 text-sm text-[var(--mi-text-soft)]">
                  Tente informar apenas a cidade e o estado ou remova a especialidade.
                </p>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function ProviderStatus({
  label,
  configured,
  loading,
}: {
  label: string;
  configured: boolean;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-3">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${loading ? "bg-slate-400" : configured ? "bg-emerald-500" : "bg-amber-500"}`}
        />
        <span className="text-[10px] font-black uppercase tracking-[0.08em] text-[var(--mi-text-soft)]">
          {label}
        </span>
      </div>
      <p className="mt-1 text-xs font-black">
        {loading ? "Verificando" : configured ? "Configurado" : "Opcional / não configurado"}
      </p>
    </div>
  );
}

function PartnerCard({ partner }: { partner: PartnerCandidate }) {
  const badge = creciBadge(partner);
  const BadgeIcon = badge.icon;
  const whatsapp = whatsappUrl(partner.phone);
  const score = partnerCompletenessScore(partner);

  const copyContact = async () => {
    const lines = [
      partner.name,
      partner.creciNumber
        ? `CRECI ${partner.creciNumber}${partner.creciUf ? `/${partner.creciUf}` : ""}`
        : null,
      partner.phone ? `Telefone: ${partner.phone}` : null,
      partner.email ? `E-mail: ${partner.email}` : null,
      partner.website ? `Site: ${partner.website}` : null,
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Contato copiado.");
    } catch {
      toast.error("Não foi possível copiar o contato.");
    }
  };

  return (
    <article className="flex h-full flex-col rounded-[22px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-600/10 text-blue-600">
          {partner.entityType === "imobiliaria" ? (
            <Building2 className="h-5 w-5" />
          ) : (
            <UserRound className="h-5 w-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.12em] text-blue-600">
                {partner.entityType === "imobiliaria" ? "Imobiliária" : "Corretor(a) de imóveis"}
              </p>
              <h3 className="mt-1 break-words text-base font-black leading-5">{partner.name}</h3>
            </div>
            <button
              type="button"
              onClick={() => void copyContact()}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[var(--mi-border)] text-[var(--mi-text-soft)] hover:text-blue-600"
              title="Copiar contato"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>

          <div
            className={`mt-3 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-black ${badge.className}`}
          >
            <BadgeIcon className="h-3.5 w-3.5" />
            {badge.label}
            {partner.creciType && <span>· {partner.creciType}</span>}
          </div>
        </div>
      </div>

      {partner.summary && (
        <p className="mt-4 text-xs leading-5 text-[var(--mi-text-muted)]">{partner.summary}</p>
      )}

      <div className="mt-4 space-y-2.5 text-xs">
        <ContactRow icon={Phone} label="Telefone" value={partner.phone} />
        <ContactRow icon={Mail} label="E-mail" value={partner.email} />
        <ContactRow
          icon={MapPin}
          label="Localização"
          value={
            partner.address || [partner.city, partner.state].filter(Boolean).join(" · ") || null
          }
        />
      </div>

      {partner.specialties.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {partner.specialties.slice(0, 5).map((specialty) => (
            <span
              key={specialty}
              className="rounded-lg bg-[var(--mi-surface-soft)] px-2 py-1 text-[9px] font-bold text-[var(--mi-text-muted)]"
            >
              {specialty}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {whatsapp && (
          <a
            href={whatsapp}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-[11px] font-black text-white hover:bg-emerald-700"
          >
            <Phone className="h-3.5 w-3.5" /> WhatsApp
          </a>
        )}
        {partner.email && (
          <a
            href={`mailto:${partner.email}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--mi-border)] px-3 text-[11px] font-black hover:text-blue-600"
          >
            <Mail className="h-3.5 w-3.5" /> E-mail
          </a>
        )}
        {partner.website && (
          <a
            href={partner.website}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--mi-border)] px-3 text-[11px] font-black hover:text-blue-600"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Site
          </a>
        )}
        {partner.googleMapsUrl && (
          <a
            href={partner.googleMapsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--mi-border)] px-3 text-[11px] font-black hover:text-blue-600"
          >
            <MapPin className="h-3.5 w-3.5" /> Google
          </a>
        )}
      </div>

      <div className="mt-5 border-t border-[var(--mi-border)] pt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[9px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
            Fontes públicas
          </p>
          <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--mi-text-soft)]">
            <Check className="h-3 w-3" /> completude {score}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {partner.sourceUrls.slice(0, 5).map((source) => (
            <a
              key={source}
              href={source}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--mi-border)] px-2 py-1 text-[9px] font-bold text-blue-600"
              title={source}
            >
              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{sourceLabel(source)}</span>
            </a>
          ))}
          {!partner.sourceUrls.length && (
            <span className="text-[10px] text-[var(--mi-text-soft)]">
              Fonte direta não disponibilizada pelo provedor.
            </span>
          )}
        </div>
        {partner.sourceProviders.length > 0 && (
          <p className="mt-2 text-[9px] text-[var(--mi-text-soft)]">
            Pesquisa: {partner.sourceProviders.join(" + ")}
          </p>
        )}
      </div>
    </article>
  );
}

function ContactRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Phone;
  label: string;
  value: string | null;
}) {
  return (
    <div className="grid grid-cols-[18px_74px_1fr] items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 text-[var(--mi-text-soft)]" />
      <span className="font-bold text-[var(--mi-text-soft)]">{label}</span>
      <span className="break-words font-semibold text-[var(--mi-text)]">
        {value || "Não localizado"}
      </span>
    </div>
  );
}
