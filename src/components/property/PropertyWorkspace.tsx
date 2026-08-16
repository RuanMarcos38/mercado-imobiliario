import { useEffect, useMemo, useState } from "react";
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
  RefreshCw,
  Ruler,
  Scale,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { startWhatsAppConversation } from "@/lib/whatsapp-conversation.functions";

const STATES = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];
const PROPERTY_TYPES = ["Apartamento","Casa","Terreno","Sobrado","Cobertura","Studio","Comercial","Rural"];

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
  city: "", neighborhood: "", state: "", propertyType: "", minPrice: "", maxPrice: "",
  bedrooms: "", bathrooms: "", minArea: "", maxArea: "", sort: "recent", market,
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
    const channel = supabase
      .channel("property-workspace-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "property_search_index" }, () => void searchQuery.refetch())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  const results = searchQuery.data?.items ?? [];
  const comparedKeys = useMemo(() => new Set(compare.map(propertyKey)), [compare]);

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
      if (current.some((item) => propertyKey(item) === key)) return current.filter((item) => propertyKey(item) !== key);
      if (current.length >= 3) { toast.info("Selecione no máximo 3 imóveis."); return current; }
      return [...current, property];
    });
  };

  const openWhatsApp = async (property: PropertySearchItem) => {
    if (!property.contact_whatsapp) return;
    try {
      const conversation = await startConversationFn({ data: { phone: property.contact_whatsapp, contactName: property.contact_name || undefined } });
      sessionStorage.setItem("mercadoimobi:selectedConversation", conversation.id);
      sessionStorage.setItem("mercadoimobi:propertyContext", JSON.stringify({ id: property.id, title: property.title, url: property.source_url }));
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
    } catch { toast.error("Não foi possível salvar a pesquisa."); }
  };

  const createAlertFromSearch = () => {
    sessionStorage.setItem("mercadoimobi:alertCriteria", JSON.stringify(toInput(filters)));
    void navigate({ to: "/alertas" });
  };

  return (
    <div className="min-h-screen bg-[#06101c] text-white">
      <section className="border-b border-white/10 bg-[#081421]">
        <div className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">Mercado imobiliário nacional</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Busca e monitoramento de imóveis</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Imóveis de fontes conectadas, oportunidades CAIXA separadas por modalidade, contatos disponíveis e atualização automática.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setSavedOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 px-3 text-sm font-semibold text-slate-300 hover:bg-white/5"><Bookmark className="h-4 w-4" /> Pesquisas salvas</button>
              <button onClick={() => setFavoritesOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 px-3 text-sm font-semibold text-slate-300 hover:bg-white/5"><Heart className="h-4 w-4" /> Favoritos</button>
              <button onClick={() => void searchQuery.refetch()} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-slate-400 hover:bg-white/5" title="Atualizar"><RefreshCw className={`h-4 w-4 ${searchQuery.isFetching ? "animate-spin" : ""}`} /></button>
            </div>
          </div>

          <div className="mt-7 flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-black/15 p-2">
            <MarketTab label="Todos" active={filters.market === "all"} onClick={() => changeMarket("all")} />
            <MarketTab label="Mercado" active={filters.market === "market"} onClick={() => changeMarket("market")} />
            <MarketTab label="CAIXA" active={filters.market === "caixa"} onClick={() => changeMarket("caixa")} />
            <MarketTab label="Leilões CAIXA" icon={<Gavel className="h-4 w-4" />} active={filters.market === "auction"} onClick={() => changeMarket("auction")} />
          </div>

          <div className="mt-4 grid gap-3 rounded-[26px] border border-white/10 bg-white/[0.04] p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <Field label="Cidade"><input value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })} placeholder="Ex.: Joinville" /></Field>
            <Field label="Bairro"><input value={filters.neighborhood} onChange={(e) => setFilters({ ...filters, neighborhood: e.target.value })} placeholder="Ex.: Centro" /></Field>
            <Field label="Estado"><select value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })}><option value="">Todos</option>{STATES.map((state) => <option key={state} value={state}>{state}</option>)}</select></Field>
            <Field label="Tipo"><select value={filters.propertyType} onChange={(e) => setFilters({ ...filters, propertyType: e.target.value })}><option value="">Todos</option>{PROPERTY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></Field>
            <Field label="Preço mínimo"><input type="number" min="0" value={filters.minPrice} onChange={(e) => setFilters({ ...filters, minPrice: e.target.value })} /></Field>
            <Field label="Preço máximo"><input type="number" min="0" value={filters.maxPrice} onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })} /></Field>
            <Field label="Quartos"><input type="number" min="0" value={filters.bedrooms} onChange={(e) => setFilters({ ...filters, bedrooms: e.target.value })} /></Field>
            <Field label="Banheiros"><input type="number" min="0" value={filters.bathrooms} onChange={(e) => setFilters({ ...filters, bathrooms: e.target.value })} /></Field>
            <Field label="Área mínima"><input type="number" min="0" value={filters.minArea} onChange={(e) => setFilters({ ...filters, minArea: e.target.value })} /></Field>
            <Field label="Área máxima"><input type="number" min="0" value={filters.maxArea} onChange={(e) => setFilters({ ...filters, maxArea: e.target.value })} /></Field>
            <Field label="Ordenar"><select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value as SortValue })}><option value="recent">Mais recentes</option><option value="price_asc">Menor preço</option><option value="price_desc">Maior preço</option><option value="area_desc">Maior área</option></select></Field>
            <div className="flex items-end"><Button onClick={() => setApplied({ ...filters })} className="h-12 w-full rounded-xl bg-cyan-300 font-black text-[#06101c] hover:bg-cyan-200"><Search className="mr-2 h-4 w-4" /> Buscar</Button></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={clear} className="h-10 rounded-xl border border-white/10 px-4 text-sm font-semibold text-slate-400 hover:bg-white/5">Limpar filtros</button>
            <button onClick={() => void saveSearch()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 px-4 text-sm font-semibold text-slate-300 hover:bg-white/5"><Bookmark className="h-4 w-4" /> Salvar pesquisa</button>
            <button onClick={createAlertFromSearch} className="inline-flex h-10 items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.04] px-4 text-sm font-semibold text-amber-100 hover:bg-amber-300/[0.08]"><Bell className="h-4 w-4" /> Criar alerta para novos anúncios</button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300">Resultados</p><h2 className="mt-1 text-2xl font-black">{searchQuery.isLoading ? "Carregando..." : `${results.length} imóveis nesta página`}</h2></div>
          {compare.length > 0 && <button onClick={() => setCompareOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-300/[0.07] px-4 text-sm font-bold text-cyan-100"><Scale className="h-4 w-4" /> Comparar ({compare.length}/3)</button>}
        </div>

        {searchQuery.isError && <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.05] p-6 text-center text-amber-100">Não foi possível atualizar os imóveis agora.</div>}
        {searchQuery.isLoading && <Skeletons />}
        {!searchQuery.isLoading && !searchQuery.isError && results.length === 0 && <div className="rounded-3xl border border-dashed border-white/15 p-12 text-center text-slate-400">Nenhum imóvel encontrado para estes filtros. As fontes de mercado aparecem aqui conforme forem autorizadas e conectadas.</div>}
        {!searchQuery.isLoading && results.length > 0 && (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {results.map((property) => <PropertyCard key={property.id} property={property} favorite={favoriteKeys.has(propertyKey(property))} comparing={comparedKeys.has(propertyKey(property))} onFavorite={() => void toggleFavorite(property)} onCompare={() => toggleCompare(property)} onOpen={() => setSelected(property)} onWhatsApp={() => void openWhatsApp(property)} />)}
          </div>
        )}
      </section>

      {selected && <PropertyModal property={selected} onClose={() => setSelected(null)} onWhatsApp={() => void openWhatsApp(selected)} />}
      {compareOpen && <CompareModal properties={compare} onClose={() => setCompareOpen(false)} onRemove={toggleCompare} />}
      <Drawer open={savedOpen} onClose={() => setSavedOpen(false)} title="Pesquisas salvas">
        {(savedQuery.data ?? []).map((saved) => <div key={saved.id} className="mb-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4"><button className="w-full text-left" onClick={() => { const criteria = saved.criteria as Partial<PropertySearchInput>; const next = { ...filters, city: criteria.city ?? "", neighborhood: criteria.neighborhood ?? "", state: criteria.state ?? "", propertyType: criteria.propertyType ?? "", minPrice: criteria.minPrice != null ? String(criteria.minPrice) : "", maxPrice: criteria.maxPrice != null ? String(criteria.maxPrice) : "", bedrooms: criteria.bedrooms != null ? String(criteria.bedrooms) : "", bathrooms: criteria.bathrooms != null ? String(criteria.bathrooms) : "", minArea: criteria.minArea != null ? String(criteria.minArea) : "", maxArea: criteria.maxArea != null ? String(criteria.maxArea) : "", sort: criteria.sort ?? "recent", market: criteria.market ?? "all" } as Filters; setFilters(next); setApplied(next); setSavedOpen(false); }}><p className="font-bold">{saved.name}</p><p className="mt-1 text-xs text-slate-500">Aplicar esta pesquisa</p></button><div className="mt-3 flex gap-2 border-t border-white/10 pt-3"><button onClick={async () => { const name = window.prompt("Novo nome:", saved.name); if (name?.trim()) { await renameFn({ data: { id: saved.id, name: name.trim() } }); await savedQuery.refetch(); } }} className="text-xs font-semibold text-slate-300">Renomear</button><button onClick={async () => { if (window.confirm("Excluir esta pesquisa?")) { await deleteFn({ data: { id: saved.id } }); await savedQuery.refetch(); } }} className="text-xs font-semibold text-rose-300">Excluir</button></div></div>)}
      </Drawer>
      <Drawer open={favoritesOpen} onClose={() => setFavoritesOpen(false)} title="Favoritos">
        {(favoritesQuery.data ?? []).map(({ key, property, available }) => <div key={key} className="mb-3 rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-cyan-100">{formatPrice(property.price)}</p><p className="mt-1 text-sm font-semibold">{property.title}</p>{!available && <Badge className="mt-2 bg-amber-300/10 text-amber-100">Anúncio indisponível</Badge>}</div><button onClick={() => void toggleFavorite(property)} className="text-rose-300"><Heart className="h-4 w-4 fill-current" /></button></div></div>)}
      </Drawer>
    </div>
  );
}

function MarketTab({ label, active, onClick, icon }: { label: string; active: boolean; onClick: () => void; icon?: React.ReactNode }) { return <button onClick={onClick} className={`inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-bold transition ${active ? "bg-cyan-300 text-[#06101c]" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}>{icon}{label}</button>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</span><div className="flex h-12 items-center rounded-xl border border-white/10 bg-black/15 px-3 [&_input]:w-full [&_input]:bg-transparent [&_input]:text-sm [&_input]:text-white [&_input]:outline-none [&_input]:placeholder:text-slate-600 [&_select]:w-full [&_select]:bg-transparent [&_select]:text-sm [&_select]:text-white [&_select]:outline-none [&_option]:bg-[#0b1727]">{children}</div></label>; }

function PropertyCard({ property, favorite, comparing, onFavorite, onCompare, onOpen, onWhatsApp }: { property: PropertySearchItem; favorite: boolean; comparing: boolean; onFavorite: () => void; onCompare: () => void; onOpen: () => void; onWhatsApp: () => void }) {
  return <Card className="group overflow-hidden rounded-[24px] border-white/10 bg-white/[0.045] text-white shadow-xl shadow-black/10 transition hover:-translate-y-1 hover:border-cyan-300/20"><div className="relative aspect-[16/10] overflow-hidden bg-[#0b1727]"><PropertyImage property={property} /><div className="absolute inset-x-0 top-0 flex items-start justify-between p-3"><div className="flex flex-wrap gap-2">{property.is_auction && <Badge className="border border-amber-300/30 bg-amber-950/80 text-amber-100"><Gavel className="mr-1 h-3 w-3" /> Leilão</Badge>}{property.listing_market === "caixa" && <Badge className="border border-blue-300/25 bg-blue-950/80 text-blue-100">CAIXA</Badge>}{property.is_verified && <Badge className="border border-emerald-300/25 bg-emerald-950/80 text-emerald-100"><ShieldCheck className="mr-1 h-3 w-3" /> Verificado</Badge>}</div><button onClick={onFavorite} className={`grid h-10 w-10 place-items-center rounded-full border backdrop-blur ${favorite ? "border-rose-300/30 bg-rose-500" : "border-white/15 bg-black/60"}`}><Heart className={`h-4 w-4 ${favorite ? "fill-current" : ""}`} /></button></div></div><CardContent className="p-5"><p className="text-2xl font-black text-cyan-50">{formatPrice(property.price)}</p><h3 className="mt-2 line-clamp-2 min-h-11 font-bold">{property.title}</h3><p className="mt-3 flex items-center gap-1.5 text-sm text-slate-400"><MapPin className="h-3.5 w-3.5 text-cyan-300" /> {[property.location_city,property.location_state].filter(Boolean).join(" - ") || "Localização no anúncio"}</p>{property.sale_mode && <p className="mt-2 text-xs font-semibold text-amber-100/80">Modalidade: {property.sale_mode}</p>}<div className="mt-4 flex flex-wrap gap-2 border-y border-white/10 py-3 text-xs text-slate-300">{property.bedrooms != null && <Feature icon={<BedDouble className="h-3.5 w-3.5" />} text={`${property.bedrooms} qtos`} />}{property.bathrooms != null && <Feature icon={<Bath className="h-3.5 w-3.5" />} text={`${property.bathrooms} banh.`} />}{property.area_sqm != null && <Feature icon={<Ruler className="h-3.5 w-3.5" />} text={`${property.area_sqm} m²`} />}</div>{(property.contact_name || property.contact_phone || property.contact_email) && <div className="mt-3 rounded-xl bg-black/15 p-3 text-xs text-slate-400"><p className="font-bold text-slate-200">Contato do anúncio</p>{property.contact_name && <p className="mt-1">{property.contact_name}</p>}{property.contact_phone && <p>{property.contact_phone}</p>}{property.contact_email && <p className="truncate">{property.contact_email}</p>}</div>}<div className="mt-4 grid grid-cols-2 gap-2"><button onClick={onOpen} className="h-10 rounded-xl border border-white/10 text-sm font-semibold text-slate-200 hover:bg-white/5">Detalhes</button><button onClick={onCompare} className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl border text-sm font-semibold ${comparing ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100" : "border-white/10 text-slate-300"}`}>{comparing ? <Check className="h-4 w-4" /> : <Scale className="h-4 w-4" />}{comparing ? "Selecionado" : "Comparar"}</button>{property.contact_whatsapp && <button onClick={onWhatsApp} className="col-span-2 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-400/15 text-sm font-black text-emerald-100 ring-1 ring-emerald-300/20"><MessageCircle className="h-4 w-4" /> Conversar no Atendimento</button>}{property.source_url && <a href={property.source_url} target="_blank" rel="noopener noreferrer" className="col-span-2 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-cyan-300 text-sm font-black text-[#06101c]">Ver anúncio <ExternalLink className="h-4 w-4" /></a>}</div></CardContent></Card>;
}

function PropertyImage({ property }: { property: PropertySearchItem }) { const [failed,setFailed]=useState(false);const image=property.images?.find(Boolean);return image&&!failed?<img src={image} alt={property.title} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]" />:<div className="flex h-full flex-col items-center justify-center bg-gradient-to-br from-[#102238] to-[#07111f] text-slate-500"><Building2 className="h-9 w-9" /><span className="mt-2 text-xs">Imagem indisponível</span></div>; }
function Feature({ icon,text }: { icon: React.ReactNode;text:string }) { return <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-2.5 py-1.5">{icon}{text}</span>; }
function Skeletons() { return <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{Array.from({length:8}).map((_,i)=><div key={i} className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035]"><div className="aspect-[16/10] animate-pulse bg-white/[0.06]" /><div className="space-y-3 p-5"><div className="h-7 w-1/3 animate-pulse rounded bg-white/[0.08]"/><div className="h-4 w-4/5 animate-pulse rounded bg-white/[0.06]"/><div className="h-10 animate-pulse rounded bg-white/[0.05]"/></div></div>)}</div>; }
function formatPrice(value:number|null){return value==null?"Preço no anúncio":new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0}).format(value);}

function Drawer({ open,onClose,title,children }: { open:boolean;onClose:()=>void;title:string;children:React.ReactNode }) { if(!open)return null;return <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-sm" onClick={onClose}><div className="ml-auto h-full w-full max-w-lg overflow-y-auto border-l border-white/10 bg-[#0b1727] p-6 text-white" onClick={(e)=>e.stopPropagation()}><div className="mb-6 flex items-center justify-between"><h2 className="text-xl font-black">{title}</h2><button onClick={onClose} className="rounded-xl border border-white/10 p-2"><X className="h-4 w-4"/></button></div>{children}</div></div>; }
function PropertyModal({ property,onClose,onWhatsApp }: { property:PropertySearchItem;onClose:()=>void;onWhatsApp:()=>void }) { return <div className="fixed inset-0 z-[90] overflow-y-auto bg-black/75 p-4 backdrop-blur-md" onClick={onClose}><div className="mx-auto max-w-4xl rounded-[28px] border border-white/10 bg-[#0b1727] p-6 text-white" onClick={(e)=>e.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><p className="text-3xl font-black text-cyan-100">{formatPrice(property.price)}</p><h2 className="mt-2 text-2xl font-black">{property.title}</h2></div><button onClick={onClose} className="rounded-xl border border-white/10 p-2"><X className="h-4 w-4"/></button></div><div className="mt-6 aspect-[16/8] overflow-hidden rounded-2xl"><PropertyImage property={property}/></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-white/10 p-4"><p className="text-xs text-slate-500">Origem</p><p className="mt-1 font-bold">{property.source_portal || "Fonte conectada"}</p></div><div className="rounded-xl border border-white/10 p-4"><p className="text-xs text-slate-500">Modalidade</p><p className="mt-1 font-bold">{property.sale_mode || (property.is_auction?"Leilão":"Venda")}</p></div></div>{property.description&&<p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-slate-300">{property.description}</p>}<div className="mt-6 flex flex-wrap gap-2">{property.contact_whatsapp&&<button onClick={onWhatsApp} className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-400/15 px-4 font-bold text-emerald-100"><MessageCircle className="h-4 w-4"/>Abrir atendimento</button>}{property.contact_email&&<a href={`mailto:${property.contact_email}`} className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/10 px-4 font-bold text-slate-200"><Mail className="h-4 w-4"/>E-mail</a>}{property.source_url&&<a href={property.source_url} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-xl bg-cyan-300 px-4 font-black text-[#06101c]">Ver anúncio<ExternalLink className="h-4 w-4"/></a>}</div></div></div>; }
function CompareModal({ properties,onClose,onRemove }: { properties:PropertySearchItem[];onClose:()=>void;onRemove:(property:PropertySearchItem)=>void }) { return <div className="fixed inset-0 z-[90] overflow-y-auto bg-black/75 p-4 backdrop-blur-md" onClick={onClose}><div className="mx-auto max-w-6xl rounded-[28px] border border-white/10 bg-[#0b1727] p-6 text-white" onClick={(e)=>e.stopPropagation()}><div className="mb-6 flex justify-between"><h2 className="text-2xl font-black">Comparar imóveis</h2><button onClick={onClose}><X className="h-5 w-5"/></button></div><div className="grid gap-4 md:grid-cols-3">{properties.map((p)=><div key={propertyKey(p)} className="rounded-2xl border border-white/10 p-4"><p className="font-black text-cyan-100">{formatPrice(p.price)}</p><p className="mt-2 font-bold">{p.title}</p><div className="mt-4 space-y-2 text-sm text-slate-400"><p>{p.property_type||"—"}</p><p>{p.bedrooms??"—"} quartos · {p.bathrooms??"—"} banheiros</p><p>{p.area_sqm!=null?`${p.area_sqm} m²`:"Área não informada"}</p><p>{p.sale_mode||"Venda"}</p></div><button onClick={()=>onRemove(p)} className="mt-4 w-full rounded-xl border border-white/10 py-2 text-sm font-semibold">Remover</button></div>)}</div></div></div>; }
