from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


# 1) Limit platform configuration visibility for normal users while preserving attendance tools.
path = "src/routes/_authenticated.tsx"
replace_once(
    path,
    '''    const isPlatformAdmin = userRoles.includes("admin");
    const billingBlocked = ["past_due", "canceled", "unpaid"].includes(subscriptionStatus ?? "");
    const accountBlocked = !isPlatformAdmin && (!profileActive || billingBlocked);
    if (accountBlocked && location.pathname !== "/assinatura") {
      throw redirect({ to: "/assinatura" });
    }

    return {''',
    '''    const isPlatformAdmin = userRoles.includes("admin");
    const billingBlocked = ["past_due", "canceled", "unpaid"].includes(subscriptionStatus ?? "");
    const accountBlocked = !isPlatformAdmin && (!profileActive || billingBlocked);
    if (accountBlocked && location.pathname !== "/assinatura") {
      throw redirect({ to: "/assinatura" });
    }

    const adminOnlyPaths = ["/admin", "/diagnostico", "/integracoes", "/fluxos"];
    if (
      !isPlatformAdmin &&
      adminOnlyPaths.some(
        (path) => location.pathname === path || location.pathname.startsWith(`${path}/`),
      )
    ) {
      throw redirect({ to: "/atendimento" });
    }

    return {''',
)
replace_once(
    path,
    '''const toolItems = [
  { to: "/atendimento", label: "Atendimento WhatsApp", icon: MessageCircle },
  { to: "/crm", label: "CRM / Oportunidades", icon: Users },
  { to: "/afiliados", label: "Afiliados / Wallet", icon: WalletCards },
  { to: "/analise-localizacao", label: "Análise de localização", icon: MapPin },
  { to: "/simulador-financiamento", label: "Simulador financiamento", icon: Calculator },
  { to: "/fluxos", label: "Fluxos", icon: Workflow },
  { to: "/assistente", label: "Assistente IA", icon: Bot },
  { to: "/diagnostico", label: "Diagnóstico", icon: ShieldCheck },
  { to: "/integracoes", label: "Fontes de imóveis", icon: Plug },
] as const;''',
    '''const toolItems = [
  { to: "/atendimento", label: "Modo Atendimento", icon: MessageCircle },
  { to: "/crm", label: "CRM / Oportunidades", icon: Users },
  { to: "/afiliados", label: "Afiliados / Wallet", icon: WalletCards },
  { to: "/analise-localizacao", label: "Análise de localização", icon: MapPin },
  { to: "/simulador-financiamento", label: "Simulador financiamento", icon: Calculator },
  { to: "/fluxos", label: "Fluxos", icon: Workflow, adminOnly: true },
  { to: "/assistente", label: "Assistente IA", icon: Bot },
  { to: "/diagnostico", label: "Diagnóstico", icon: ShieldCheck, adminOnly: true },
  { to: "/integracoes", label: "Fontes de imóveis", icon: Plug, adminOnly: true },
] as const;''',
)
replace_once(
    path,
    '''  const isAdmin = roles.includes("admin");
  const [mobileOpen, setMobileOpen] = useState(false);''',
    '''  const isAdmin = roles.includes("admin");
  const visibleToolItems = toolItems.filter(
    (item) => !("adminOnly" in item) || item.adminOnly !== true || isAdmin,
  );
  const [mobileOpen, setMobileOpen] = useState(false);''',
)
replace_once(
    path,
    '''                  {toolItems.map((item) => (''',
    '''                  {visibleToolItems.map((item) => (''',
)
replace_once(
    path,
    '''              {[...primaryItems, ...toolItems].map((item) => (''',
    '''              {[...primaryItems, ...visibleToolItems].map((item) => (''',
)
replace_once(
    path,
    '''                  <Link
                    to="/settings/security"
                    onClick={() => setAccountOpen(false)}
                    className="mi-popover-link"
                  >
                    <Settings className="h-4 w-4" /> Configurações
                  </Link>''',
    '''                  {isAdmin && (
                    <Link
                      to="/settings/security"
                      onClick={() => setAccountOpen(false)}
                      className="mi-popover-link"
                    >
                      <Settings className="h-4 w-4" /> Configurações
                    </Link>
                  )}''',
)
replace_once(
    path,
    '''              <Link
                to="/settings/security"
                onClick={() => setMobileOpen(false)}
                className="mi-mobile-link"
              >
                <Settings className="h-4 w-4" /> Configurações
              </Link>''',
    '''              <MobileNavLink
                item={{ to: "/settings/security", label: "Minha conta", icon: UserRound }}
                pathname={location.pathname}
                onClick={() => setMobileOpen(false)}
              />
              {isAdmin && (
                <Link
                  to="/settings/security"
                  onClick={() => setMobileOpen(false)}
                  className="mi-mobile-link"
                >
                  <Settings className="h-4 w-4" /> Configurações
                </Link>
              )}''',
)

# 2) Expose a platform-admin flag to the attendance UI.
path = "src/lib/attendance-center.functions.ts"
replace_once(
    path,
    '''    const [canView, presenceEvent] = await Promise.all([
      canViewSensitiveData(tenantId, context.userId, member.role),
      latestEvent(
        tenantId,
        EVENT.presence,
        (eventMetadata) => stringValue(eventMetadata["userId"]) === context.userId,
      ),
    ]);
    const presenceMetadata = metadata(presenceEvent);
    return {
      canViewSensitiveData: canView,
      canManageSensitiveVisibility: member.canManageSensitiveVisibility,''',
    '''    const [canView, presenceEvent, platformAdminResult] = await Promise.all([
      canViewSensitiveData(tenantId, context.userId, member.role),
      latestEvent(
        tenantId,
        EVENT.presence,
        (eventMetadata) => stringValue(eventMetadata["userId"]) === context.userId,
      ),
      adminDb()
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .eq("role", "admin")
        .maybeSingle(),
    ]);
    if (platformAdminResult.error) throw new Error(platformAdminResult.error.message);
    const presenceMetadata = metadata(presenceEvent);
    return {
      canViewSensitiveData: canView,
      canManageSensitiveVisibility: member.canManageSensitiveVisibility,
      isPlatformAdmin: Boolean(platformAdminResult.data),''',
)

# 3) Keep attendance operational for users, move sensitive controls into an admin-only disclosure,
# navigate internally to AI settings, and auto-open the latest real conversation/messages.
path = "src/routes/_authenticated/atendimento.tsx"
replace_once(
    path,
    'import { createFileRoute } from "@tanstack/react-router";',
    'import { createFileRoute, useNavigate } from "@tanstack/react-router";',
)
replace_once(
    path,
    '''function AtendimentoPage() {
  const statusFn = useServerFn(getWhatsAppConnectionStatus);''',
    '''function AtendimentoPage() {
  const navigate = useNavigate();
  const statusFn = useServerFn(getWhatsAppConnectionStatus);''',
)
replace_once(
    path,
    '''  const dashboard = useQuery({
    queryKey: ["attendance-dashboard", dashboardPeriod],
    queryFn: () => dashboardFn({ data: { startIso: startIsoForPeriod(dashboardPeriod) } }),
    enabled: showRealtimePanel,
    refetchInterval: showRealtimePanel ? 15_000 : false,
  });

  useEffect(() => {
    // Opening the attendance center''',
    '''  const dashboard = useQuery({
    queryKey: ["attendance-dashboard", dashboardPeriod],
    queryFn: () => dashboardFn({ data: { startIso: startIsoForPeriod(dashboardPeriod) } }),
    enabled: showRealtimePanel,
    refetchInterval: showRealtimePanel ? 15_000 : false,
  });

  useEffect(() => {
    if (selectedId || conversations.isLoading) return;
    const latestConversation = conversations.data?.[0];
    if (!latestConversation) return;
    setQueueTab(latestConversation.attendance_state || "automatic");
    setSelectedId(latestConversation.id);
  }, [conversations.data, conversations.isLoading, selectedId]);

  useEffect(() => {
    // Opening the attendance center''',
)
replace_once(
    path,
    '''            {connection.data?.connected ? (
              <Button
                variant="outline"
                disabled={disconnecting}
                onClick={() => void disconnect()}
                className="mt-3 h-11 w-full rounded-xl border-rose-300/50 font-black text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20"
              >
                <WifiOff className="mr-2 h-4 w-4" />
                {disconnecting ? "Desconectando..." : "Desconectar WhatsApp"}
              </Button>
            ) : (
              <Button
                onClick={() => void connect()}
                className="mt-3 h-11 w-full rounded-xl bg-emerald-600 font-black text-white hover:bg-emerald-700"
              >
                <Link2 className="mr-2 h-4 w-4" /> Conectar meu WhatsApp por QR Code
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => window.location.assign("/fluxos")}
              className="mt-2 h-10 w-full rounded-xl border-[var(--mi-border)] font-black"
            >
              <Bot className="mr-2 h-4 w-4" /> Configurar agente de IA e automático
            </Button>
            <div className="mt-2">
              <AttendanceDistributionPanel />
            </div>''',
    '''            {viewer.data?.isPlatformAdmin && (
              <details className="mt-3 overflow-hidden rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface)]">
                <summary className="cursor-pointer px-3 py-2.5 text-xs font-black text-[var(--mi-text-muted)]">
                  Configurações do atendimento
                </summary>
                <div className="border-t border-[var(--mi-border)] p-3">
                  {connection.data?.connected ? (
                    <Button
                      variant="outline"
                      disabled={disconnecting}
                      onClick={() => void disconnect()}
                      className="h-10 w-full rounded-xl border-rose-300/50 font-black text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                    >
                      <WifiOff className="mr-2 h-4 w-4" />
                      {disconnecting ? "Desconectando..." : "Desconectar WhatsApp"}
                    </Button>
                  ) : (
                    <Button
                      onClick={() => void connect()}
                      className="h-10 w-full rounded-xl bg-emerald-600 font-black text-white hover:bg-emerald-700"
                    >
                      <Link2 className="mr-2 h-4 w-4" /> Conectar WhatsApp por QR Code
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => void navigate({ to: "/assistente" })}
                    className="mt-2 h-10 w-full rounded-xl border-[var(--mi-border)] font-black"
                  >
                    <Bot className="mr-2 h-4 w-4" /> Configurar agente de IA
                  </Button>
                  <div className="mt-2">
                    <AttendanceDistributionPanel />
                  </div>
                </div>
              </details>
            )}''',
)
replace_once(
    path,
    '''                {!connection.data?.connected && (
                  <Button
                    onClick={() => void connect()}
                    className="mt-5 rounded-xl bg-emerald-600 text-white"
                  >
                    <Link2 className="mr-2 h-4 w-4" /> Conectar WhatsApp
                  </Button>
                )}''',
    '''                {viewer.data?.isPlatformAdmin && !connection.data?.connected && (
                  <Button
                    onClick={() => void connect()}
                    className="mt-5 rounded-xl bg-emerald-600 text-white"
                  >
                    <Link2 className="mr-2 h-4 w-4" /> Conectar WhatsApp
                  </Button>
                )}''',
)

# 4) Read the selected tenant's messages server-side with explicit tenant scoping,
# avoiding client-RLS/session inconsistencies while preserving isolation.
path = "src/lib/whatsapp-tenant.functions.ts"
replace_once(
    path,
    'import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";',
    'import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";\nimport { supabaseAdmin } from "@/integrations/supabase/client.server";',
)
replace_once(
    path,
    '''export const listWhatsAppMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => conversationSchema.parse(data))
  .handler(async ({ data, context }): Promise<WhatsAppMessage[]> => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;''',
    '''export const listWhatsAppMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => conversationSchema.parse(data))
  .handler(async ({ data, context }): Promise<WhatsAppMessage[]> => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = supabaseAdmin as any;''',
)
