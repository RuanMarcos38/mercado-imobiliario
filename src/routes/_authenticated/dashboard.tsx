import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bath,
  BedDouble,
  Bookmark,
  Building2,
  Check,
  Clock3,
  ExternalLink,
  Heart,
  Home,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  Pencil,
  RefreshCw,
  Ruler,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { listFavoritePropertiesWithStatus } from "@/lib/favorite-status.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: MercadoImobiDashboard,
  head: () => ({
    title: "Buscar imóveis | MercadoImobi",
    meta: [
      {
        name: "description",
        content:
          "Pesquise imóveis reais, acompanhe atualizações, salve favoritos e compare oportunidades no MercadoImobi.",
      },
    ],
  }),
});

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
];

type SortValue = "recent" | "price_asc" | "price_desc" | "area_desc";

interface FilterState {
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
}

const initialFilters: FilterState = {
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
};

function buildInput(filters: FilterState): PropertySearchInput {
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
    sort: filters.sort,
    limit: 48,
  };
}

function filtersFromCriteria(criteria: unknown): FilterState {
  const source = (criteria ?? {}) as Partial<PropertySearchInput>;
  return {
    city: source.city ?? "",
    neighborhood: source.neighborhood ?? "",
    state: source.state ?? "",
    propertyType: source.propertyType ?? "",
    minPrice: typeof source.minPrice === "number" ? String(source.minPrice) : "",
    maxPrice: typeof source.maxPrice === "number" ? String(source.maxPrice) : "",
    bedrooms: typeof source.bedrooms === "number" ? String(source.bedrooms) : "",
    bathrooms: typeof source.bathrooms === "number" ? String(source.bathrooms) : "",
    minArea: typeof source.minArea === "number" ? String(source.minArea) : "",
    maxArea: typeof source.maxArea === "number" ? String(source.maxArea) : "",
    sort: source.sort ?? "recent",
  };
}

function propertyKey(property: PropertySearchItem) {
  return property.source_url?.trim().toLowerCase() || property.id;
}

function MercadoImobiDashboard() {
  const navigate = useNavigate();
  const searchFn = useServerFn(searchRealProperties);
  const saveSearchFn = useServerFn(savePropertySearch);
  const listSavedFn = useServerFn(listSavedPropertySearches);
  const renameSavedFn = useServerFn(renameSavedPropertySearch);
  const deleteSavedFn = useServerFn(deleteSavedPropertySearch);
  const favoriteFn = useServerFn(setPropertyFavorite);
  const listFavoritesFn = useServerFn(listFavoritePropertiesWithStatus);

  const [userId, setUserId] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(initialFilters);
  const [favoriteKeys, setFavoriteKeys] = useState<Set<string>>(new Set());
  const [compare, setCompare] = useState<PropertySearchItem[]>([]);
  const [selectedProperty, setSelectedProperty] = useState<PropertySearchItem | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) void navigate({ to: "/auth" });
      else setUserId(session.user.id);
    });
  }, [navigate]);

  const searchQuery = useQuery({
    queryKey: ["mercadoimobi-search", userId, appliedFilters],
    queryFn: () => searchFn({ data: buildInput(appliedFilters) }),
    enabled: Boolean(userId),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 20_000,
  });

  const savedSearches = useQuery({
    queryKey: ["saved-property-searches", userId],
    queryFn: () => listSavedFn(),
    enabled: Boolean(userId),
  });

  const favorites = useQuery({
    queryKey: ["property-favorites-status", userId],
    queryFn: () => listFavoritesFn(),
    enabled: Boolean(userId),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    setFavoriteKeys(new Set((favorites.data ?? []).map((item) => item.key)));
  }, [favorites.data]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel("mercadoimobi-property-updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "property_search_index" },
        () => {
          void searchQuery.refetch();
          void favorites.refetch();
        },
      )
      .subscribe();

    const refreshOnFocus = () => {
      if (document.visibilityState === "visible") {
        void searchQuery.refetch();
        void favorites.refetch();
      }
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);

    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const results = searchQuery.data?.items ?? [];

  const runSearch = () => {
    const next = { ...filters };
    if (JSON.stringify(next) === JSON.stringify(appliedFilters)) void searchQuery.refetch();
    else setAppliedFilters(next);
  };

  const clearFilters = () => {
    setFilters(initialFilters);
    setAppliedFilters(initialFilters);
  };

  const saveCurrentSearch = async () => {
    const name = window.prompt("Nome da pesquisa:", filters.city || "Minha pesquisa");
    if (!name?.trim()) return;
    try {
      await saveSearchFn({ data: { name: name.trim(), criteria: buildInput(filters) } });
      await savedSearches.refetch();
      toast.success("Pesquisa salva.");
    } catch {
      toast.error("Não foi possível salvar a pesquisa agora.");
    }
  };

  const applySavedSearch = (criteria: unknown) => {
    const next = filtersFromCriteria(criteria);
    setFilters(next);
    setAppliedFilters(next);
    setShowSaved(false);
  };

  const renameSavedSearch = async (id: string, currentName: string) => {
    const name = window.prompt("Novo nome da pesquisa:", currentName);
    if (!name?.trim() || name.trim() === currentName) return;
    try {
      await renameSavedFn({ data: { id, name: name.trim() } });
      await savedSearches.refetch();
      toast.success("Pesquisa renomeada.");
    } catch {
      toast.error("Não foi possível renomear a pesquisa.");
    }
  };

  const deleteSavedSearch = async (id: string, name: string) => {
    if (!window.confirm(`Excluir a pesquisa “${name}”?`)) return;
    try {
      await deleteSavedFn({ data: { id } });
      await savedSearches.refetch();
      toast.success("Pesquisa excluída.");
    } catch {
      toast.error("Não foi possível excluir a pesquisa.");
    }
  };

  const toggleFavorite = async (property: PropertySearchItem) => {
    const key = propertyKey(property);
    const next = !favoriteKeys.has(key);
    const previous = new Set(favoriteKeys);
    const optimistic = new Set(favoriteKeys);
    if (next) optimistic.add(key);
    else optimistic.delete(key);
    setFavoriteKeys(optimistic);

    try {
      await favoriteFn({ data: { property, favorite: next } });
      await favorites.refetch();
      toast.success(next ? "Imóvel salvo nos favoritos." : "Imóvel removido dos favoritos.");
    } catch {
      setFavoriteKeys(previous);
      toast.error("Não foi possível atualizar os favoritos.");
    }
  };

  const toggleCompare = (property: PropertySearchItem) => {
    const key = propertyKey(property);
    setCompare((current) => {
      if (current.some((item) => propertyKey(item) === key)) {
        return current.filter((item) => propertyKey(item) !== key);
      }
      if (current.length >= 3) {
        toast.info("Você pode comparar até 3 imóveis por vez.");
        return current;
      }
      return [...current, property];
    });
  };

  const logout = async () => {
    await supabase.auth.signOut();
    void navigate({ to: "/" });
  };

  if (!userId) return null;

  return (
    <div className="min-h-screen bg-[#06101c] text-white selection:bg-cyan-300 selection:text-[#06101c]">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#07111f]/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/dashboard" className="flex shrink-0 items-center gap-2 font-black tracking-tight">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-300/10 text-cyan-200 ring-1 ring-cyan-300/20">
              <Building2 className="h-5 w-5" />
            </span>
            <span className="text-lg">
              Mercado<span className="text-cyan-300">Imobi</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            <NavButton active icon={<Search className="h-4 w-4" />}>Buscar imóveis</NavButton>
            <NavButton onClick={() => setShowSaved(true)} icon={<Bookmark className="h-4 w-4" />}>Pesquisas salvas</NavButton>
            <NavButton onClick={() => setShowFavorites(true)} icon={<Heart className="h-4 w-4" />}>Favoritos {favoriteKeys.size > 0 ? `(${favoriteKeys.size})` : ""}</NavButton>
            <Link to="/atendimento" className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-300 transition hover:bg-white/5 hover:text-white">
              <MessageCircle className="h-4 w-4" /> Atendimento
            </Link>
            <Link to="/settings/security" className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-300 transition hover:bg-white/5 hover:text-white">
              <UserRound className="h-4 w-4" /> Minha conta
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <button onClick={() => void searchQuery.refetch()} className="hidden h-10 items-center gap-2 rounded-xl border border-white/10 px-3 text-xs font-semibold text-slate-400 transition hover:bg-white/5 hover:text-white sm:inline-flex" title="Atualizar imóveis">
              <RefreshCw className={`h-3.5 w-3.5 ${searchQuery.isFetching ? "animate-spin" : ""}`} /> Atualizar
            </button>
            <button onClick={() => setMobileMenu((value) => !value)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-slate-300 lg:hidden" aria-label="Abrir menu">
              <Menu className="h-4 w-4" />
            </button>
            <button onClick={() => void logout()} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-slate-400 transition hover:bg-white/5 hover:text-white" title="Sair">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        {mobileMenu && (
          <div className="border-t border-white/10 bg-[#081421] p-3 lg:hidden">
            <div className="mx-auto grid max-w-[1600px] gap-1">
              <MobileNav onClick={() => { setShowSaved(true); setMobileMenu(false); }} icon={<Bookmark className="h-4 w-4" />}>Pesquisas salvas</MobileNav>
              <MobileNav onClick={() => { setShowFavorites(true); setMobileMenu(false); }} icon={<Heart className="h-4 w-4" />}>Favoritos</MobileNav>
              <Link to="/atendimento" className="flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-slate-200 hover:bg-white/5"><MessageCircle className="h-4 w-4" /> Atendimento</Link>
              <Link to="/settings/security" className="flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-slate-200 hover:bg-white/5"><UserRound className="h-4 w-4" /> Minha conta</Link>
            </div>
          </div>
        )}
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-white/10">
          <div className="absolute inset-0 opacity-80 [background-image:linear-gradient(rgba(56,210,255,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(56,210,255,.035)_1px,transparent_1px)] [background-size:48px_48px]" />
          <div className="absolute -left-32 -top-32 h-[430px] w-[430px] rounded-full bg-cyan-400/12 blur-[120px]" />
          <div className="absolute right-0 top-0 h-[420px] w-[420px] rounded-full bg-blue-600/10 blur-[130px]" />

          <div className="relative mx-auto max-w-[1600px] px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
            <div className="max-w-4xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/[0.05] px-3 py-1.5 text-xs font-bold text-cyan-200">
                <Sparkles className="h-3.5 w-3.5" /> Inteligência para decisões imobiliárias
              </div>
              <h1 className="mt-5 text-4xl font-black tracking-[-0.035em] sm:text-5xl lg:text-6xl">
                Encontre oportunidades reais
                <span className="block bg-gradient-to-r from-cyan-200 via-sky-300 to-blue-400 bg-clip-text text-transparent">em uma experiência premium.</span>
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                Pesquise imóveis atualizados, compare características, favorite oportunidades e acesse a fonte original do anúncio.
              </p>
            </div>

            <div className="mt-9 rounded-[28px] border border-white/10 bg-white/[0.055] p-4 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-5">
              <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr_.55fr_.85fr_.85fr_auto]">
                <SearchField label="Cidade" icon={<MapPin className="h-4 w-4" />}>
                  <input value={filters.city} onChange={(event) => setFilters((current) => ({ ...current, city: event.target.value }))} placeholder="Ex.: Joinville" className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-600" />
                </SearchField>
                <SearchField label="Bairro">
                  <input value={filters.neighborhood} onChange={(event) => setFilters((current) => ({ ...current, neighborhood: event.target.value }))} placeholder="Ex.: Centro" className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-600" />
                </SearchField>
                <SearchField label="UF">
                  <select value={filters.state} onChange={(event) => setFilters((current) => ({ ...current, state: event.target.value }))} className="w-full bg-transparent text-sm text-white outline-none">
                    <option value="" className="bg-[#0b1727]">Todas</option>
                    {STATES.map((state) => <option key={state} value={state} className="bg-[#0b1727]">{state}</option>)}
                  </select>
                </SearchField>
                <SearchField label="Tipo" icon={<Home className="h-4 w-4" />}>
                  <select value={filters.propertyType} onChange={(event) => setFilters((current) => ({ ...current, propertyType: event.target.value }))} className="w-full bg-transparent text-sm text-white outline-none">
                    <option value="" className="bg-[#0b1727]">Todos</option>
                    {PROPERTY_TYPES.map((type) => <option key={type} value={type} className="bg-[#0b1727]">{type}</option>)}
                  </select>
                </SearchField>
                <SearchField label="Preço máximo">
                  <input type="number" min="0" value={filters.maxPrice} onChange={(event) => setFilters((current) => ({ ...current, maxPrice: event.target.value }))} placeholder="800000" className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-600" />
                </SearchField>
                <Button onClick={runSearch} disabled={searchQuery.isFetching} className="min-h-16 rounded-2xl bg-cyan-300 px-7 font-black text-[#06101c] hover:bg-cyan-200">
                  <Search className="mr-2 h-4 w-4" /> {searchQuery.isFetching ? "Atualizando..." : "Buscar"}
                </Button>
              </div>

              <div className="mt-3 grid gap-3 border-t border-white/10 pt-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
                <MiniInput label="Preço mínimo" value={filters.minPrice} onChange={(value) => setFilters((current) => ({ ...current, minPrice: value }))} />
                <MiniSelect label="Quartos" value={filters.bedrooms} options={["1", "2", "3", "4", "5"]} onChange={(value) => setFilters((current) => ({ ...current, bedrooms: value }))} />
                <MiniSelect label="Banheiros" value={filters.bathrooms} options={["1", "2", "3", "4"]} onChange={(value) => setFilters((current) => ({ ...current, bathrooms: value }))} />
                <MiniInput label="Área mínima" value={filters.minArea} onChange={(value) => setFilters((current) => ({ ...current, minArea: value }))} />
                <MiniInput label="Área máxima" value={filters.maxArea} onChange={(value) => setFilters((current) => ({ ...current, maxArea: value }))} />
                <MiniSelect label="Ordenar" value={filters.sort} options={[["recent", "Mais recentes"], ["price_asc", "Menor preço"], ["price_desc", "Maior preço"], ["area_desc", "Maior área"]]} onChange={(value) => setFilters((current) => ({ ...current, sort: value as SortValue }))} />
                <button onClick={clearFilters} className="min-h-12 rounded-xl border border-white/10 px-3 text-sm font-semibold text-slate-300 transition hover:bg-white/5">Limpar filtros</button>
                <button onClick={() => void saveCurrentSearch()} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.04] px-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/[0.08]"><Bookmark className="h-4 w-4" /> Salvar pesquisa</button>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6 lg:px-8">
          <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">Resultado da pesquisa</p>
              <h2 className="mt-2 text-2xl font-black sm:text-3xl">
                {searchQuery.isLoading ? "Carregando imóveis..." : `${results.length} ${results.length === 1 ? "imóvel encontrado" : "imóveis encontrados"}`}
              </h2>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                <Clock3 className="h-3.5 w-3.5" /> {searchQuery.dataUpdatedAt ? `Tela atualizada ${formatRelative(new Date(searchQuery.dataUpdatedAt).toISOString())}` : "Atualizando informações"}
              </p>
            </div>
            {compare.length > 0 && (
              <button onClick={() => setShowCompare(true)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-300/[0.07] px-4 py-2.5 text-sm font-bold text-cyan-100">
                <Scale className="h-4 w-4" /> Comparar ({compare.length}/3)
              </button>
            )}
          </div>

          {searchQuery.isError && (
            <div className="rounded-3xl border border-amber-300/20 bg-amber-300/[0.05] px-6 py-8 text-center">
              <p className="font-bold text-amber-100">Não foi possível atualizar os imóveis agora.</p>
              <Button variant="outline" onClick={() => void searchQuery.refetch()} className="mt-4 border-white/10 bg-transparent text-white hover:bg-white/5">Tentar novamente</Button>
            </div>
          )}

          {searchQuery.isLoading && <SkeletonGrid />}

          {!searchQuery.isLoading && !searchQuery.isError && results.length === 0 && (
            <div className="rounded-[30px] border border-dashed border-white/15 bg-white/[0.025] px-6 py-16 text-center">
              <Search className="mx-auto h-8 w-8 text-cyan-300" />
              <h3 className="mt-4 text-xl font-black">Nenhum imóvel encontrado.</h3>
              <p className="mt-2 text-sm text-slate-500">Amplie os filtros para visualizar mais oportunidades.</p>
              <button onClick={clearFilters} className="mt-5 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5">Limpar filtros</button>
            </div>
          )}

          {!searchQuery.isLoading && results.length > 0 && (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {results.map((property) => (
                <PropertyCard
                  key={property.id}
                  property={property}
                  favorite={favoriteKeys.has(propertyKey(property))}
                  comparing={compare.some((item) => propertyKey(item) === propertyKey(property))}
                  onFavorite={() => void toggleFavorite(property)}
                  onCompare={() => toggleCompare(property)}
                  onDetails={() => setSelectedProperty(property)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <SidePanel open={showSaved} onClose={() => setShowSaved(false)} title="Pesquisas salvas" eyebrow="Seus atalhos">
        <div className="space-y-3">
          {(savedSearches.data ?? []).map((saved) => (
            <div key={saved.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <button onClick={() => applySavedSearch(saved.criteria)} className="w-full text-left">
                <p className="font-bold text-slate-100">{saved.name}</p>
                <p className="mt-1 text-xs text-slate-500">Clique para aplicar os filtros.</p>
              </button>
              <div className="mt-3 flex gap-2 border-t border-white/10 pt-3">
                <button onClick={() => void renameSavedSearch(saved.id, saved.name)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/5"><Pencil className="h-3.5 w-3.5" /> Renomear</button>
                <button onClick={() => void deleteSavedSearch(saved.id, saved.name)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-400/10"><Trash2 className="h-3.5 w-3.5" /> Excluir</button>
              </div>
            </div>
          ))}
          {!savedSearches.isLoading && (savedSearches.data?.length ?? 0) === 0 && <EmptyText>Nenhuma pesquisa salva ainda.</EmptyText>}
        </div>
      </SidePanel>

      <SidePanel open={showFavorites} onClose={() => setShowFavorites(false)} title="Favoritos" eyebrow="Sua seleção" wide>
        <div className="space-y-3">
          {(favorites.data ?? []).map(({ key, property, available }) => (
            <div key={key} className={`rounded-2xl border p-4 ${available ? "border-white/10 bg-white/[0.035]" : "border-amber-300/15 bg-amber-300/[0.04]"}`}>
              <div className="flex gap-3">
                <div className="h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-slate-900">
                  <PropertyImage property={property} compact />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-black text-cyan-100">{formatPrice(property.price)}</p>
                      <p className="mt-1 line-clamp-2 text-sm font-semibold text-slate-100">{property.title}</p>
                    </div>
                    <button onClick={() => void toggleFavorite(property)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-rose-500 text-white" title="Remover dos favoritos"><Heart className="h-4 w-4 fill-current" /></button>
                  </div>
                  {!available && <Badge className="mt-2 border border-amber-300/20 bg-amber-300/10 text-amber-100">Anúncio indisponível</Badge>}
                </div>
              </div>
              {available && property.source_url && <a href={property.source_url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-cyan-200 hover:text-cyan-100">Ver anúncio original <ExternalLink className="h-3.5 w-3.5" /></a>}
            </div>
          ))}
          {!favorites.isLoading && (favorites.data?.length ?? 0) === 0 && <EmptyText>Você ainda não favoritou nenhum imóvel.</EmptyText>}
        </div>
      </SidePanel>

      {selectedProperty && <PropertyDetails property={selectedProperty} favorite={favoriteKeys.has(propertyKey(selectedProperty))} onFavorite={() => void toggleFavorite(selectedProperty)} onClose={() => setSelectedProperty(null)} />}

      {showCompare && (
        <Modal onClose={() => setShowCompare(false)} title="Comparar imóveis" eyebrow="Até 3 opções" max="max-w-6xl">
          <div className="grid gap-4 md:grid-cols-3">
            {compare.map((property) => <CompareCard key={propertyKey(property)} property={property} onRemove={() => toggleCompare(property)} />)}
          </div>
        </Modal>
      )}
    </div>
  );
}

function NavButton({ children, icon, active, onClick }: { children: React.ReactNode; icon: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return <button onClick={onClick} className={`inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition ${active ? "bg-white/[0.06] text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}>{icon}{children}</button>;
}

function MobileNav({ children, icon, onClick }: { children: React.ReactNode; icon: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className="flex h-11 items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-slate-200 hover:bg-white/5">{icon}{children}</button>;
}

function SearchField({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return <label className="flex min-h-16 flex-col justify-center rounded-2xl border border-white/10 bg-black/15 px-4 transition focus-within:border-cyan-300/35 focus-within:bg-cyan-300/[0.025]"><span className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{icon}{label}</span>{children}</label>;
}

function MiniInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="rounded-xl border border-white/10 bg-black/10 px-3 py-2"><span className="block text-[10px] font-black uppercase tracking-[0.13em] text-slate-500">{label}</span><input type="number" min="0" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full bg-transparent text-sm text-white outline-none" /></label>;
}

function MiniSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<string | [string, string]>; onChange: (value: string) => void }) {
  return <label className="rounded-xl border border-white/10 bg-black/10 px-3 py-2"><span className="block text-[10px] font-black uppercase tracking-[0.13em] text-slate-500">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full bg-transparent text-sm text-white outline-none"><option value="" className="bg-[#0b1727]">Qualquer</option>{options.map((option) => { const pair = Array.isArray(option) ? option : [option, `${option}+`]; return <option key={pair[0]} value={pair[0]} className="bg-[#0b1727]">{pair[1]}</option>; })}</select></label>;
}

function PropertyCard({ property, favorite, comparing, onFavorite, onCompare, onDetails }: { property: PropertySearchItem; favorite: boolean; comparing: boolean; onFavorite: () => void; onCompare: () => void; onDetails: () => void }) {
  return (
    <Card className="group overflow-hidden rounded-[26px] border-white/10 bg-white/[0.045] text-white shadow-xl shadow-black/10 transition duration-300 hover:-translate-y-1 hover:border-cyan-300/20 hover:bg-white/[0.06]">
      <div className="relative aspect-[16/10] overflow-hidden bg-[#0b1727]">
        <PropertyImage property={property} />
        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3">
          <div className="flex flex-wrap gap-2">
            {property.is_verified && <Badge className="border border-emerald-300/30 bg-emerald-950/75 text-emerald-200 backdrop-blur-md"><ShieldCheck className="mr-1 h-3 w-3" /> Verificado</Badge>}
            {property.source_portal && <Badge className="border border-white/15 bg-slate-950/70 text-slate-200 backdrop-blur-md">{property.source_portal}</Badge>}
          </div>
          <button onClick={onFavorite} className={`grid h-10 w-10 place-items-center rounded-full border backdrop-blur-md transition ${favorite ? "border-rose-300/30 bg-rose-500 text-white" : "border-white/15 bg-slate-950/65 text-white hover:bg-slate-900"}`} title={favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}><Heart className={`h-4 w-4 ${favorite ? "fill-current" : ""}`} /></button>
        </div>
      </div>
      <CardContent className="p-5">
        <p className="text-2xl font-black tracking-tight text-cyan-50">{formatPrice(property.price)}</p>
        <h3 className="mt-2 line-clamp-2 min-h-11 text-base font-bold leading-snug text-slate-100">{property.title}</h3>
        <p className="mt-3 flex min-h-5 items-center gap-1.5 text-sm text-slate-400"><MapPin className="h-3.5 w-3.5 shrink-0 text-cyan-300" />{[property.location_city, property.location_state].filter(Boolean).join(" - ") || property.location_address || "Localização no anúncio"}</p>
        {property.location_address && <p className="mt-1 line-clamp-1 text-xs text-slate-600">{property.location_address}</p>}
        <div className="mt-4 flex flex-wrap gap-2 border-y border-white/10 py-3 text-xs text-slate-300">
          {property.bedrooms != null && <Feature icon={<BedDouble className="h-3.5 w-3.5" />} text={`${property.bedrooms} qtos`} />}
          {property.bathrooms != null && <Feature icon={<Bath className="h-3.5 w-3.5" />} text={`${property.bathrooms} banh.`} />}
          {property.area_sqm != null && <Feature icon={<Ruler className="h-3.5 w-3.5" />} text={`${property.area_sqm} m²`} />}
          {property.property_type && <Feature icon={<Home className="h-3.5 w-3.5" />} text={property.property_type} />}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={onDetails} className="h-11 rounded-xl border border-white/10 text-sm font-semibold text-slate-200 transition hover:bg-white/5">Detalhes</button>
          <button onClick={onCompare} className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition ${comparing ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-100" : "border-white/10 text-slate-300 hover:bg-white/5"}`}>{comparing ? <Check className="h-4 w-4" /> : <Scale className="h-4 w-4" />}{comparing ? "Selecionado" : "Comparar"}</button>
          {property.source_url && <a href={property.source_url} target="_blank" rel="noopener noreferrer" className="col-span-2 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-black text-[#06101c] transition hover:bg-cyan-200">Ver anúncio <ExternalLink className="h-4 w-4" /></a>}
        </div>
      </CardContent>
    </Card>
  );
}

function PropertyImage({ property, compact }: { property: PropertySearchItem; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  const image = property.images?.find((value) => Boolean(value?.trim())) ?? null;
  if (!image || failed) return <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#102238] to-[#07111f] text-slate-500"><Building2 className={compact ? "h-6 w-6" : "h-10 w-10"} /><span className={`mt-2 ${compact ? "hidden" : "text-xs"}`}>Imagem indisponível</span></div>;
  return <img src={image} alt={property.title} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]" />;
}

function SidePanel({ open, onClose, title, eyebrow, children, wide }: { open: boolean; onClose: () => void; title: string; eyebrow: string; children: React.ReactNode; wide?: boolean }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm" onClick={onClose}><div className={`ml-auto h-full w-full overflow-y-auto border-l border-white/10 bg-[#0b1727] p-6 shadow-2xl ${wide ? "max-w-lg" : "max-w-md"}`} onClick={(event) => event.stopPropagation()}><div className="mb-6 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">{eyebrow}</p><h2 className="mt-1 text-xl font-black">{title}</h2></div><button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-white/5"><X className="h-5 w-5" /></button></div>{children}</div></div>;
}

function Modal({ onClose, title, eyebrow, children, max = "max-w-4xl" }: { onClose: () => void; title: string; eyebrow: string; children: React.ReactNode; max?: string }) {
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-4 backdrop-blur-md sm:p-8" onClick={onClose}><div className={`mx-auto rounded-[30px] border border-white/10 bg-[#0b1727] p-5 shadow-2xl sm:p-8 ${max}`} onClick={(event) => event.stopPropagation()}><div className="mb-7 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">{eyebrow}</p><h2 className="mt-1 text-2xl font-black">{title}</h2></div><button onClick={onClose} className="rounded-xl border border-white/10 p-2.5 text-slate-300 hover:bg-white/5"><X className="h-5 w-5" /></button></div>{children}</div></div>;
}

function PropertyDetails({ property, favorite, onFavorite, onClose }: { property: PropertySearchItem; favorite: boolean; onFavorite: () => void; onClose: () => void }) {
  return <Modal onClose={onClose} title={property.title} eyebrow="Detalhes do imóvel"><div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]"><div className="aspect-[16/10] overflow-hidden rounded-2xl bg-slate-900"><PropertyImage property={property} /></div><div><p className="text-3xl font-black text-cyan-100">{formatPrice(property.price)}</p><p className="mt-3 flex items-start gap-2 text-sm leading-6 text-slate-300"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />{[property.location_address, property.location_city, property.location_state].filter(Boolean).join(" — ") || "Localização no anúncio"}</p><div className="mt-5 grid grid-cols-2 gap-3"><Detail label="Tipo" value={property.property_type ?? "—"} /><Detail label="Quartos" value={property.bedrooms != null ? String(property.bedrooms) : "—"} /><Detail label="Banheiros" value={property.bathrooms != null ? String(property.bathrooms) : "—"} /><Detail label="Área" value={property.area_sqm != null ? `${property.area_sqm} m²` : "—"} /></div><div className="mt-5 flex flex-col gap-2"><button onClick={onFavorite} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 text-sm font-semibold text-slate-200 hover:bg-white/5"><Heart className={`h-4 w-4 ${favorite ? "fill-current text-rose-300" : ""}`} />{favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}</button>{property.source_url && <a href={property.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-cyan-300 text-sm font-black text-[#06101c]">Ver anúncio original <ExternalLink className="h-4 w-4" /></a>}</div></div></div>{property.description && <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-7 text-slate-300">{property.description}</div>}</Modal>;
}

function CompareCard({ property, onRemove }: { property: PropertySearchItem; onRemove: () => void }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"><div className="aspect-[16/10] overflow-hidden rounded-xl bg-slate-900"><PropertyImage property={property} /></div><h3 className="mt-4 line-clamp-2 min-h-10 font-bold">{property.title}</h3><p className="mt-3 text-2xl font-black text-cyan-200">{formatPrice(property.price)}</p><div className="mt-5 space-y-2 text-sm"><CompareLine label="Local" value={[property.location_city, property.location_state].filter(Boolean).join(" - ") || "—"} /><CompareLine label="Tipo" value={property.property_type ?? "—"} /><CompareLine label="Quartos" value={property.bedrooms != null ? String(property.bedrooms) : "—"} /><CompareLine label="Banheiros" value={property.bathrooms != null ? String(property.bathrooms) : "—"} /><CompareLine label="Área" value={property.area_sqm != null ? `${property.area_sqm} m²` : "—"} /></div><button onClick={onRemove} className="mt-5 w-full rounded-xl border border-white/10 px-3 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/5">Remover da comparação</button></div>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/10 bg-black/15 p-3"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-100">{value}</p></div>; }
function Feature({ icon, text }: { icon: React.ReactNode; text: string }) { return <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-2.5 py-1.5">{icon}{text}</span>; }
function CompareLine({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-3 border-b border-white/10 pb-2 text-slate-300"><span className="text-slate-500">{label}</span><span className="text-right font-semibold">{value}</span></div>; }
function EmptyText({ children }: { children: React.ReactNode }) { return <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-slate-500">{children}</div>; }

function SkeletonGrid() { return <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.035]"><div className="aspect-[16/10] animate-pulse bg-white/[0.06]" /><div className="space-y-3 p-5"><div className="h-7 w-1/3 animate-pulse rounded bg-white/[0.08]" /><div className="h-4 w-4/5 animate-pulse rounded bg-white/[0.06]" /><div className="h-4 w-1/2 animate-pulse rounded bg-white/[0.05]" /><div className="h-11 animate-pulse rounded-xl bg-white/[0.05]" /></div></div>)}</div>; }

function formatPrice(value: number | null) { return value == null ? "Preço no anúncio" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value); }
function formatRelative(iso: string) { const timestamp = new Date(iso).getTime(); if (!Number.isFinite(timestamp)) return "recentemente"; const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000)); if (seconds < 60) return "agora"; const minutes = Math.floor(seconds / 60); if (minutes < 60) return `há ${minutes} min`; const hours = Math.floor(minutes / 60); if (hours < 24) return `há ${hours} h`; const days = Math.floor(hours / 24); return `há ${days} d`; }
