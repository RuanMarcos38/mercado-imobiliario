import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bath,
  BedDouble,
  Bell,
  Bookmark,
  Building2,
  Check,
  ExternalLink,
  Gavel,
  Heart,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  RefreshCw,
  Ruler,
  Scale,
  Search,
  Tag,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  deleteSavedPropertySearch,
  listSavedPropertySearches,
  renameSavedPropertySearch,
  savePropertySearch,
  searchRealProperties,
  setPropertyFavorite,
  type PropertySearchInput,
  type PropertySearchItem,
} from "@/lib/property-search.functions";
import { getPropertyDashboardStats } from "@/lib/property-dashboard.functions";
import { listFavoritePropertiesWithStatus } from "@/lib/favorite-status.functions";
import { startWhatsAppConversation } from "@/lib/whatsapp-conversation.functions";
import { DashboardAtendimentoPanel } from "@/components/property/DashboardAtendimentoPanel";

const STATES = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];

const PROPERTY_TYPES = [
  "Apartamento",
  "Casa",
  "Terreno",
  "Sobrado",
  "Cobertura",
  "Studio",
  "Comercial",
  "Rural",
  "Empreendimento",
];

type MarketMode = "all" | "market" | "caixa" | "auction";
type SortValue = "recent" | "price_asc" | "price_desc" | "area_desc";

interface Filters {
  city: string;
  neighborhood: string;
  state: string;
  propertyType: string;
  minPrice: string;
  maxPrice: string;
  bedrooms: string;
  bathrooms: string;
  minArea: string;
  maxArea: string;
  sort: SortValue;
  market: MarketMode;
}

const emptyFilters = (market: MarketMode): Filters => ({
  city: "",
  neighborhood: "",
  state: "",
  propertyType: "",
  minPrice: "",
  maxPrice: "",
  bedrooms: "",
  bathrooms: "",
  minArea: "",
  maxArea: "",
  sort: "recent",
  market,
});

function toInput(filters: Filters): PropertySearchInput {
  return {
    city: filters.city || undefined,
    neighborhood: filters.neighborhood || undefined,
    state: filters.state || undefined,
    propertyType: filters.propertyType || undefined,
    minPrice: filters.minPrice ? Number(filters.minPrice) : undefined,
    maxPrice: filters.maxPrice ? Number(filters.maxPrice) : undefined,
    bedrooms: filters.bedrooms ? Number(filters.bedrooms) : undefined,
    bathrooms: filters.bathrooms ? Number(filters.bathrooms) : undefined,
    minArea: filters.minArea ? Number(filters.minArea) : undefined,
    maxArea: filters.maxArea ? Number(filters.maxArea) : undefined,
    market: filters.market,
    sort: filters.sort,
    limit: 48,
  };
}

function propertyKey(property: PropertySearchItem) {
  return property.source_url?.trim().toLowerCase() || property.id;
}

export function PropertyWorkspace({ initialMarket = "all" }: { initialMarket?: MarketMode }) {
  const navigate = useNavigate();
  const searchFn = useServerFn(searchRealProperties);
  const statsFn = useServerFn(getPropertyDashboardStats);
  const favoriteFn = useServerFn(setPropertyFavorite);
  const favoritesFn = useServerFn(listFavoritePropertiesWithStatus);
  const savedFn = useServerFn(listSavedPropertySearches);
  const saveFn = useServerFn(savePropertySearch);
  const renameFn = useServerFn(renameSavedPropertySearch);
  const deleteFn = useServerFn(deleteSavedPropertySearch);
  const startConversationFn = useServerFn(startWhatsAppConversation);

  const [filters, setFilters] = useState<Filters>(() => emptyFilters(initialMarket));
  const [applied, setApplied] = useState<Filters>(() => emptyFilters(initialMarket));
  const [favoriteKeys, setFavoriteKeys] = useState<Set<string>>(new Set());
  const [compare, setCompare] = useState<PropertySearchItem[]>([]);
  const [selected, setSelected] = useState<PropertySearchItem | null>(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);

  const searchQuery = useQuery({
    queryKey: ["properties", applied],
    queryFn: () => searchFn({ data: toInput(applied) }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const statsQuery = useQuery({
    queryKey: ["property-dashboard-stats"],
    queryFn: () => statsFn(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const favoritesQuery = useQuery({
    queryKey: ["favorites-status"],
    queryFn: () => favoritesFn(),
    refetchInterval: 60_000,
  });
  const savedQuery = useQuery({ queryKey: ["saved-searches"], queryFn: () => savedFn() });

  useEffect(() => {
    setFavoriteKeys(new Set((favoritesQuery.data ?? []).map((row) => row.key)));
  }, [favoritesQuery.data]);

  useEffect(() => {
    const applyGlobalSearch = (value: string) => {
      setFilters((current) => {
        const next = { ...current, city: value };
        setApplied(next);
        return next;
      });
    };

    const stored = sessionStorage.getItem("mercadoimobi:globalSearch");
    if (stored) {
      sessionStorage.removeItem("mercadoimobi:globalSearch");
      applyGlobalSearch(stored);
    }

    const listener = (event: Event) => {
      const custom = event as CustomEvent<string>;
      if (typeof custom.detail === "string" && custom.detail.trim()) applyGlobalSearch(custom.detail.trim());
    };
    window.addEventListener("mercadoimobi:global-search", listener);
    return () => window.removeEventListener("mercadoimobi:global-search", listener);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("property-workspace-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "property_search_index" },
        () => {
          void searchQuery.refetch();
          void statsQuery.refetch();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const results = searchQuery.data?.items ?? [];
  const comparedKeys = useMemo(() => new Set(compare.map(propertyKey)), [compare]);
  const opportunityKeys = useMemo(() => calculateOpportunityKeys(results), [results]);
  const stats = statsQuery.data;

  const totalForMarket =
    applied.market === "auction"
      ? stats?.auction_properties
      : applied.market === "caixa"
        ? stats?.caixa_properties
        : applied.market === "market"
          ? stats?.market_properties
          : stats?.total_properties;

  const changeMarket = (market: MarketMode) => {
    const next = { ...filters, market };
    setFilters(next);
    setApplied(next);
  };

  const clear = () => {
    const next = emptyFilters(filters.market);
    setFilters(next);
    setApplied(next);
  };

  const toggleFavorite = async (property: PropertySearchItem) => {
    const key = propertyKey(property);
    const nextState = !favoriteKeys.has(key);
    const next = new Set(favoriteKeys);
    nextState ? next.add(key) : next.delete(key);
    setFavoriteKeys(next);
    try {
      await favoriteFn({ data: { property, favorite: nextState } });
      await favoritesQuery.refetch();
    } catch {
      toast.error("Não foi possível atualizar os favoritos.");
      await favoritesQuery.refetch();
    }
  };

  const toggleCompare = (property: PropertySearchItem) => {
    const key = propertyKey(property);
    setCompare((current) => {
      if (current.some((item) => propertyKey(item) === key)) {
        return current.filter((item) => propertyKey(item) !== key);
      }
      if (current.length >= 3) {
        toast.info("Selecione no máximo 3 imóveis.");
        return current;
      }
      return [...current, property];
    });
  };

  const openWhatsApp = async (property: PropertySearchItem) => {
    if (!property.contact_whatsapp) return;
    try {
      const conversation = await startConversationFn({
        data: {
          phone: property.contact_whatsapp,
          contactName: property.contact_name || undefined,
        },
      });
      sessionStorage.setItem("mercadoimobi:selectedConversation", conversation.id);
      sessionStorage.setItem(
        "mercadoimobi:propertyContext",
        JSON.stringify({ id: property.id, title: property.title, url: property.source_url }),
      );
      void navigate({ to: "/atendimento" });
    } catch {
      toast.error("Não foi possível abrir o atendimento para este contato.");
    }
  };

  const saveSearch = async () => {
    const name = window.prompt("Nome da pesquisa:", filters.city || "Nova pesquisa");
    if (!name?.trim()) return;
    try {
      await saveFn({ data: { name: name.trim(), criteria: toInput(filters) } });
      await savedQuery.refetch();
      toast.success("Pesquisa salva.");
    } catch {
      toast.error("Não foi possível salvar a pesquisa.");
    }
  };

  const createAlertFromSearch = () => {
    sessionStorage.setItem("mercadoimobi:alertCriteria", JSON.stringify(toInput(filters)));
    void navigate({ to: "/alertas" });
  };

  const refreshAll = async () => {
    await Promise.all([searchQuery.refetch(), statsQuery.refetch(), favoritesQuery.refetch()]);
  };

  return (
    <div className="mi-theme-safe min-h-full bg-[var(--mi-bg)] text-[var(--mi-text)]">
      <div className="mx-auto max-w-[1760px] px-4 py-5 sm:px-5 xl:px-6">
        <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_320px]">
          <main className="min-w-0">
            <section className="mi-hero relative overflow-hidden rounded-[22px] border border-white/10 px-6 py-7 text-white sm:px-8 sm:py-8">
              <div className="mi-hero-grid absolute inset-0 opacity-70" />
              <div className="absolute -right-12 top-1/2 h-52 w-52 -translate-y-1/2 rounded-full border border-blue-300/15" />
              <div className="absolute -right-2 top-1/2 h-32 w-32 -translate-y-1/2 rounded-full border border-cyan-300/20" />
              <div className="relative z-10 max-w-3xl">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-200">MercadoImobi</p>
                <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Encontre as melhores oportunidades</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-50/80">
                  Dados reais, imóveis de múltiplas fontes e decisões imobiliárias mais rápidas em um único ambiente.
                </p>
                <div className="mt-5 flex flex-wrap gap-2 text-[11px] font-semibold text-blue-50/90">
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">Base nacional</span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">Atualização automática</span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">Fontes públicas + conectadas</span>
                </div>
              </div>
            </section>

            <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <KpiCard icon={<Building2 className="h-4 w-4" />} tone="blue" label="Total de imóveis" value={formatInteger(stats?.total_properties)} helper="Base completa consultável" />
              <KpiCard icon={<Search className="h-4 w-4" />} tone="green" label="Atualizados 24h" value={formatInteger(stats?.new_last_24h)} helper="Imóveis sincronizados" />
              <KpiCard icon={<Tag className="h-4 w-4" />} tone="purple" label="Oportunidades" value={formatInteger(stats?.opportunities)} helper="Desconto comprovado na fonte" />
              <KpiCard icon={<Bell className="h-4 w-4" />} tone="orange" label="Fontes ativas" value={formatInteger(stats?.active_sources)} helper="Portais e bases monitoradas" />
              <KpiCard icon={<Gavel className="h-4 w-4" />} tone="red" label="Leilões CAIXA" value={formatInteger(stats?.auction_properties)} helper="Modalidade separada" />
            </section>

            <section className="mi-filter-panel mt-4 rounded-[20px] p-4 sm:p-5">
              <div className="flex flex-col justify-between gap-3 border-b border-[var(--mi-border)] pb-4 lg:flex-row lg:items-center">
                <div className="flex flex-wrap gap-1.5">
                  <MarketTab label="Todos" active={filters.market === "all"} onClick={() => changeMarket("all")} />
                  <MarketTab label="Mercado" active={filters.market === "market"} onClick={() => changeMarket("market")} />
                  <MarketTab label="CAIXA" active={filters.market === "caixa"} onClick={() => changeMarket("caixa")} />
                  <MarketTab label="Leilões CAIXA" icon={<Gavel className="h-3.5 w-3.5" />} active={filters.market === "auction"} onClick={() => changeMarket("auction")} />
                </div>
                <button onClick={() => void refreshAll()} className="inline-flex h-9 items-center gap-2 self-start rounded-xl px-3 text-xs font-semibold text-[var(--mi-text-muted)] hover:bg-[var(--mi-hover)] lg:self-auto">
                  <RefreshCw className={`h-3.5 w-3.5 ${searchQuery.isFetching || statsQuery.isFetching ? "animate-spin" : ""}`} /> Atualizar dados
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                <Field label="Cidade"><input value={filters.city} onChange={(event) => setFilters({ ...filters, city: event.target.value })} placeholder="Ex.: Joinville" /></Field>
                <Field label="Bairro"><input value={filters.neighborhood} onChange={(event) => setFilters({ ...filters, neighborhood: event.target.value })} placeholder="Ex.: Centro" /></Field>
                <Field label="Estado"><select value={filters.state} onChange={(event) => setFilters({ ...filters, state: event.target.value })}><option value="">Todos</option>{STATES.map((state) => <option key={state} value={state}>{state}</option>)}</select></Field>
                <Field label="Tipo de imóvel"><select value={filters.propertyType} onChange={(event) => setFilters({ ...filters, propertyType: event.target.value })}><option value="">Todos</option>{PROPERTY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></Field>
                <Field label="Ordenar por"><select value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value as SortValue })}><option value="recent">Mais recentes</option><option value="price_asc">Menor preço</option><option value="price_desc">Maior preço</option><option value="area_desc">Maior área</option></select></Field>
                <Field label="Preço mínimo"><input type="number" min="0" value={filters.minPrice} onChange={(event) => setFilters({ ...filters, minPrice: event.target.value })} placeholder="R$ mín." /></Field>
                <Field label="Preço máximo"><input type="number" min="0" value={filters.maxPrice} onChange={(event) => setFilters({ ...filters, maxPrice: event.target.value })} placeholder="R$ máx." /></Field>
                <Field label="Área mínima (m²)"><input type="number" min="0" value={filters.minArea} onChange={(event) => setFilters({ ...filters, minArea: event.target.value })} placeholder="Mín." /></Field>
                <Field label="Área máxima (m²)"><input type="number" min="0" value={filters.maxArea} onChange={(event) => setFilters({ ...filters, maxArea: event.target.value })} placeholder="Máx." /></Field>
                <Field label="Quartos"><input type="number" min="0" value={filters.bedrooms} onChange={(event) => setFilters({ ...filters, bedrooms: event.target.value })} placeholder="Qualquer" /></Field>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button onClick={() => setApplied({ ...filters })} className="h-10 rounded-xl bg-blue-600 px-5 text-xs font-black text-white hover:bg-blue-700">
                  <Search className="mr-2 h-3.5 w-3.5" /> Buscar imóveis
                </Button>
                <button onClick={clear} className="h-10 rounded-xl border border-[var(--mi-border)] px-4 text-xs font-semibold text-[var(--mi-text-muted)] hover:bg-[var(--mi-hover)]">Limpar filtros</button>
                <button onClick={() => void saveSearch()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--mi-border)] px-4 text-xs font-semibold text-[var(--mi-text)] hover:bg-[var(--mi-hover)]"><Bookmark className="h-3.5 w-3.5" /> Salvar pesquisa</button>
                <button onClick={createAlertFromSearch} className="inline-flex h-10 items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-400/5 px-4 text-xs font-semibold text-amber-700 dark:text-amber-200"><Bell className="h-3.5 w-3.5" /> Criar alerta</button>
                <button onClick={() => setSavedOpen(true)} className="ml-auto hidden h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-[var(--mi-text-muted)] hover:bg-[var(--mi-hover)] md:inline-flex"><Bookmark className="h-3.5 w-3.5" /> Pesquisas salvas</button>
                <button onClick={() => setFavoritesOpen(true)} className="hidden h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-[var(--mi-text-muted)] hover:bg-[var(--mi-hover)] md:inline-flex"><Heart className="h-3.5 w-3.5" /> Favoritos</button>
              </div>
            </section>

            <section className="mt-5">
              <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.17em] text-blue-600">Resultados</p>
                  <h2 className="mt-1 text-xl font-black text-[var(--mi-text)]">
                    {searchQuery.isLoading ? "Carregando imóveis..." : `${formatInteger(totalForMarket)} imóveis na base selecionada`}
                  </h2>
                  <p className="mt-1 text-[11px] text-[var(--mi-text-muted)]">
                    A busca consulta toda a base. Até 48 imóveis são carregados por vez para manter a navegação rápida.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-[var(--mi-surface-strong)] px-2.5 py-1.5 text-[10px] font-semibold text-[var(--mi-text-muted)]">
                    {results.length} exibidos
                  </span>
                  {compare.length > 0 && (
                    <button onClick={() => setCompareOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-xl border border-blue-500/25 bg-blue-500/5 px-3 text-xs font-bold text-blue-600">
                      <Scale className="h-3.5 w-3.5" /> Comparar ({compare.length}/3)
                    </button>
                  )}
                </div>
              </div>

              {searchQuery.isError && (
                <div className="mi-card rounded-2xl p-6 text-center text-sm text-amber-700 dark:text-amber-200">
                  Não foi possível atualizar os imóveis agora.
                </div>
              )}
              {searchQuery.isLoading && <Skeletons />}
              {!searchQuery.isLoading && !searchQuery.isError && results.length === 0 && (
                <div className="mi-card rounded-2xl border-dashed p-12 text-center text-sm text-[var(--mi-text-muted)]">
                  Nenhum imóvel encontrado para estes filtros.
                </div>
              )}
              {!searchQuery.isLoading && results.length > 0 && (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {results.map((property) => (
                    <PropertyCard
                      key={property.id}
                      property={property}
                      favorite={favoriteKeys.has(propertyKey(property))}
                      comparing={comparedKeys.has(propertyKey(property))}
                      opportunity={opportunityKeys.has(propertyKey(property))}
                      onFavorite={() => void toggleFavorite(property)}
                      onCompare={() => toggleCompare(property)}
                      onOpen={() => setSelected(property)}
                      onWhatsApp={() => void openWhatsApp(property)}
                    />
                  ))}
                </div>
              )}
            </section>
          </main>

          <DashboardAtendimentoPanel />
        </div>
      </div>

      {selected && (
        <PropertyModal property={selected} onClose={() => setSelected(null)} onWhatsApp={() => void openWhatsApp(selected)} />
      )}
      {compareOpen && <CompareModal properties={compare} onClose={() => setCompareOpen(false)} onRemove={toggleCompare} />}

      <Drawer open={savedOpen} onClose={() => setSavedOpen(false)} title="Pesquisas salvas">
        {(savedQuery.data ?? []).map((saved) => (
          <div key={saved.id} className="mi-card mb-3 rounded-2xl p-4">
            <button
              className="w-full text-left"
              onClick={() => {
                const criteria = saved.criteria as Partial<PropertySearchInput>;
                const next = {
                  ...filters,
                  city: criteria.city ?? "",
                  neighborhood: criteria.neighborhood ?? "",
                  state: criteria.state ?? "",
                  propertyType: criteria.propertyType ?? "",
                  minPrice: criteria.minPrice != null ? String(criteria.minPrice) : "",
                  maxPrice: criteria.maxPrice != null ? String(criteria.maxPrice) : "",
                  bedrooms: criteria.bedrooms != null ? String(criteria.bedrooms) : "",
                  bathrooms: criteria.bathrooms != null ? String(criteria.bathrooms) : "",
                  minArea: criteria.minArea != null ? String(criteria.minArea) : "",
                  maxArea: criteria.maxArea != null ? String(criteria.maxArea) : "",
                  sort: criteria.sort ?? "recent",
                  market: criteria.market ?? "all",
                } as Filters;
                setFilters(next);
                setApplied(next);
                setSavedOpen(false);
              }}
            >
              <p className="font-bold text-[var(--mi-text)]">{saved.name}</p>
              <p className="mt-1 text-xs text-[var(--mi-text-muted)]">Aplicar esta pesquisa</p>
            </button>
            <div className="mt-3 flex gap-3 border-t border-[var(--mi-border)] pt-3">
              <button
                onClick={async () => {
                  const name = window.prompt("Novo nome:", saved.name);
                  if (name?.trim()) {
                    await renameFn({ data: { id: saved.id, name: name.trim() } });
                    await savedQuery.refetch();
                  }
                }}
                className="text-xs font-semibold text-[var(--mi-text-muted)]"
              >
                Renomear
              </button>
              <button
                onClick={async () => {
                  if (window.confirm("Excluir esta pesquisa?")) {
                    await deleteFn({ data: { id: saved.id } });
                    await savedQuery.refetch();
                  }
                }}
                className="text-xs font-semibold text-rose-500"
              >
                Excluir
              </button>
            </div>
          </div>
        ))}
      </Drawer>

      <Drawer open={favoritesOpen} onClose={() => setFavoritesOpen(false)} title="Favoritos">
        {(favoritesQuery.data ?? []).map(({ key, property, available }) => (
          <div key={key} className="mi-card mb-3 rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-black text-blue-600">{formatPrice(property.price)}</p>
                <p className="mt-1 text-sm font-semibold text-[var(--mi-text)]">{property.title}</p>
                {!available && <Badge className="mt-2 bg-amber-500/10 text-amber-700 dark:text-amber-200">Anúncio indisponível</Badge>}
              </div>
              <button onClick={() => void toggleFavorite(property)} className="text-rose-500"><Heart className="h-4 w-4 fill-current" /></button>
            </div>
          </div>
        ))}
      </Drawer>
    </div>
  );
}

function KpiCard({ icon, label, value, helper, tone }: { icon: ReactNode; label: string; value: string; helper: string; tone: "blue" | "green" | "purple" | "orange" | "red" }) {
  const tones = {
    blue: "bg-blue-500/10 text-blue-600",
    green: "bg-emerald-500/10 text-emerald-600",
    purple: "bg-violet-500/10 text-violet-600",
    orange: "bg-amber-500/10 text-amber-600",
    red: "bg-rose-500/10 text-rose-600",
  };
  return (
    <article className="mi-kpi-card rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tones[tone]}`}>{icon}</span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-[var(--mi-text-muted)]">{label}</p>
          <p className="mt-0.5 text-xl font-black tracking-tight text-[var(--mi-text)]">{value}</p>
          <p className="mt-1 truncate text-[9px] text-[var(--mi-text-soft)]">{helper}</p>
        </div>
      </div>
    </article>
  );
}

function MarketTab({ label, active, onClick, icon }: { label: string; active: boolean; onClick: () => void; icon?: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-bold transition ${active ? "bg-blue-600 text-white shadow-sm" : "text-[var(--mi-text-muted)] hover:bg-[var(--mi-hover)] hover:text-[var(--mi-text)]"}`}
    >
      {icon}{label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-muted)]">{label}</span>
      <div className="mi-filter-field flex h-11 items-center rounded-xl px-3 [&_input]:w-full [&_input]:bg-transparent [&_input]:text-xs [&_input]:outline-none [&_input]:placeholder:text-[var(--mi-text-soft)] [&_select]:w-full [&_select]:bg-transparent [&_select]:text-xs [&_select]:outline-none">
        {children}
      </div>
    </label>
  );
}

function PropertyCard({
  property,
  favorite,
  comparing,
  opportunity,
  onFavorite,
  onCompare,
  onOpen,
  onWhatsApp,
}: {
  property: PropertySearchItem;
  favorite: boolean;
  comparing: boolean;
  opportunity: boolean;
  onFavorite: () => void;
  onCompare: () => void;
  onOpen: () => void;
  onWhatsApp: () => void;
}) {
  return (
    <article className="mi-property-card group overflow-hidden rounded-[18px] transition duration-200 hover:-translate-y-0.5">
      <div className="relative aspect-[16/9] overflow-hidden bg-[var(--mi-surface-strong)]">
        <PropertyImage property={property} />
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <div className="flex flex-wrap gap-1.5">
            {property.is_auction ? (
              <Badge className="border-0 bg-rose-600 text-[10px] text-white"><Gavel className="mr-1 h-3 w-3" /> Leilão CAIXA</Badge>
            ) : opportunity ? (
              <Badge className="border-0 bg-emerald-600 text-[10px] text-white"><Tag className="mr-1 h-3 w-3" /> Preço atrativo</Badge>
            ) : (
              <Badge className="border-0 bg-blue-600 text-[10px] text-white">Novo anúncio</Badge>
            )}
            {property.listing_market === "caixa" && !property.is_auction && (
              <Badge className="border-0 bg-slate-900/75 text-[10px] text-white backdrop-blur">CAIXA</Badge>
            )}
          </div>
          <button onClick={onFavorite} className={`grid h-9 w-9 place-items-center rounded-full border border-white/20 backdrop-blur ${favorite ? "bg-rose-500 text-white" : "bg-black/45 text-white"}`} title={favorite ? "Remover dos favoritos" : "Favoritar"}>
            <Heart className={`h-4 w-4 ${favorite ? "fill-current" : ""}`} />
          </button>
        </div>
      </div>

      <div className="p-4">
        <h3 className="line-clamp-2 min-h-10 text-sm font-black leading-5 text-[var(--mi-text)]">{property.title}</h3>
        <p className="mi-property-meta mt-2 flex items-center gap-1.5 text-[11px]"><MapPin className="h-3.5 w-3.5 shrink-0" /> {[property.location_city, property.location_state].filter(Boolean).join(" - ") || "Localização no anúncio"}</p>

        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--mi-text-soft)]">Preço do imóvel</p>
            <p className="mt-0.5 text-xl font-black tracking-tight text-[var(--mi-text)]">{formatPrice(property.price)}</p>
          </div>
          {property.source_portal && <span className="rounded-lg bg-blue-500/10 px-2 py-1 text-[9px] font-black text-blue-600">{property.source_portal}</span>}
        </div>

        <div className="mi-divider mt-3 flex flex-wrap gap-2 border-y py-3 text-[10px]">
          {property.bedrooms != null && <Feature icon={<BedDouble className="h-3.5 w-3.5" />} text={`${property.bedrooms} quartos`} />}
          {property.bathrooms != null && <Feature icon={<Bath className="h-3.5 w-3.5" />} text={`${property.bathrooms} banh.`} />}
          {property.area_sqm != null && <Feature icon={<Ruler className="h-3.5 w-3.5" />} text={`${property.area_sqm} m²`} />}
        </div>

        {property.sale_mode && (
          <div className={`mt-3 rounded-xl px-3 py-2 text-[10px] font-semibold ${property.is_auction ? "bg-rose-500/10 text-rose-600 dark:text-rose-300" : "bg-blue-500/8 text-blue-700 dark:text-blue-300"}`}>
            Modalidade: {property.sale_mode}
          </div>
        )}

        <p className="mt-3 text-[9px] leading-4 text-[var(--mi-text-soft)]">
          Subsídios, quando informados pela fonte, são tratados separadamente e nunca compõem o preço exibido do imóvel.
        </p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button onClick={onOpen} className="text-xs font-black text-[var(--mi-text)] hover:text-blue-600">Ver detalhes</button>
          <div className="flex gap-1.5">
            {property.contact_whatsapp && (
              <button onClick={onWhatsApp} className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600" title="Conversar no Atendimento"><MessageCircle className="h-3.5 w-3.5" /></button>
            )}
            {property.contact_phone && <a href={`tel:${property.contact_phone}`} className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--mi-surface-soft)] text-[var(--mi-text-muted)]" title="Ligar"><Phone className="h-3.5 w-3.5" /></a>}
            {property.contact_email && <a href={`mailto:${property.contact_email}`} className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--mi-surface-soft)] text-[var(--mi-text-muted)]" title="E-mail"><Mail className="h-3.5 w-3.5" /></a>}
            {property.source_url && <a href={property.source_url} target="_blank" rel="noopener noreferrer" className="grid h-8 w-8 place-items-center rounded-lg bg-blue-600 text-white" title="Abrir anúncio original"><ExternalLink className="h-3.5 w-3.5" /></a>}
          </div>
        </div>

        <button onClick={onCompare} className={`mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-xl border text-[11px] font-bold ${comparing ? "border-blue-500/30 bg-blue-500/8 text-blue-600" : "border-[var(--mi-border)] text-[var(--mi-text-muted)] hover:bg-[var(--mi-hover)]"}`}>
          {comparing ? <Check className="h-3.5 w-3.5" /> : <Scale className="h-3.5 w-3.5" />}{comparing ? "Selecionado para comparar" : "Comparar imóvel"}
        </button>
      </div>
    </article>
  );
}

function PropertyImage({ property }: { property: PropertySearchItem }) {
  const [failed, setFailed] = useState(false);
  const image = property.images?.find(Boolean);
  return image && !failed ? (
    <img src={image} alt={property.title} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]" />
  ) : (
    <div className="flex h-full flex-col items-center justify-center bg-gradient-to-br from-slate-200 to-slate-100 text-slate-400 dark:from-slate-800 dark:to-slate-900 dark:text-slate-500">
      <Building2 className="h-8 w-8" />
      <span className="mt-2 text-[10px]">Imagem indisponível</span>
    </div>
  );
}

function Feature({ icon, text }: { icon: ReactNode; text: string }) {
  return <span className="mi-chip inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5">{icon}{text}</span>;
}

function Skeletons() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="mi-card overflow-hidden rounded-2xl">
          <div className="aspect-[16/9] animate-pulse bg-[var(--mi-surface-strong)]" />
          <div className="space-y-3 p-4">
            <div className="h-4 w-4/5 animate-pulse rounded bg-[var(--mi-surface-strong)]" />
            <div className="h-6 w-1/3 animate-pulse rounded bg-[var(--mi-surface-strong)]" />
            <div className="h-9 animate-pulse rounded bg-[var(--mi-surface-strong)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="mi-modal-backdrop fixed inset-0 z-[80]" onClick={onClose}>
      <div className="mi-panel ml-auto h-full w-full max-w-lg overflow-y-auto border-l p-6" onClick={(event) => event.stopPropagation()}>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-black text-[var(--mi-text)]">{title}</h2>
          <button onClick={onClose} className="mi-icon-button"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PropertyModal({ property, onClose, onWhatsApp }: { property: PropertySearchItem; onClose: () => void; onWhatsApp: () => void }) {
  return (
    <div className="mi-modal-backdrop fixed inset-0 z-[90] overflow-y-auto p-4" onClick={onClose}>
      <div className="mi-panel mx-auto max-w-4xl rounded-[24px] p-5 sm:p-6" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--mi-text-muted)]">Preço do imóvel</p>
            <p className="mt-1 text-3xl font-black text-[var(--mi-text)]">{formatPrice(property.price)}</p>
            <h2 className="mt-2 text-xl font-black text-[var(--mi-text)]">{property.title}</h2>
          </div>
          <button onClick={onClose} className="mi-icon-button"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-5 aspect-[16/8] overflow-hidden rounded-2xl"><PropertyImage property={property} /></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Detail label="Origem" value={property.source_portal || "Fonte conectada"} />
          <Detail label="Modalidade" value={property.sale_mode || (property.is_auction ? "Leilão" : "Venda")} />
          <Detail label="Localização" value={[property.location_city, property.location_state].filter(Boolean).join(" - ") || "No anúncio"} />
          <Detail label="Área" value={property.area_sqm != null ? `${property.area_sqm} m²` : "Não informada"} />
        </div>
        {property.description && <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-[var(--mi-text-muted)]">{property.description}</p>}
        <div className="mt-6 flex flex-wrap gap-2">
          {property.contact_whatsapp && <button onClick={onWhatsApp} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-500/10 px-4 text-xs font-bold text-emerald-600"><MessageCircle className="h-3.5 w-3.5" /> Atendimento</button>}
          {property.source_url && <a href={property.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-black text-white">Abrir anúncio original <ExternalLink className="h-3.5 w-3.5" /></a>}
        </div>
      </div>
    </div>
  );
}

function CompareModal({ properties, onClose, onRemove }: { properties: PropertySearchItem[]; onClose: () => void; onRemove: (property: PropertySearchItem) => void }) {
  return (
    <div className="mi-modal-backdrop fixed inset-0 z-[90] overflow-y-auto p-4" onClick={onClose}>
      <div className="mi-panel mx-auto max-w-6xl rounded-[24px] p-5 sm:p-6" onClick={(event) => event.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <div><p className="text-[10px] font-black uppercase tracking-[0.14em] text-blue-600">Comparador</p><h2 className="mt-1 text-xl font-black">Comparar imóveis</h2></div>
          <button onClick={onClose} className="mi-icon-button"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {properties.map((property) => (
            <div key={propertyKey(property)} className="mi-card rounded-2xl p-4">
              <div className="aspect-[16/9] overflow-hidden rounded-xl"><PropertyImage property={property} /></div>
              <p className="mt-3 line-clamp-2 min-h-10 text-sm font-black">{property.title}</p>
              <p className="mt-2 text-xl font-black text-blue-600">{formatPrice(property.price)}</p>
              <div className="mt-4 space-y-2 text-xs text-[var(--mi-text-muted)]">
                <CompareLine label="Local" value={[property.location_city, property.location_state].filter(Boolean).join(" - ") || "—"} />
                <CompareLine label="Quartos" value={property.bedrooms != null ? String(property.bedrooms) : "—"} />
                <CompareLine label="Banheiros" value={property.bathrooms != null ? String(property.bathrooms) : "—"} />
                <CompareLine label="Área" value={property.area_sqm != null ? `${property.area_sqm} m²` : "—"} />
              </div>
              <button onClick={() => onRemove(property)} className="mt-4 h-9 w-full rounded-xl border border-[var(--mi-border)] text-xs font-semibold text-[var(--mi-text-muted)] hover:bg-[var(--mi-hover)]">Remover da comparação</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-3"><p className="text-[9px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">{label}</p><p className="mt-1 text-sm font-semibold text-[var(--mi-text)]">{value}</p></div>;
}

function CompareLine({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3 border-b border-[var(--mi-border-soft)] pb-2"><span>{label}</span><span className="text-right font-semibold text-[var(--mi-text)]">{value}</span></div>;
}

function calculateOpportunityKeys(items: PropertySearchItem[]) {
  const comparable = items
    .filter((item) => item.price != null && item.price > 0 && item.area_sqm != null && item.area_sqm > 0 && !item.is_auction)
    .map((item) => ({ key: propertyKey(item), value: item.price! / item.area_sqm! }))
    .sort((a, b) => a.value - b.value);

  if (comparable.length < 5) return new Set<string>();
  const middle = Math.floor(comparable.length / 2);
  const median = comparable.length % 2 === 0
    ? (comparable[middle - 1]!.value + comparable[middle]!.value) / 2
    : comparable[middle]!.value;
  const threshold = median * 0.85;
  return new Set(comparable.filter((item) => item.value <= threshold).map((item) => item.key));
}

function formatPrice(value: number | null) {
  return value == null
    ? "Preço no anúncio"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);
}

function formatInteger(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR").format(value);
}
