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
  Pencil,
  Ruler,
  Scale,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import {
  deleteSavedPropertySearch,
  listFavoriteProperties,
  listSavedPropertySearches,
  renameSavedPropertySearch,
  savePropertySearch,
  searchRealProperties,
  setPropertyFavorite,
} from "@/lib/property-search.functions";
import type { PropertySearchInput, PropertySearchItem } from "@/lib/property-search.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: PropertySearchPage,
  head: () => ({
    title: "Buscar imóveis | MercadoImobi",
    meta: [
      {
        name: "description",
        content:
          "Pesquise imóveis reais, compare opções e acesse o anúncio original em uma experiência simples e rápida.",
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

interface FilterState {
  city: string;
  state: string;
  propertyType: string;
  minPrice: string;
  maxPrice: string;
  bedrooms: string;
  bathrooms: string;
  verifiedOnly: boolean;
  sort: "recent" | "price_asc" | "price_desc";
}

const initialFilters: FilterState = {
  city: "",
  state: "",
  propertyType: "",
  minPrice: "",
  maxPrice: "",
  bedrooms: "",
  bathrooms: "",
  verifiedOnly: false,
  sort: "recent",
};

function getPropertyKey(property: PropertySearchItem) {
  return property.source_url?.trim().toLowerCase() || property.id;
}

function PropertySearchPage() {
  const navigate = useNavigate();
  const searchFn = useServerFn(searchRealProperties);
  const saveSearchFn = useServerFn(savePropertySearch);
  const listSavedFn = useServerFn(listSavedPropertySearches);
  const renameSavedFn = useServerFn(renameSavedPropertySearch);
  const deleteSavedFn = useServerFn(deleteSavedPropertySearch);
  const listFavoritesFn = useServerFn(listFavoriteProperties);
  const setFavoriteFn = useServerFn(setPropertyFavorite);

  const [user, setUser] = useState<any>(null);
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [results, setResults] = useState<PropertySearchItem[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);

  const savedSearches = useQuery({
    queryKey: ["saved-property-searches", user?.id],
    queryFn: () => listSavedFn(),
    enabled: Boolean(user),
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) navigate({ to: "/auth" });
      else setUser(session.user);
    });
  }, [navigate]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("mercadoimobi:favorites");
      if (raw) setFavorites(new Set(JSON.parse(raw)));
    } catch {
      setFavorites(new Set());
    }
  }, []);

  const comparedProperties = useMemo(
    () =>
      compareIds
        .map((id) => results.find((item) => item.id === id))
        .filter(Boolean) as PropertySearchItem[],
    [compareIds, results],
  );

  const buildInput = (source = filters): PropertySearchInput => ({
    city: source.city || undefined,
    state: source.state || undefined,
    propertyType: source.propertyType || undefined,
    minPrice: source.minPrice ? Number(source.minPrice) : undefined,
    maxPrice: source.maxPrice ? Number(source.maxPrice) : undefined,
    bedrooms: source.bedrooms ? Number(source.bedrooms) : undefined,
    bathrooms: source.bathrooms ? Number(source.bathrooms) : undefined,
    verifiedOnly: source.verifiedOnly,
    sort: source.sort,
    limit: 36,
  });

  const runSearch = async (nextFilters = filters) => {
    setLoading(true);
    setSearchError(false);
    setHasSearched(true);
    setShowCompare(false);
    try {
      const response = await searchFn({ data: buildInput(nextFilters) });
      setResults(response.items);
      setLastUpdatedAt(response.latestTimestamp);
      setCompareIds((ids) => ids.filter((id) => response.items.some((item) => item.id === id)));
    } catch {
      setResults([]);
      setLastUpdatedAt(null);
      setSearchError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) void runSearch(initialFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  const toggleFavorite = (id: string) => {
    const next = new Set(favorites);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFavorites(next);
    window.localStorage.setItem("mercadoimobi:favorites", JSON.stringify(Array.from(next)));
  };

  const toggleCompare = (id: string) => {
    setCompareIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 3) {
        toast.info("Você pode comparar até 3 imóveis por vez.");
        return current;
      }
      return [...current, id];
    });
  };

  const handleSaveSearch = async () => {
    const name = window.prompt("Dê um nome para esta pesquisa:", filters.city || "Minha pesquisa");
    if (!name?.trim()) return;
    try {
      await saveSearchFn({ data: { name: name.trim(), criteria: buildInput() } });
      await savedSearches.refetch();
      toast.success("Pesquisa salva.");
    } catch {
      toast.error("Não foi possível salvar a pesquisa agora.");
    }
  };

  const handleRenameSavedSearch = async (id: string, currentName: string) => {
    const name = window.prompt("Novo nome da pesquisa:", currentName);
    if (!name?.trim() || name.trim() === currentName) return;
    try {
      await renameSavedFn({ data: { id, name: name.trim() } });
      await savedSearches.refetch();
      toast.success("Pesquisa renomeada.");
    } catch {
      toast.error("Não foi possível renomear a pesquisa agora.");
    }
  };

  const handleDeleteSavedSearch = async (id: string, name: string) => {
    if (!window.confirm(`Excluir a pesquisa “${name}”?`)) return;
    try {
      await deleteSavedFn({ data: { id } });
      await savedSearches.refetch();
      toast.success("Pesquisa excluída.");
    } catch {
      toast.error("Não foi possível excluir a pesquisa agora.");
    }
  };

  const applySavedSearch = (criteria: unknown) => {
    const source = (criteria ?? {}) as Partial<PropertySearchInput>;
    const next: FilterState = {
      city: source.city ?? "",
      state: source.state ?? "",
      propertyType: source.propertyType ?? "",
      minPrice: typeof source.minPrice === "number" ? String(source.minPrice) : "",
      maxPrice: typeof source.maxPrice === "number" ? String(source.maxPrice) : "",
      bedrooms: typeof source.bedrooms === "number" ? String(source.bedrooms) : "",
      bathrooms: typeof source.bathrooms === "number" ? String(source.bathrooms) : "",
      verifiedOnly: Boolean(source.verifiedOnly),
      sort: source.sort ?? "recent",
    };
    setFilters(next);
    setShowSaved(false);
    void runSearch(next);
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-[#07111f] text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#07111f]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2 font-bold tracking-tight">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-400/15 text-cyan-300 ring-1 ring-cyan-300/25">
              <Building2 className="h-5 w-5" />
            </span>
            <span className="text-lg">
              Mercado<span className="text-cyan-300">Imobi</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-7 text-sm text-slate-300 md:flex">
            <button className="font-semibold text-white">Buscar imóveis</button>
            <button
              onClick={() => setShowSaved((value) => !value)}
              className="transition hover:text-white"
            >
              Pesquisas salvas
            </button>
            <button
              onClick={() =>
                document.getElementById("resultados")?.scrollIntoView({ behavior: "smooth" })
              }
              className="transition hover:text-white"
            >
              Favoritos ({favorites.size})
            </button>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              to="/settings/security"
              className="hidden items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/5 sm:flex"
            >
              <UserRound className="h-4 w-4" /> Minha conta
            </Link>
            <button
              onClick={handleLogout}
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-slate-400 transition hover:bg-white/5 hover:text-white"
              title="Sair"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {showSaved && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowSaved(false)}
        >
          <div
            className="ml-auto h-full w-full max-w-md border-l border-white/10 bg-[#0b1727] p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
                  Atalhos
                </p>
                <h2 className="mt-1 text-xl font-bold">Pesquisas salvas</h2>
              </div>
              <button
                onClick={() => setShowSaved(false)}
                className="rounded-lg p-2 text-slate-400 hover:bg-white/5"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              {(savedSearches.data ?? []).map((saved) => (
                <button
                  key={saved.id}
                  onClick={() => applySavedSearch(saved.criteria)}
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-cyan-300/30 hover:bg-cyan-300/[0.04]"
                >
                  <span className="font-semibold">{saved.name}</span>
                  <span className="mt-1 block text-xs text-slate-400">Abrir esta pesquisa</span>
                </button>
              ))}
              {!savedSearches.isLoading && (savedSearches.data?.length ?? 0) === 0 && (
                <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-slate-400">
                  Você ainda não salvou nenhuma pesquisa.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showFavorites && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowFavorites(false)}
        >
          <div
            className="ml-auto h-full w-full max-w-lg overflow-y-auto border-l border-white/10 bg-[#0b1727] p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
                  Sua seleção
                </p>
                <h2 className="mt-1 text-xl font-bold">Imóveis favoritos</h2>
              </div>
              <button
                onClick={() => setShowFavorites(false)}
                className="rounded-lg p-2 text-slate-400 hover:bg-white/5"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              {(favoriteProperties.data ?? []).map(({ key, property }) => (
                <div key={key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-lg font-black text-cyan-100">
                        {formatPrice(property.price)}
                      </p>
                      <h3 className="mt-1 line-clamp-2 font-semibold">{property.title}</h3>
                      <p className="mt-1 text-xs text-slate-400">
                        {[property.location_city, property.location_state]
                          .filter(Boolean)
                          .join(" - ") || "Localização no anúncio"}
                      </p>
                    </div>
                    <button
                      onClick={() => void toggleFavorite(property)}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-rose-300/30 bg-rose-500 text-white"
                      title="Remover dos favoritos"
                    >
                      <Heart className="h-4 w-4 fill-current" />
                    </button>
                  </div>
                  {property.source_url && (
                    <a
                      href={property.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-cyan-200 hover:text-cyan-100"
                    >
                      Ver anúncio original <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              ))}
              {!favoriteProperties.isLoading && (favoriteProperties.data?.length ?? 0) === 0 && (
                <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-slate-400">
                  Você ainda não favoritou nenhum imóvel.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <main>
        <section className="relative overflow-hidden border-b border-white/10">
          <div className="absolute inset-0 opacity-80 [background-image:linear-gradient(rgba(50,220,255,.04)_1px,transparent_1px),linear-gradient(90deg,rgba(50,220,255,.04)_1px,transparent_1px)] [background-size:48px_48px]" />
          <div className="absolute left-[15%] top-[-120px] h-[360px] w-[360px] rounded-full bg-cyan-400/15 blur-[100px]" />
          <div className="absolute right-[8%] top-[30px] h-[300px] w-[300px] rounded-full bg-blue-600/10 blur-[110px]" />

          <div className="relative mx-auto max-w-[1500px] px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
            <div className="max-w-3xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-1.5 text-xs font-semibold text-cyan-200">
                <Sparkles className="h-3.5 w-3.5" /> Pesquisa imobiliária inteligente
              </div>
              <h1 className="text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">
                Encontre o imóvel certo,
                <span className="block bg-gradient-to-r from-cyan-200 to-sky-400 bg-clip-text text-transparent">
                  em menos tempo.
                </span>
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
                Pesquise opções reais, compare características e siga direto para a fonte original
                do anúncio.
              </p>
            </div>

            <div className="mt-9 rounded-[28px] border border-white/10 bg-white/[0.055] p-3 shadow-2xl shadow-cyan-950/30 backdrop-blur-xl sm:p-5">
              <div className="grid gap-3 lg:grid-cols-[1.55fr_.7fr_.8fr_.8fr_auto]">
                <SearchField label="Cidade" icon={<MapPin className="h-4 w-4" />}>
                  <input
                    value={filters.city}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, city: event.target.value }))
                    }
                    placeholder="Ex.: Joinville"
                    className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                  />
                </SearchField>

                <SearchField label="Estado">
                  <select
                    value={filters.state}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, state: event.target.value }))
                    }
                    className="w-full bg-transparent text-sm text-white outline-none"
                  >
                    <option value="" className="bg-[#0b1727]">
                      Todos
                    </option>
                    {STATES.map((state) => (
                      <option key={state} value={state} className="bg-[#0b1727]">
                        {state}
                      </option>
                    ))}
                  </select>
                </SearchField>

                <SearchField label="Tipo" icon={<Home className="h-4 w-4" />}>
                  <select
                    value={filters.propertyType}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, propertyType: event.target.value }))
                    }
                    className="w-full bg-transparent text-sm text-white outline-none"
                  >
                    <option value="" className="bg-[#0b1727]">
                      Todos
                    </option>
                    {PROPERTY_TYPES.map((type) => (
                      <option key={type} value={type} className="bg-[#0b1727]">
                        {type}
                      </option>
                    ))}
                  </select>
                </SearchField>

                <SearchField label="Preço máximo">
                  <input
                    type="number"
                    min="0"
                    value={filters.maxPrice}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, maxPrice: event.target.value }))
                    }
                    placeholder="R$ 800.000"
                    className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                  />
                </SearchField>

                <Button
                  onClick={() => void runSearch()}
                  disabled={loading}
                  className="h-full min-h-16 rounded-2xl bg-cyan-300 px-7 font-bold text-[#06101c] hover:bg-cyan-200"
                >
                  <Search className="mr-2 h-4 w-4" /> {loading ? "Buscando..." : "Buscar imóveis"}
                </Button>
              </div>

              <div className="mt-3 grid gap-3 border-t border-white/10 pt-3 sm:grid-cols-2 lg:grid-cols-6">
                <MiniField
                  label="Preço mínimo"
                  value={filters.minPrice}
                  type="number"
                  onChange={(value) => setFilters((current) => ({ ...current, minPrice: value }))}
                />
                <MiniSelect
                  label="Quartos"
                  value={filters.bedrooms}
                  options={["1", "2", "3", "4", "5"]}
                  onChange={(value) => setFilters((current) => ({ ...current, bedrooms: value }))}
                />
                <MiniSelect
                  label="Banheiros"
                  value={filters.bathrooms}
                  options={["1", "2", "3", "4"]}
                  onChange={(value) => setFilters((current) => ({ ...current, bathrooms: value }))}
                />
                <MiniSelect
                  label="Ordenar"
                  value={filters.sort}
                  options={[
                    ["recent", "Mais recentes"],
                    ["price_asc", "Menor preço"],
                    ["price_desc", "Maior preço"],
                  ]}
                  onChange={(value) =>
                    setFilters((current) => ({ ...current, sort: value as FilterState["sort"] }))
                  }
                />
                <label className="flex min-h-12 items-center gap-3 rounded-xl border border-white/10 bg-black/10 px-3 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={filters.verifiedOnly}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, verifiedOnly: event.target.checked }))
                    }
                    className="h-4 w-4 accent-cyan-300"
                  />
                  Verificados
                </label>
                <button
                  onClick={() => void handleSaveSearch()}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/10 px-3 text-sm font-semibold text-slate-200 transition hover:border-cyan-300/30 hover:bg-cyan-300/[0.05]"
                >
                  <Bookmark className="h-4 w-4" /> Salvar pesquisa
                </button>
              </div>
            </div>
          </div>
        </section>

        <section id="resultados" className="mx-auto max-w-[1500px] px-4 py-10 sm:px-6 lg:px-8">
          <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
                <SlidersHorizontal className="h-3.5 w-3.5" /> Resultado da pesquisa
              </div>
              <h2 className="mt-2 text-2xl font-bold sm:text-3xl">
                {loading
                  ? "Atualizando imóveis..."
                  : `${results.length} ${results.length === 1 ? "imóvel encontrado" : "imóveis encontrados"}`}
              </h2>
              {lastUpdatedAt && !loading && (
                <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-400">
                  <Clock3 className="h-3.5 w-3.5" /> Última atualização disponível{" "}
                  {formatRelative(lastUpdatedAt)}
                </p>
              )}
            </div>
            {compareIds.length > 0 && (
              <button
                onClick={() => setShowCompare(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-300/[0.07] px-4 py-2.5 text-sm font-semibold text-cyan-100"
              >
                <Scale className="h-4 w-4" /> Comparar ({compareIds.length}/3)
              </button>
            )}
          </div>

          {searchError && (
            <div className="rounded-3xl border border-amber-300/20 bg-amber-300/[0.05] px-6 py-8 text-center">
              <p className="font-semibold text-amber-100">
                Não foi possível atualizar os resultados agora.
              </p>
              <p className="mt-1 text-sm text-slate-400">Tente novamente em instantes.</p>
            </div>
          )}

          {loading && <PropertySkeletonGrid />}

          {!loading && !searchError && hasSearched && results.length === 0 && (
            <div className="rounded-[32px] border border-dashed border-white/15 bg-white/[0.025] px-6 py-16 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-cyan-300/[0.08] text-cyan-200">
                <Search className="h-7 w-7" />
              </div>
              <h3 className="mt-5 text-xl font-bold">
                Nenhum imóvel encontrado para estes filtros.
              </h3>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-slate-400">
                Tente ampliar a região, faixa de preço ou quantidade de quartos para encontrar mais
                opções.
              </p>
              <button
                onClick={() => {
                  setFilters(initialFilters);
                  void runSearch(initialFilters);
                }}
                className="mt-6 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5"
              >
                Limpar filtros
              </button>
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {results.map((property) => (
                <PropertyCard
                  key={property.id}
                  property={property}
                  favorite={favorites.has(property.id)}
                  comparing={compareIds.includes(property.id)}
                  onFavorite={() => toggleFavorite(property.id)}
                  onCompare={() => toggleCompare(property.id)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {showCompare && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-4 backdrop-blur-md sm:p-8">
          <div className="mx-auto max-w-6xl rounded-[30px] border border-white/10 bg-[#0b1727] p-5 shadow-2xl sm:p-8">
            <div className="mb-7 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
                  Comparação
                </p>
                <h2 className="mt-1 text-2xl font-bold">Compare seus imóveis favoritos</h2>
              </div>
              <button
                onClick={() => setShowCompare(false)}
                className="rounded-xl border border-white/10 p-2.5 text-slate-300 hover:bg-white/5"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {comparedProperties.map((property) => (
                <CompareCard key={property.id} property={property} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SearchField({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-h-16 flex-col justify-center rounded-2xl border border-white/10 bg-black/15 px-4 transition focus-within:border-cyan-300/35 focus-within:bg-cyan-300/[0.03]">
      <span className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
        {icon} {label}
      </span>
      {children}
    </label>
  );
}

function MiniField({
  label,
  value,
  type,
  onChange,
}: {
  label: string;
  value: string;
  type: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">
      <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </span>
      <input
        type={type}
        min="0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full bg-transparent text-sm text-white outline-none"
      />
    </label>
  );
}

function MiniSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<string | [string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">
      <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full bg-transparent text-sm text-white outline-none"
      >
        <option value="" className="bg-[#0b1727]">
          Qualquer
        </option>
        {options.map((option) => {
          const [optionValue, optionLabel] = Array.isArray(option)
            ? option
            : [option, `${option}+`];
          return (
            <option key={optionValue} value={optionValue} className="bg-[#0b1727]">
              {optionLabel}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function PropertyCard({
  property,
  favorite,
  comparing,
  onFavorite,
  onCompare,
}: {
  property: PropertySearchItem;
  favorite: boolean;
  comparing: boolean;
  onFavorite: () => void;
  onCompare: () => void;
}) {
  const image = property.images?.find(Boolean) ?? null;
  return (
    <Card className="group overflow-hidden rounded-[26px] border-white/10 bg-white/[0.045] text-white shadow-xl shadow-black/10 transition duration-300 hover:-translate-y-1 hover:border-cyan-300/20 hover:bg-white/[0.06]">
      <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-slate-800 to-slate-950">
        {image ? (
          <img
            src={image}
            alt={property.title}
            loading="lazy"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
            <Building2 className="h-10 w-10" />
            <span className="text-xs">Imagem indisponível</span>
          </div>
        )}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3">
          <div className="flex gap-2">
            {property.is_verified && (
              <Badge className="border border-emerald-300/30 bg-emerald-950/75 text-emerald-200 backdrop-blur-md">
                <ShieldCheck className="mr-1 h-3 w-3" /> Verificado
              </Badge>
            )}
            {property.source_portal && (
              <Badge className="border border-white/15 bg-slate-950/70 text-slate-200 backdrop-blur-md">
                {property.source_portal}
              </Badge>
            )}
          </div>
          <button
            onClick={onFavorite}
            className={`grid h-10 w-10 place-items-center rounded-full border backdrop-blur-md transition ${favorite ? "border-rose-300/30 bg-rose-500 text-white" : "border-white/15 bg-slate-950/60 text-white hover:bg-slate-900"}`}
            title={favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
          >
            <Heart className={`h-4 w-4 ${favorite ? "fill-current" : ""}`} />
          </button>
        </div>
      </div>

      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-2xl font-black tracking-tight">{formatPrice(property.price)}</p>
            <h3 className="mt-2 line-clamp-2 text-base font-bold leading-snug text-slate-100">
              {property.title}
            </h3>
          </div>
        </div>

        <p className="mt-3 flex min-h-5 items-center gap-1.5 text-sm text-slate-400">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
          {[property.location_city, property.location_state].filter(Boolean).join(" - ") ||
            property.location_address ||
            "Localização no anúncio"}
        </p>

        <div className="mt-4 flex flex-wrap gap-2 border-y border-white/10 py-3 text-xs text-slate-300">
          {property.bedrooms != null && (
            <Feature
              icon={<BedDouble className="h-3.5 w-3.5" />}
              text={`${property.bedrooms} qtos`}
            />
          )}
          {property.bathrooms != null && (
            <Feature icon={<Bath className="h-3.5 w-3.5" />} text={`${property.bathrooms} banh.`} />
          )}
          {property.area_sqm != null && (
            <Feature icon={<Ruler className="h-3.5 w-3.5" />} text={`${property.area_sqm} m²`} />
          )}
          {property.property_type && (
            <Feature icon={<Home className="h-3.5 w-3.5" />} text={property.property_type} />
          )}
        </div>

        {property.updated_at && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
            <Clock3 className="h-3.5 w-3.5" /> Atualizado {formatRelative(property.updated_at)}
          </p>
        )}

        <div className="mt-5 grid grid-cols-[auto_1fr] gap-2">
          <button
            onClick={onCompare}
            className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition ${comparing ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100" : "border-white/10 text-slate-300 hover:bg-white/5"}`}
          >
            {comparing ? <Check className="h-4 w-4" /> : <Scale className="h-4 w-4" />}
            {comparing ? "Selecionado" : "Comparar"}
          </button>
          {property.source_url ? (
            <a
              href={property.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-bold text-[#06101c] transition hover:bg-cyan-200"
            >
              Ver anúncio original <ExternalLink className="h-4 w-4" />
            </a>
          ) : (
            <button
              disabled
              className="h-11 rounded-xl bg-white/5 text-sm font-semibold text-slate-500"
            >
              Fonte indisponível
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Feature({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-2.5 py-1.5">
      {icon}
      {text}
    </span>
  );
}

function CompareCard({ property }: { property: PropertySearchItem }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
      <h3 className="line-clamp-2 font-bold">{property.title}</h3>
      <p className="mt-3 text-2xl font-black text-cyan-200">{formatPrice(property.price)}</p>
      <div className="mt-5 space-y-3 text-sm text-slate-300">
        <CompareLine
          label="Local"
          value={
            [property.location_city, property.location_state].filter(Boolean).join(" - ") || "—"
          }
        />
        <CompareLine label="Tipo" value={property.property_type ?? "—"} />
        <CompareLine
          label="Quartos"
          value={property.bedrooms != null ? String(property.bedrooms) : "—"}
        />
        <CompareLine
          label="Banheiros"
          value={property.bathrooms != null ? String(property.bathrooms) : "—"}
        />
        <CompareLine
          label="Área"
          value={property.area_sqm != null ? `${property.area_sqm} m²` : "—"}
        />
      </div>
      {property.source_url && (
        <a
          href={property.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-bold text-[#06101c]"
        >
          Ver anúncio <ExternalLink className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}

function CompareLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-white/10 pb-2">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-semibold">{value}</span>
    </div>
  );
}

function PropertySkeletonGrid() {
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.035]"
        >
          <div className="aspect-[16/10] animate-pulse bg-white/[0.06]" />
          <div className="space-y-3 p-5">
            <div className="h-7 w-1/3 animate-pulse rounded bg-white/[0.08]" />
            <div className="h-4 w-4/5 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-white/[0.05]" />
            <div className="h-11 animate-pulse rounded-xl bg-white/[0.05]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function formatPrice(value: number | null) {
  if (value == null) return "Preço no anúncio";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatRelative(iso: string) {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "recentemente";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "agora";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} d`;
}
