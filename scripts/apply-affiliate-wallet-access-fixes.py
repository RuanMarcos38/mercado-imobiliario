from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"Anchor not found in {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src/routes/_authenticated.tsx",
    '  Users,\n  Workflow,\n  X,',
    '  Users,\n  WalletCards,\n  Workflow,\n  X,',
)
replace_once(
    "src/routes/_authenticated.tsx",
    '  { to: "/crm", label: "CRM / Oportunidades", icon: Users },\n  { to: "/analise-localizacao", label: "Análise de localização", icon: MapPin },',
    '  { to: "/crm", label: "CRM / Oportunidades", icon: Users },\n  { to: "/afiliados", label: "Afiliados / Wallet", icon: WalletCards },\n  { to: "/analise-localizacao", label: "Análise de localização", icon: MapPin },',
)

replace_once(
    "src/routes/auth.tsx",
    '  async function onRegister(values: z.infer<typeof registerSchema>) {\n    setIsLoading(true);\n    try {\n      const { error } = await supabase.auth.signUp({',
    '  async function onRegister(values: z.infer<typeof registerSchema>) {\n    setIsLoading(true);\n    try {\n      const referralCode =\n        typeof (searchParams as any).ref === "string" ? String((searchParams as any).ref).trim() : "";\n      const { error } = await supabase.auth.signUp({',
)
replace_once(
    "src/routes/auth.tsx",
    '            full_name: values.fullName,\n            user_type: values.userType,',
    '            full_name: values.fullName,\n            user_type: values.userType,\n            referral_code: referralCode || undefined,',
)

replace_once(
    "src/routes/api/public/hooks/stripe.tsx",
    '''    const { data: subscription } = await db\n      .from("subscriptions")\n      .select("id")\n      .eq("stripe_customer_id", customer)\n      .order("created_at", { ascending: false })\n      .limit(1)\n      .maybeSingle();\n    if (subscription?.id) {\n      await db\n        .from("subscriptions")\n        .update({\n          status: eventType === "invoice.paid" ? "active" : "past_due",\n          updated_at: new Date().toISOString(),\n        })\n        .eq("id", subscription.id);\n    }\n    return Response.json({ ok: true });''',
    '''    const { data: subscription } = await db\n      .from("subscriptions")\n      .select("id,user_id")\n      .eq("stripe_customer_id", customer)\n      .order("created_at", { ascending: false })\n      .limit(1)\n      .maybeSingle();\n    if (subscription?.id) {\n      await db\n        .from("subscriptions")\n        .update({\n          status: eventType === "invoice.paid" ? "active" : "past_due",\n          updated_at: new Date().toISOString(),\n        })\n        .eq("id", subscription.id);\n\n      if (eventType === "invoice.paid" && subscription.user_id) {\n        const paymentId = typeof eventObject["id"] === "string" ? eventObject["id"] : "";\n        const amountPaidCents = Number(eventObject["amount_paid"] ?? 0);\n        if (paymentId && Number.isFinite(amountPaidCents) && amountPaidCents > 0) {\n          const { error: affiliateError } = await db.rpc("accrue_affiliate_commissions", {\n            p_source_user_id: String(subscription.user_id),\n            p_payment_id: paymentId,\n            p_gross_amount: amountPaidCents / 100,\n          });\n          if (affiliateError) throw new Error(affiliateError.message);\n        }\n      }\n    }\n    return Response.json({ ok: true });''',
)

replace_once(
    "src/routes/_authenticated/admin/usuarios.tsx",
    '  const [open, setOpen] = useState(false);\n  const [saving, setSaving] = useState(false);',
    '  const [open, setOpen] = useState(false);\n  const [saving, setSaving] = useState(false);\n  const [refreshing, setRefreshing] = useState(false);',
)
replace_once(
    "src/routes/_authenticated/admin/usuarios.tsx",
    '  const create = async () => {',
    '''  const refreshAll = async () => {\n    setRefreshing(true);\n    try {\n      await Promise.all([users.refetch(), usage.refetch(), activity.refetch()]);\n      toast.success("Usuários, acessos e sessões atualizados.");\n    } catch {\n      toast.error("Não foi possível atualizar os dados agora.");\n    } finally {\n      setRefreshing(false);\n    }\n  };\n\n  const create = async () => {''',
)
replace_once(
    "src/routes/_authenticated/admin/usuarios.tsx",
    '''  const changeSubscription = async (user: PlatformUser, status: string) => {\n    try {\n      await updateFn({ data: { userId: user.id, subscriptionStatus: status as any } });\n      toast.success("Status da assinatura atualizado.");\n      await users.refetch();\n    } catch {\n      toast.error("Não foi possível atualizar a assinatura.");\n    }\n  };''',
    '''  const changeSubscription = async (user: PlatformUser, status: string) => {\n    try {\n      await updateFn({ data: { userId: user.id, subscriptionStatus: status as any } });\n      toast.success("Status da assinatura atualizado.");\n      await users.refetch();\n    } catch {\n      toast.error("Não foi possível atualizar a assinatura.");\n    }\n  };\n\n  const sendPasswordReset = async (user: PlatformUser) => {\n    try {\n      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {\n        redirectTo: `${window.location.origin}/auth?type=recovery`,\n      });\n      if (error) throw error;\n      toast.success(`Redefinição de senha enviada para ${user.email}.`);\n    } catch {\n      toast.error("Não foi possível enviar a redefinição de senha.");\n    }\n  };''',
)
replace_once(
    "src/routes/_authenticated/admin/usuarios.tsx",
    '''            <Button variant="outline" onClick={() => void users.refetch()}>\n              <RefreshCcw className="mr-2 h-4 w-4" /> Atualizar\n            </Button>''',
    '''            <Button variant="outline" onClick={() => void refreshAll()} disabled={refreshing}>\n              <RefreshCcw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />\n              {refreshing ? "Atualizando..." : "Atualizar"}\n            </Button>''',
)
replace_once(
    "src/routes/_authenticated/admin/usuarios.tsx",
    '''                      <p className="mt-1 text-xs text-[var(--mi-text-muted)]">{user.email}</p>''',
    '''                      <p className="mt-1 text-xs text-[var(--mi-text-muted)]">{user.email}</p>\n                      <p className="mt-1 text-[10px] text-[var(--mi-text-soft)]">\n                        {user.lastSignInAt\n                          ? `Último acesso: ${new Date(user.lastSignInAt).toLocaleString("pt-BR")}`\n                          : "Nunca acessou"}\n                      </p>''',
)
replace_once(
    "src/routes/_authenticated/admin/usuarios.tsx",
    '''                    <td className="px-5 py-4">\n                      <Button size="sm" variant="outline" onClick={() => void toggle(user)}>\n                        {user.isActive ? "Suspender" : "Reativar"}\n                      </Button>\n                    </td>''',
    '''                    <td className="px-5 py-4">\n                      <div className="flex flex-wrap gap-2">\n                        <Button size="sm" variant="outline" onClick={() => void toggle(user)}>\n                          {user.isActive ? "Suspender" : "Reativar"}\n                        </Button>\n                        <Button\n                          size="sm"\n                          variant="outline"\n                          onClick={() => void sendPasswordReset(user)}\n                          title="Enviar redefinição de senha"\n                        >\n                          <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Senha\n                        </Button>\n                      </div>\n                    </td>''',
)
