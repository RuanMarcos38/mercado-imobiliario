from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if new in text:
        return False
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))
    return True


def replace_all(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        return False
    p.write_text(text.replace(old, new))
    return True


# 1) Busca: 100 imóveis por página.
replace_once(
    "src/components/property/PropertyWorkspace.tsx",
    'type SortValue = "recent" | "price_asc" | "price_desc" | "area_desc";\n',
    'type SortValue = "recent" | "price_asc" | "price_desc" | "area_desc";\nconst PAGE_SIZE = 100;\n',
)
replace_all("src/components/property/PropertyWorkspace.tsx", "    limit: 48,", "    limit: PAGE_SIZE,")
replace_all(
    "src/components/property/PropertyWorkspace.tsx",
    "offset: (page - 1) * 48",
    "offset: (page - 1) * PAGE_SIZE",
)
replace_all(
    "src/components/property/PropertyWorkspace.tsx",
    "A busca consulta toda a base. Até 48 imóveis são carregados por vez para\n                      manter a navegação rápida.",
    "A busca consulta toda a base. Até {PAGE_SIZE} imóveis são carregados por página, com fontes de mercado priorizadas antes da CAIXA.",
)
replace_all(
    "src/components/property/PropertyWorkspace.tsx",
    "(searchQuery.data?.total ?? 0) > 48",
    "(searchQuery.data?.total ?? 0) > PAGE_SIZE",
)
replace_all(
    "src/components/property/PropertyWorkspace.tsx",
    "Math.ceil((searchQuery.data?.total ?? 0) / 48)",
    "Math.ceil((searchQuery.data?.total ?? 0) / PAGE_SIZE)",
)

# 2) Backend aceita 100 e, em 'Todos + recentes', mercado privado vem antes de CAIXA.
replace_all(
    "src/lib/property-search.functions.ts",
    'limit: z.number().int().min(1).max(60).optional().default(30),',
    'limit: z.number().int().min(1).max(100).optional().default(100),',
)
replace_once(
    "src/lib/property-search.functions.ts",
    "    const items = sortItems(Array.from(deduped.values()), input.sort).slice(0, limit);",
    '''    const dedupedItems = Array.from(deduped.values());
    const items = (
      input.market === "all" && input.sort === "recent"
        ? dedupedItems.sort((a, b) => {
            const aCaixa = a.listing_market === "caixa" ? 1 : 0;
            const bCaixa = b.listing_market === "caixa" ? 1 : 0;
            if (aCaixa !== bCaixa) return aCaixa - bCaixa;
            const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
            const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
            return bTime - aTime;
          })
        : sortItems(dedupedItems, input.sort)
    ).slice(0, limit);''',
)

# 3) Auditor: teste real e crítico de diversidade em Joinville.
marker = "async function testStorage() {"
addition = '''async function testJoinvilleSourceDiversity(db: any) {
  return timed(async () => {
    const result = await db.rpc("property_region_search_health", {
      p_city: "Joinville",
      p_state: "SC",
    });
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    const market = Number(row?.market ?? 0);
    const caixa = Number(row?.caixa ?? 0);
    const sources = Number(row?.sources ?? 0);
    const marketSources = Array.isArray(row?.market_sources)
      ? row.market_sources.filter(Boolean).map(String)
      : [];
    const ok = !result.error && market >= 3 && marketSources.length >= 2;
    return {
      key: "search-joinville-diversity",
      label: "Teste IA de pesquisa — Joinville",
      category: "Busca imobiliária",
      critical: true,
      configured: true,
      status: ok ? ("pass" as const) : ("fail" as const),
      detail: result.error
        ? `Falha no teste regional: ${result.error.message}`
        : ok
          ? `Joinville retornou ${market} imóveis de mercado em ${marketSources.length} fontes (${marketSources.join(", ")}) + ${caixa} CAIXA.`
          : `Joinville ainda não possui diversidade suficiente: mercado=${market}, fontes de mercado=${marketSources.length}, CAIXA=${caixa}, fontes totais=${sources}.`,
    };
  });
}

'''
p = Path("src/lib/backend-auditor.functions.ts")
text = p.read_text()
if "async function testJoinvilleSourceDiversity" not in text:
    if marker not in text:
        raise SystemExit("backend auditor marker missing")
    text = text.replace(marker, addition + marker, 1)
if "      testJoinvilleSourceDiversity(db)," not in text:
    target = "      testSearchHealth(db),\n      testStorage(),"
    if target not in text:
        raise SystemExit("backend auditor core check marker missing")
    text = text.replace(target, "      testSearchHealth(db),\n      testJoinvilleSourceDiversity(db),\n      testStorage(),", 1)
p.write_text(text)

# 4) Presença/histórico em toda sessão autenticada.
replace_once(
    "src/routes/_authenticated.tsx",
    'import { useState } from "react";',
    'import { useEffect, useRef, useState } from "react";',
)
replace_once(
    "src/routes/_authenticated.tsx",
    'import { ThemeToggle } from "@/components/ThemeToggle";',
    'import { useServerFn } from "@tanstack/react-start";\nimport { ThemeToggle } from "@/components/ThemeToggle";',
)
replace_once(
    "src/routes/_authenticated.tsx",
    'import { resolveTenantContext, type TenantContext } from "@/lib/tenant";',
    'import { resolveTenantContext, type TenantContext } from "@/lib/tenant";\nimport { recordUserActivity, touchUserPresence } from "@/lib/user-activity.functions";',
)
replace_once(
    "src/routes/_authenticated.tsx",
    '''  const [globalSearch, setGlobalSearch] = useState("");

  const signOut = async () => {
    await supabase.auth.signOut();''',
    '''  const [globalSearch, setGlobalSearch] = useState("");
  const touchPresenceFn = useServerFn(touchUserPresence);
  const recordActivityFn = useServerFn(recordUserActivity);
  const presenceSessionId = useRef("");

  useEffect(() => {
    const existing = sessionStorage.getItem("mercadoimobi:presenceSessionId");
    const sessionId = existing || crypto.randomUUID();
    sessionStorage.setItem("mercadoimobi:presenceSessionId", sessionId);
    presenceSessionId.current = sessionId;
    const heartbeat = () =>
      touchPresenceFn({
        data: { sessionId, path: window.location.pathname, userAgent: navigator.userAgent },
      }).catch(() => undefined);
    void heartbeat();
    if (!sessionStorage.getItem(`mercadoimobi:sessionLogged:${sessionId}`)) {
      sessionStorage.setItem(`mercadoimobi:sessionLogged:${sessionId}`, "1");
      void recordActivityFn({
        data: { sessionId, eventType: "session_start", path: window.location.pathname },
      }).catch(() => undefined);
    }
    const interval = window.setInterval(() => void heartbeat(), 30_000);
    return () => window.clearInterval(interval);
  }, [recordActivityFn, touchPresenceFn]);

  useEffect(() => {
    const sessionId = presenceSessionId.current;
    if (!sessionId) return;
    void touchPresenceFn({
      data: { sessionId, path: location.pathname, userAgent: navigator.userAgent },
    }).catch(() => undefined);
    void recordActivityFn({
      data: { sessionId, eventType: "route_view", path: location.pathname },
    }).catch(() => undefined);
  }, [location.pathname, recordActivityFn, touchPresenceFn]);

  const signOut = async () => {
    if (presenceSessionId.current) {
      await recordActivityFn({
        data: {
          sessionId: presenceSessionId.current,
          eventType: "sign_out",
          path: location.pathname,
        },
      }).catch(() => undefined);
    }
    await supabase.auth.signOut();''',
)

# 5) Administração: contadores online e histórico, apenas de forma aditiva.
replace_once(
    "src/routes/_authenticated/admin/usuarios.tsx",
    'import { useMemo, useState } from "react";',
    'import { useEffect, useMemo, useState } from "react";',
)
replace_once(
    "src/routes/_authenticated/admin/usuarios.tsx",
    'import { KeyRound, Plus, RefreshCcw, Search, ShieldCheck, Users } from "lucide-react";',
    'import { Activity, Clock3, KeyRound, Plus, RefreshCcw, Search, ShieldCheck, Users } from "lucide-react";',
)
replace_once(
    "src/routes/_authenticated/admin/usuarios.tsx",
    'import { Button } from "@/components/ui/button";',
    'import { Button } from "@/components/ui/button";\nimport { supabase } from "@/integrations/supabase/client";',
)
replace_once(
    "src/routes/_authenticated/admin/usuarios.tsx",
    '} from "@/lib/platform-admin.functions";',
    '} from "@/lib/platform-admin.functions";\nimport { getAdminRealtimeUsage, listAdminActivityLogs } from "@/lib/user-activity.functions";',
)
replace_once(
    "src/routes/_authenticated/admin/usuarios.tsx",
    '  const users = useQuery({ queryKey: ["platform-users"], queryFn: () => listFn() });',
    '''  const usageFn = useServerFn(getAdminRealtimeUsage);
  const activityFn = useServerFn(listAdminActivityLogs);
  const users = useQuery({ queryKey: ["platform-users"], queryFn: () => listFn() });
  const usage = useQuery({
    queryKey: ["admin-realtime-usage"],
    queryFn: () => usageFn(),
    refetchInterval: 15_000,
  });
  const activity = useQuery({
    queryKey: ["admin-activity-logs"],
    queryFn: () => activityFn(),
    refetchInterval: 30_000,
  });''',
)
replace_once(
    "src/routes/_authenticated/admin/usuarios.tsx",
    '  const [query, setQuery] = useState("");',
    '''  useEffect(() => {
    const channel = supabase
      .channel("admin-user-presence")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_presence" }, () => {
        void usage.refetch();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [usage.refetch]);

  const userById = useMemo(
    () => new Map((users.data ?? []).map((user) => [user.id, user])),
    [users.data],
  );
  const [query, setQuery] = useState("");''',
)
replace_all(
    "src/routes/_authenticated/admin/usuarios.tsx",
    '<div className="mt-6 grid gap-3 sm:grid-cols-3">',
    '<div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">',
)
replace_once(
    "src/routes/_authenticated/admin/usuarios.tsx",
    '          <Metric label="Assinaturas ativas" value={(users.data ?? []).filter((user) => user.subscriptionStatus === "active").length} />\n        </div>',
    '''          <Metric label="Assinaturas ativas" value={(users.data ?? []).filter((user) => user.subscriptionStatus === "active").length} />
          <Metric label="Online agora" value={usage.data?.onlineUsers ?? 0} />
          <Metric label="Sessões online" value={usage.data?.onlineSessions ?? 0} />
        </div>''',
)

admin_marker = '      <Dialog open={open} onOpenChange={setOpen}>'
admin_panels = '''      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="overflow-hidden rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)]">
          <div className="flex items-center justify-between border-b border-[var(--mi-border)] p-4">
            <div>
              <p className="text-xs font-black">Usuários online em tempo real</p>
              <p className="mt-1 text-[11px] text-[var(--mi-text-muted)]">Ativo = heartbeat recebido nos últimos 90 segundos.</p>
            </div>
            <Activity className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="max-h-[420px] overflow-auto">
            {(usage.data?.sessions ?? []).map((session) => {
              const user = userById.get(session.userId);
              return (
                <div key={`${session.userId}:${session.sessionId}`} className="flex items-center justify-between gap-3 border-t border-[var(--mi-border)] px-4 py-3 text-sm">
                  <div>
                    <p className="font-bold">{user?.fullName || user?.email || session.userId.slice(0, 8)}</p>
                    <p className="text-xs text-[var(--mi-text-muted)]">{session.currentPath || "/"}</p>
                  </div>
                  <div className="text-right">
                    <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-black text-emerald-700">ONLINE</span>
                    <p className="mt-1 text-[10px] text-[var(--mi-text-soft)]">{new Date(session.lastSeenAt).toLocaleTimeString("pt-BR")}</p>
                  </div>
                </div>
              );
            })}
            {!usage.isLoading && (usage.data?.sessions?.length ?? 0) === 0 && (
              <p className="p-6 text-center text-sm text-[var(--mi-text-muted)]">Nenhum usuário online agora.</p>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)]">
          <div className="flex items-center justify-between border-b border-[var(--mi-border)] p-4">
            <div>
              <p className="text-xs font-black">Histórico de uso</p>
              <p className="mt-1 text-[11px] text-[var(--mi-text-muted)]">Sessões, páginas acessadas e saídas registradas.</p>
            </div>
            <Clock3 className="h-5 w-5 text-blue-600" />
          </div>
          <div className="max-h-[420px] overflow-auto">
            {(activity.data ?? []).map((log) => {
              const user = userById.get(log.userId);
              return (
                <div key={log.id} className="border-t border-[var(--mi-border)] px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-bold">{user?.fullName || user?.email || log.userId.slice(0, 8)}</p>
                    <span className="text-[10px] text-[var(--mi-text-soft)]">{new Date(log.createdAt).toLocaleString("pt-BR")}</span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--mi-text-muted)]">{log.eventType} · {log.path || "—"}</p>
                </div>
              );
            })}
            {!activity.isLoading && (activity.data?.length ?? 0) === 0 && (
              <p className="p-6 text-center text-sm text-[var(--mi-text-muted)]">O histórico será preenchido conforme os usuários navegam.</p>
            )}
          </div>
        </div>
      </section>

'''
p = Path("src/routes/_authenticated/admin/usuarios.tsx")
text = p.read_text()
if "Usuários online em tempo real" not in text:
    if admin_marker not in text:
        raise SystemExit("admin dialog marker missing")
    text = text.replace(admin_marker, admin_panels + admin_marker, 1)
p.write_text(text)
