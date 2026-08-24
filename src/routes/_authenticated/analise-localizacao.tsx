import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  Building2,
  Bus,
  GraduationCap,
  Hospital,
  MapPin,
  Search,
  ShoppingBasket,
  TrendingUp,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  analyzePropertyLocation,
  type LocationAnalysisResult,
} from "@/lib/location-analysis.functions";

export const Route = createFileRoute("/_authenticated/analise-localizacao")({
  component: LocationAnalysisPage,
  head: () => ({ title: "Análise de localização | MercadoImobi" }),
});

function money(value: number | null) {
  if (value === null) return "Sem amostra";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
}

function number(value: number | null) {
  return value === null ? "—" : new Intl.NumberFormat("pt-BR").format(value);
}

function dateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function LocationAnalysisPage() {
  const analyzeFn = useServerFn(analyzePropertyLocation);
  const requestSequence = useRef(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LocationAnalysisResult | null>(null);
  const [form, setForm] = useState({
    address: "",
    neighborhood: "",
    city: "Joinville",
    state: "SC",
  });

  const run = async () => {
    const requestId = ++requestSequence.current;
    const snapshot = {
      address: form.address.trim(),
      neighborhood: form.neighborhood.trim(),
      city: form.city.trim(),
      state: form.state.trim().toUpperCase(),
      requestNonce: Date.now(),
    };

    setLoading(true);
    setResult(null);
    try {
      const nextResult = await analyzeFn({ data: snapshot });
      if (requestId === requestSequence.current) setResult(nextResult);
    } catch (error) {
      if (requestId === requestSequence.current) {
        toast.error(
          String((error as Error)?.message ?? "Não foi possível analisar a localização."),
        );
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  };

  const copyReport = async () => {
    if (!result) return;
    const pricingScope =
      result.market.pricingScope === "residencial" ? "residencial" : "todos os tipos";
    const text = [
      `ANÁLISE DE LOCALIZAÇÃO — ${result.query.neighborhood ? `${result.query.neighborhood}, ` : ""}${result.query.city}/${result.query.state}`,
      `Índice de potencial: ${result.score}/100 — ${result.classification}`,
      result.summary,
      `Escopo do mercado: ${result.market.scope === "bairro" ? "bairro" : "município"}`,
      `Anúncios reais indexados: ${result.market.indexedListings}`,
      `Anúncios com preço válido: ${result.market.pricedListings}`,
      `Amostra estatística de preço: ${result.market.sampleSize} (${pricingScope})`,
      `Preço mediano observado: ${money(result.market.medianPrice)}`,
      `Preço médio observado: ${money(result.market.averagePrice)}`,
      `Faixa central observada (25%–75%): ${money(result.market.p25Price)} a ${money(result.market.p75Price)}`,
      `Preço mediano/m² observado: ${money(result.market.medianPricePerSqm)}`,
      `Recência: ${result.market.recentListings90d} anúncio(s) vistos nos últimos 90 dias | ${result.market.sourceCount} fonte(s)`,
      `Última evidência de mercado: ${dateTime(result.market.latestSeenAt)}`,
      `População municipal (Censo 2022): ${number(result.demographics.population2022)}`,
      `Infraestrutura (${result.infrastructure.provider}): ${result.infrastructure.schools} educação, ${result.infrastructure.health} saúde, ${result.infrastructure.supermarkets} supermercados, ${result.infrastructure.parks} parques, ${result.infrastructure.transit} transporte.`,
      `Fontes: ${result.sources.join("; ")}`,
      result.caveat,
    ].join("\n\n");
    await navigator.clipboard.writeText(text);
    toast.success("Resumo copiado para enviar ao cliente.");
  };

  return (
    <div className="min-h-screen bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1400px]">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">
          Inteligência territorial
        </p>
        <h1 className="mt-2 text-3xl font-black">Análise de localização e potencial</h1>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--mi-text-muted)]">
          Combine preços observados, infraestrutura mapeada e dados oficiais para apoiar uma
          recomendação mais qualificada ao cliente.
        </p>

        <section className="mt-6 rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.5fr_1fr_1fr_120px_auto] xl:items-end">
            <Field label="Endereço ou referência">
              <Input
                value={form.address}
                onChange={(event) => setForm({ ...form, address: event.target.value })}
                placeholder="Rua, condomínio ou empreendimento"
              />
            </Field>
            <Field label="Bairro">
              <Input
                value={form.neighborhood}
                onChange={(event) => setForm({ ...form, neighborhood: event.target.value })}
                placeholder="Ex.: América"
              />
            </Field>
            <Field label="Cidade">
              <Input
                value={form.city}
                onChange={(event) => setForm({ ...form, city: event.target.value })}
              />
            </Field>
            <Field label="UF">
              <Input
                value={form.state}
                maxLength={2}
                onChange={(event) => setForm({ ...form, state: event.target.value.toUpperCase() })}
              />
            </Field>
            <Button
              onClick={() => void run()}
              disabled={loading || form.city.trim().length < 2 || form.state.length !== 2}
              className="h-10"
            >
              <Search className="mr-2 h-4 w-4" /> {loading ? "Atualizando..." : "Analisar"}
            </Button>
          </div>
        </section>

        {loading && (
          <div className="mt-6 rounded-[22px] border border-blue-500/20 bg-blue-600/[0.05] p-5 text-sm font-bold text-blue-700">
            Consultando novamente mercado, infraestrutura e dados municipais para esta localização…
          </div>
        )}

        {result && (
          <div key={result.analyzedAt} className="mt-6 space-y-6">
            <section className="grid gap-5 lg:grid-cols-[320px_1fr]">
              <div className="rounded-[28px] border border-blue-500/20 bg-blue-600/[0.06] p-6">
                <p className="text-[10px] font-black uppercase tracking-[0.17em] text-blue-600">
                  Índice de potencial
                </p>
                <p className="mt-4 text-6xl font-black tracking-tight text-blue-600">
                  {result.score}
                  <span className="text-lg text-[var(--mi-text-soft)]">/100</span>
                </p>
                <p className="mt-3 font-black">{result.classification}</p>
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-blue-600/10">
                  <div
                    className="h-full rounded-full bg-blue-600"
                    style={{ width: `${result.score}%` }}
                  />
                </div>
              </div>
              <div className="rounded-[28px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-6">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <MapPin className="h-5 w-5 text-blue-600" />
                      <h2 className="text-lg font-black">Leitura da região</h2>
                    </div>
                    <p className="mt-2 text-xs font-bold text-blue-600">
                      Pesquisa atual:{" "}
                      {result.query.neighborhood ? `${result.query.neighborhood}, ` : ""}
                      {result.query.city}/{result.query.state} · atualizada em{" "}
                      {dateTime(result.analyzedAt)}
                    </p>
                    <p className="mt-3 max-w-4xl text-sm leading-7 text-[var(--mi-text-muted)]">
                      {result.summary}
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => void copyReport()}>
                    Copiar relatório
                  </Button>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-4">
                  <ComponentScore
                    label="Infraestrutura"
                    value={result.components.infrastructure}
                    max={40}
                  />
                  <ComponentScore label="Liquidez" value={result.components.liquidity} max={25} />
                  <ComponentScore
                    label="Evidência"
                    value={result.components.marketEvidence}
                    max={20}
                  />
                  <ComponentScore
                    label="Confiança"
                    value={result.components.dataConfidence}
                    max={15}
                  />
                </div>
              </div>
            </section>

            <section className="grid gap-5 lg:grid-cols-3">
              <Panel title="Mercado observado" icon={TrendingUp}>
                <Stat
                  label="Escopo usado"
                  value={result.market.scope === "bairro" ? "Bairro" : "Município"}
                />
                <Stat label="Anúncios reais indexados" value={number(result.market.indexedListings)} />
                <Stat label="Com preço válido" value={number(result.market.pricedListings)} />
                <Stat label="Amostra estatística de preço" value={number(result.market.sampleSize)} />
                <Stat
                  label="Recorte de preço"
                  value={result.market.pricingScope === "residencial" ? "Residencial" : "Todos os tipos"}
                />
                <Stat
                  label="Vistos nos últimos 90 dias"
                  value={number(result.market.recentListings90d)}
                />
                <Stat label="Preço mediano" value={money(result.market.medianPrice)} />
                <Stat label="Preço médio" value={money(result.market.averagePrice)} />
                <Stat label="Faixa central (P25)" value={money(result.market.p25Price)} />
                <Stat label="Faixa central (P75)" value={money(result.market.p75Price)} />
                <Stat label="Preço mediano por m²" value={money(result.market.medianPricePerSqm)} />
                <Stat label="Fontes na região" value={number(result.market.sourceCount)} />
                <Stat label="Última evidência" value={dateTime(result.market.latestSeenAt)} />
              </Panel>

              <Panel title="Infraestrutura próxima" icon={Activity}>
                {result.infrastructure.available ? (
                  <>
                    <div className="mb-3 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-3 text-xs text-[var(--mi-text-muted)]">
                      Raio de {(result.infrastructure.radiusMeters / 1000).toFixed(1)} km · fonte{" "}
                      {result.infrastructure.provider === "google"
                        ? "Google Maps Platform"
                        : "OpenStreetMap"}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Amenity
                        icon={GraduationCap}
                        label="Educação"
                        value={result.infrastructure.schools}
                      />
                      <Amenity icon={Hospital} label="Saúde" value={result.infrastructure.health} />
                      <Amenity
                        icon={ShoppingBasket}
                        label="Mercados"
                        value={result.infrastructure.supermarkets}
                      />
                      <Amenity icon={MapPin} label="Parques" value={result.infrastructure.parks} />
                      <Amenity
                        icon={Bus}
                        label="Transporte"
                        value={result.infrastructure.transit}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-sm leading-6 text-[var(--mi-text-muted)]">
                    A consulta cartográfica ao vivo não retornou pontos neste ciclo. O backend tenta
                    o provedor configurado e faz fallback por OpenStreetMap. Informe um endereço ou
                    bairro mais específico e execute novamente a análise.
                  </p>
                )}
              </Panel>

              <Panel title="Contexto municipal" icon={Users}>
                <Stat
                  label="Município IBGE"
                  value={result.demographics.municipalityName || "Não localizado"}
                />
                <Stat label="Código IBGE" value={result.demographics.municipalityCode || "—"} />
                <Stat
                  label="População — Censo 2022"
                  value={number(result.demographics.population2022)}
                />
                <div className="mt-4 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-3 text-xs leading-5 text-[var(--mi-text-muted)]">
                  O Censo 2022 é a referência censitária oficial. O dado populacional contextualiza
                  a escala urbana e não é usado isoladamente como previsão de preço.
                </div>
              </Panel>
            </section>

            <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-blue-600" />
                <h2 className="font-black">Fontes e metodologia</h2>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {result.sources.map((source) => (
                  <span
                    key={source}
                    className="rounded-full border border-[var(--mi-border)] bg-[var(--mi-bg)] px-3 py-1.5 text-xs font-bold"
                  >
                    {source}
                  </span>
                ))}
              </div>
              <p className="mt-4 text-xs leading-6 text-[var(--mi-text-soft)]">{result.caveat}</p>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ComponentScore({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-3">
      <p className="text-[9px] font-black uppercase tracking-[0.11em] text-[var(--mi-text-soft)]">
        {label}
      </p>
      <p className="mt-2 text-lg font-black">
        {value}
        <span className="text-[10px] text-[var(--mi-text-soft)]">/{max}</span>
      </p>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-blue-600" />
        <h2 className="font-black">{title}</h2>
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--mi-border)] pb-3 last:border-0">
      <span className="text-xs text-[var(--mi-text-muted)]">{label}</span>
      <span className="text-right text-sm font-black">{value}</span>
    </div>
  );
}

function Amenity({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-3">
      <Icon className="h-4 w-4 text-blue-600" />
      <p className="mt-2 text-xl font-black">{value}</p>
      <p className="text-[10px] text-[var(--mi-text-soft)]">{label}</p>
    </div>
  );
}
