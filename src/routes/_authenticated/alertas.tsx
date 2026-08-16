import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, CheckCircle2, ExternalLink, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  createPropertyAlertRule,
  deletePropertyAlertRule,
  listPropertyAlertEvents,
  listPropertyAlertRules,
  markPropertyAlertRead,
  togglePropertyAlertRule,
} from "@/lib/property-alerts.functions";

export const Route = createFileRoute("/_authenticated/alertas")({
  component: AlertsPage,
  head: () => ({ title: "Alertas de imóveis | MercadoImobi" }),
});

function AlertsPage() {
  const listRulesFn = useServerFn(listPropertyAlertRules);
  const listEventsFn = useServerFn(listPropertyAlertEvents);
  const createRuleFn = useServerFn(createPropertyAlertRule);
  const toggleRuleFn = useServerFn(togglePropertyAlertRule);
  const deleteRuleFn = useServerFn(deletePropertyAlertRule);
  const markReadFn = useServerFn(markPropertyAlertRead);

  const [name, setName] = useState("Novos imóveis do meu perfil");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [market, setMarket] = useState<"" | "market" | "caixa">("");
  const [auctionOnly, setAuctionOnly] = useState(false);
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState(false);

  const rules = useQuery({ queryKey: ["property-alert-rules"], queryFn: () => listRulesFn() });
  const events = useQuery({
    queryKey: ["property-alert-events"],
    queryFn: () => listEventsFn(),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const raw = sessionStorage.getItem("mercadoimobi:alertCriteria");
    if (!raw) return;
    sessionStorage.removeItem("mercadoimobi:alertCriteria");
    try {
      const criteria = JSON.parse(raw) as Record<string, unknown>;
      setCity(typeof criteria.city === "string" ? criteria.city : "");
      setState(typeof criteria.state === "string" ? criteria.state : "");
      setPropertyType(typeof criteria.propertyType === "string" ? criteria.propertyType : "");
      setMinPrice(typeof criteria.minPrice === "number" ? String(criteria.minPrice) : "");
      setMaxPrice(typeof criteria.maxPrice === "number" ? String(criteria.maxPrice) : "");
      if (criteria.market === "caixa") setMarket("caixa");
      if (criteria.market === "market") setMarket("market");
      if (criteria.market === "auction") {
        setMarket("caixa");
        setAuctionOnly(true);
      }
    } catch {
      // Critério antigo inválido é ignorado sem quebrar a tela.
    }
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("property-alert-events-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "property_alert_events" },
        () => void events.refetch(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const unread = useMemo(
    () => (events.data ?? []).filter((event: any) => !event.read_at).length,
    [events.data],
  );

  const create = async () => {
    if (!name.trim()) return;
    try {
      await createRuleFn({
        data: {
          name: name.trim(),
          criteria: {
            city: city || undefined,
            state: state || undefined,
            propertyType: propertyType || undefined,
            minPrice: minPrice ? Number(minPrice) : undefined,
            maxPrice: maxPrice ? Number(maxPrice) : undefined,
            market: market || undefined,
            auctionOnly,
          },
          notifyWhatsapp,
          notifyEmail,
        },
      });
      await rules.refetch();
      toast.success("Alerta criado. Novos anúncios compatíveis aparecerão aqui.");
    } catch {
      toast.error("Não foi possível criar o alerta.");
    }
  };

  return (
    <div className="min-h-screen bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1500px]">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">
              Monitoramento
            </p>
            <h1 className="mt-2 text-3xl font-black">Alertas de novos imóveis</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--mi-text-muted)]">
              Crie perfis de busca. Quando um novo anúncio compatível entrar no índice, ele é
              registrado automaticamente no seu painel.
            </p>
          </div>
          <div className="rounded-2xl border border-blue-500/20 bg-blue-600/[0.05] px-4 py-3">
            <span className="text-xs text-[var(--mi-text-muted)]">Não lidos</span>
            <p className="text-2xl font-black text-blue-600">{unread}</p>
          </div>
        </div>

        <div className="mt-7 grid gap-6 xl:grid-cols-[420px_1fr]">
          <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-blue-600" />
              <h2 className="font-black">Novo alerta</h2>
            </div>
            <div className="mt-5 space-y-3">
              <Field label="Nome">
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Cidade">
                  <input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Joinville"
                  />
                </Field>
                <Field label="UF">
                  <input
                    value={state}
                    maxLength={2}
                    onChange={(e) => setState(e.target.value.toUpperCase())}
                    placeholder="SC"
                  />
                </Field>
              </div>
              <Field label="Tipo de imóvel">
                <input
                  value={propertyType}
                  onChange={(e) => setPropertyType(e.target.value)}
                  placeholder="Apartamento"
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Preço mínimo">
                  <input
                    type="number"
                    min="0"
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                  />
                </Field>
                <Field label="Preço máximo">
                  <input
                    type="number"
                    min="0"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Origem">
                <select
                  value={market}
                  onChange={(e) => setMarket(e.target.value as "" | "market" | "caixa")}
                >
                  <option value="">Todas as fontes</option>
                  <option value="market">Mercado</option>
                  <option value="caixa">CAIXA</option>
                </select>
              </Field>
              <label className="flex items-center gap-3 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-3 text-sm text-[var(--mi-text-muted)]">
                <input
                  type="checkbox"
                  checked={auctionOnly}
                  onChange={(e) => setAuctionOnly(e.target.checked)}
                />{" "}
                Somente leilões
              </label>
              <div className="rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-3">
                <p className="mb-2 text-xs font-bold text-[var(--mi-text-muted)]">
                  Notificações adicionais
                </p>
                <label className="flex items-center gap-2 text-sm text-[var(--mi-text-muted)]">
                  <input
                    type="checkbox"
                    checked={notifyWhatsapp}
                    onChange={(e) => setNotifyWhatsapp(e.target.checked)}
                  />{" "}
                  WhatsApp quando conectado
                </label>
                <label className="mt-2 flex items-center gap-2 text-sm text-[var(--mi-text-muted)]">
                  <input
                    type="checkbox"
                    checked={notifyEmail}
                    onChange={(e) => setNotifyEmail(e.target.checked)}
                  />{" "}
                  E-mail quando configurado
                </label>
              </div>
              <Button
                onClick={() => void create()}
                className="h-11 w-full rounded-xl bg-blue-600 font-black text-white hover:bg-blue-700"
              >
                <Bell className="mr-2 h-4 w-4" /> Criar alerta
              </Button>
            </div>
          </section>

          <div className="space-y-6">
            <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
              <h2 className="font-black">Alertas ativos</h2>
              <div className="mt-4 space-y-3">
                {(rules.data ?? []).map((rule: any) => (
                  <div
                    key={rule.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-4"
                  >
                    <div>
                      <p className="font-bold">{rule.name}</p>
                      <p className="mt-1 text-xs text-[var(--mi-text-soft)]">
                        {describeCriteria(rule.criteria)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          await toggleRuleFn({ data: { id: rule.id, active: !rule.active } });
                          await rules.refetch();
                        }}
                        className={`rounded-xl px-3 py-2 text-xs font-bold ${rule.active ? "bg-emerald-400/10 text-emerald-200" : "bg-white/5 text-[var(--mi-text-soft)]"}`}
                      >
                        {rule.active ? "Ativo" : "Pausado"}
                      </button>
                      <button
                        onClick={async () => {
                          if (window.confirm("Excluir este alerta?")) {
                            await deleteRuleFn({ data: { id: rule.id } });
                            await rules.refetch();
                          }
                        }}
                        className="grid h-9 w-9 place-items-center rounded-xl border border-rose-300/10 text-rose-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
                {!rules.isLoading && (rules.data?.length ?? 0) === 0 && (
                  <Empty>Nenhum alerta criado ainda.</Empty>
                )}
              </div>
            </section>

            <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
              <h2 className="font-black">Novos anúncios encontrados</h2>
              <div className="mt-4 space-y-3">
                {(events.data ?? []).map((event: any) => {
                  const snapshot = (event.property_snapshot ?? {}) as Record<string, any>;
                  return (
                    <div
                      key={event.id}
                      className={`rounded-2xl border p-4 ${event.read_at ? "border-[var(--mi-border)] bg-[var(--mi-surface-soft)]" : "border-blue-500/20 bg-blue-600/[0.05]"}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-bold">{event.title}</p>
                          <p className="mt-1 text-sm text-blue-600">
                            {formatPrice(snapshot.price)}
                          </p>
                          <p className="mt-1 text-xs text-[var(--mi-text-soft)]">
                            {[snapshot.location_city, snapshot.location_state]
                              .filter(Boolean)
                              .join(" - ")}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {!event.read_at && (
                            <button
                              onClick={async () => {
                                await markReadFn({ data: { id: event.id } });
                                await events.refetch();
                              }}
                              className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--mi-border)] px-3 text-xs font-semibold text-[var(--mi-text-muted)]"
                            >
                              <CheckCircle2 className="h-4 w-4" /> Marcar lido
                            </button>
                          )}
                          {snapshot.source_url && (
                            <a
                              href={snapshot.source_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-9 items-center gap-2 rounded-xl bg-blue-600 px-3 text-xs font-black text-white"
                            >
                              Anúncio <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!events.isLoading && (events.data?.length ?? 0) === 0 && (
                  <Empty>
                    Quando um novo anúncio combinar com seus alertas, ele aparecerá aqui.
                  </Empty>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.14em] text-[var(--mi-text-soft)]">
        {label}
      </span>
      <div className="flex h-11 items-center rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-3 [&_input]:w-full [&_input]:bg-transparent [&_input]:text-sm [&_input]:text-[var(--mi-text)] [&_input]:outline-none [&_input]:placeholder:text-slate-600 [&_select]:w-full [&_select]:bg-transparent [&_select]:text-sm [&_select]:text-[var(--mi-text)] [&_select]:outline-none [&_option]:bg-[var(--mi-surface)]">
        {children}
      </div>
    </label>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--mi-border)] p-6 text-center text-sm text-[var(--mi-text-soft)]">
      {children}
    </div>
  );
}
function formatPrice(value: unknown) {
  return typeof value === "number"
    ? new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits: 0,
      }).format(value)
    : "Preço no anúncio";
}
function describeCriteria(criteria: any) {
  const parts = [
    criteria?.city,
    criteria?.state,
    criteria?.propertyType,
    criteria?.auctionOnly ? "Leilão" : null,
    criteria?.market === "caixa" ? "CAIXA" : criteria?.market === "market" ? "Mercado" : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" • ") : "Todos os novos imóveis";
}
