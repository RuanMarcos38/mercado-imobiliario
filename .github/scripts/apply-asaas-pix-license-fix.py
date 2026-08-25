from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one marker in {path}, found {count}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1))


asaas = "src/lib/asaas-billing.server.ts"
pix_helper = '''async function ensureAsaasPixReady(config: AsaasConfig) {
  const activeKeys = await asaasRequest(
    config,
    "/pix/addressKeys?status=ACTIVE&offset=0&limit=1",
    { method: "GET" },
  );
  const keys = Array.isArray(activeKeys["data"]) ? activeKeys["data"] : [];
  if (keys.length > 0) return;

  const accountStatus = await asaasRequest(config, "/myAccount/status/", { method: "GET" });
  const general = String(accountStatus["general"] ?? "UNKNOWN").toUpperCase();
  const bank = String(accountStatus["bankAccountInfo"] ?? "UNKNOWN").toUpperCase();
  const documentation = String(accountStatus["documentation"] ?? "UNKNOWN").toUpperCase();
  if (general !== "APPROVED") {
    throw new Error(`ASAAS_PIX_ACCOUNT_NOT_APPROVED:${general}:${bank}:${documentation}`);
  }

  let created: JsonObject;
  try {
    created = await asaasRequest(config, "/pix/addressKeys", {
      method: "POST",
      body: JSON.stringify({ type: "EVP" }),
    });
  } catch (error) {
    const message = String((error as Error)?.message ?? "");
    if (
      message.toLowerCase().includes("não está totalmente aprovada") ||
      message.toLowerCase().includes("nenhuma chave pix")
    ) {
      throw new Error("ASAAS_PIX_NOT_AVAILABLE");
    }
    throw error;
  }

  if (String(created["status"] ?? "").toUpperCase() === "ACTIVE") return;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const refreshed = await asaasRequest(
      config,
      "/pix/addressKeys?status=ACTIVE&offset=0&limit=1",
      { method: "GET" },
    );
    const active = Array.isArray(refreshed["data"]) ? refreshed["data"] : [];
    if (active.length > 0) return;
  }
  throw new Error("ASAAS_PIX_KEY_ACTIVATING");
}

'''
replace_once(
    asaas,
    "async function createAsaasRecurringPaymentLink(\n",
    pix_helper + "async function createAsaasRecurringPaymentLink(\n",
)
replace_once(
    asaas,
    '  const billingType = normalizeAsaasBillingType(input.paymentMethod);\n  const payload = await asaasRequest(config, "/paymentLinks", {',
    '  const billingType = normalizeAsaasBillingType(input.paymentMethod);\n  if (billingType === "PIX") await ensureAsaasPixReady(config);\n  const payload = await asaasRequest(config, "/paymentLinks", {',
)

page = "src/routes/_authenticated/assinatura.tsx"
replace_once(
    page,
    '''      toast.error(
        message.includes("STRIPE_NOT_CONFIGURED")
          ? "O checkout ainda precisa das credenciais de cobrança no servidor."
          : message.includes("PLAN_REQUIRES_COMMERCIAL")
            ? "Este plano é contratado diretamente com o administrador."
            : "Não foi possível abrir o pagamento agora.",
      );''',
    '''      toast.error(
        message.includes("ASAAS_PIX_ACCOUNT_NOT_APPROVED") ||
          message.includes("ASAAS_PIX_NOT_AVAILABLE")
          ? "Pix temporariamente indisponível no Asaas. Conclua a aprovação da conta bancária e da documentação; depois disso a chave Pix será ativada automaticamente."
          : message.includes("ASAAS_PIX_KEY_ACTIVATING")
            ? "A chave Pix está sendo ativada no Asaas. Aguarde alguns instantes e tente novamente."
            : message.includes("STRIPE_NOT_CONFIGURED")
              ? "O checkout ainda precisa das credenciais de cobrança no servidor."
              : message.includes("PLAN_REQUIRES_COMMERCIAL")
                ? "Este plano é contratado diretamente com o administrador."
                : "Não foi possível abrir o pagamento agora.",
      );''',
)

auth = "src/routes/_authenticated.tsx"
replace_once(
    auth,
    "    let planFeatures: string[] | null = null;\n    let featureOverrides = new Map<string, boolean>();",
    "    let planFeatures: string[] = [];\n    let entitlementLoaded = false;\n    let featureOverrides = new Map<string, boolean>();",
)
replace_once(
    auth,
    '''      if (subscriptionPlanId) {
        const { data: plan } = await supabase
          .from("subscription_plans")
          .select("slug,name,feature_keys")
          .eq("id", subscriptionPlanId)
          .maybeSingle();
        if (plan) {
          planName = String(plan.name ?? "");
          planSlug = String(plan.slug ?? "");
          planFeatures = Array.isArray(plan.feature_keys) ? plan.feature_keys.map(String) : [];
        }
      }
    } catch {
      // Fail-open preserves the current platform if billing metadata is temporarily unavailable.
      planFeatures = null;
    }''',
    '''      if (subscriptionPlanId) {
        const { data: plan, error: planError } = await supabase
          .from("subscription_plans")
          .select("slug,name,feature_keys")
          .eq("id", subscriptionPlanId)
          .maybeSingle();
        if (planError) throw planError;
        if (plan) {
          planName = String(plan.name ?? "");
          planSlug = String(plan.slug ?? "");
          planFeatures = Array.isArray(plan.feature_keys) ? plan.feature_keys.map(String) : [];
        }
      }
      entitlementLoaded = true;
    } catch {
      // Fail closed for subscriber features: temporary billing metadata failures must not grant a larger plan.
      planFeatures = [];
      entitlementLoaded = false;
    }''',
)
replace_once(
    auth,
    "    const allowedFeatures = new Set<string>(planFeatures ?? routeFeatureMap.map(([, key]) => key));",
    '''    const hasPlanEntitlement =
      entitlementLoaded &&
      ["active", "trialing"].includes(subscriptionStatus ?? "") &&
      Boolean(subscriptionPlanId);
    const allowedFeatures = new Set<string>(hasPlanEntitlement ? planFeatures : []);''',
)

migration = Path("supabase/migrations/20260825233500_harden_plan_feature_entitlements.sql")
if migration.exists():
    raise SystemExit("Migration already exists unexpectedly")
migration.write_text('''-- Entitlements are derived from the latest active/trialing subscription plan.
-- Administrators and explicit per-user overrides remain supported.
create or replace function public.user_has_plan_feature(p_user_id uuid, p_feature_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_override boolean;
  v_override_exists boolean;
  v_plan_features text[];
begin
  select exists(select 1 from public.user_roles where user_id=p_user_id and role='admin') into v_admin;
  if v_admin then return true; end if;

  select allowed, true into v_override, v_override_exists
  from public.user_feature_access
  where user_id=p_user_id and feature_key=p_feature_key
  limit 1;
  if coalesce(v_override_exists,false) then return v_override; end if;

  select sp.feature_keys into v_plan_features
  from public.subscriptions s
  join public.subscription_plans sp on sp.id=s.plan_id and sp.is_active=true
  where s.user_id=p_user_id and s.status in ('active','trialing')
  order by s.created_at desc
  limit 1;

  if v_plan_features is null then
    return false;
  end if;
  return p_feature_key = any(v_plan_features);
end;
$$;

revoke all on function public.user_has_plan_feature(uuid,text) from public;
grant execute on function public.user_has_plan_feature(uuid,text) to authenticated;
''')
