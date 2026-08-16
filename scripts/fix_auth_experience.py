from pathlib import Path

path = Path("src/routes/auth.tsx")
text = path.read_text(encoding="utf-8")

text = text.replace('import { resolveTenantContext, type TenantContext } from "@/lib/tenant";\n', "")

schema_start = text.find("const authSchema = z.object({")
schema_end = text.find("\n\nexport const Route", schema_start)
if schema_start < 0 or schema_end < 0:
    raise SystemExit("auth schema block not found")
new_schemas = '''const loginSchema = z.object({\n  email: z.string().email("E-mail inválido"),\n  password: z.string().min(6, "A senha deve ter pelo menos 6 caracteres"),\n});\n\nconst registerSchema = loginSchema.extend({\n  fullName: z.string().min(3, "Nome completo é obrigatório"),\n  userType: z.enum(["cliente", "corretor"]),\n});'''
text = text[:schema_start] + new_schemas + text[schema_end:]

text = text.replace(
    'const next = (searchParams as any).next || "/dashboard";',
    '''const requestedNext = (searchParams as any).next;\n  const next =\n    typeof requestedNext === "string" && requestedNext.startsWith("/") && !requestedNext.startsWith("//")\n      ? requestedNext\n      : "/dashboard";''',
    1,
)

text = text.replace(
    'const loginForm = useForm<z.infer<typeof authSchema>>({\n    resolver: zodResolver(authSchema.omit({ fullName: true })),',
    'const loginForm = useForm<z.infer<typeof loginSchema>>({\n    resolver: zodResolver(loginSchema),',
    1,
)
text = text.replace(
    'const registerForm = useForm<z.infer<typeof authSchema>>({\n    resolver: zodResolver(authSchema),',
    'const registerForm = useForm<z.infer<typeof registerSchema>>({\n    resolver: zodResolver(registerSchema),',
    1,
)
text = text.replace(
    '''      fullName: "",\n      companyName: "",''',
    '''      fullName: "",\n      userType: "cliente",''',
    1,
)

# Replace login with a real Supabase login + correct MFA assurance flow.
start = text.find("  async function onLogin(")
end = text.find("\n  async function handleMfaVerify()", start)
if start < 0 or end < 0:
    raise SystemExit("login function boundaries not found")
login_fn = '''  async function onLogin(values: z.infer<typeof loginSchema>) {\n    setIsLoading(true);\n    try {\n      const { error } = await supabase.auth.signInWithPassword({\n        email: values.email,\n        password: values.password,\n      });\n      if (error) throw error;\n\n      const { data: assurance, error: assuranceError } =\n        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();\n      if (assuranceError) throw assuranceError;\n\n      if (assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {\n        setShowMfa(true);\n        setMfaCode("");\n        return;\n      }\n\n      toast.success("Login realizado com sucesso.");\n      navigate({ to: next });\n    } catch (error: any) {\n      const message = String(error?.message ?? "").toLowerCase();\n      if (message.includes("invalid login credentials") || message.includes("invalid credentials")) {\n        toast.error("E-mail ou senha inválidos.");\n      } else if (message.includes("email not confirmed")) {\n        toast.error("Confirme seu e-mail antes de entrar.");\n      } else {\n        toast.error("Não foi possível entrar agora. Tente novamente em instantes.");\n      }\n    } finally {\n      setIsLoading(false);\n    }\n  }\n'''
text = text[:start] + login_fn + text[end:]

start = text.find("  async function handleMfaVerify()")
end = text.find("\n  async function handleResetPassword()", start)
if start < 0 or end < 0:
    raise SystemExit("MFA function boundaries not found")
mfa_fn = '''  async function handleMfaVerify() {\n    setIsLoading(true);\n    try {\n      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();\n      if (factorsError) throw factorsError;\n      const factor = factors?.all.find((item) => item.status === "verified");\n      if (!factor) {\n        toast.error("Não foi possível localizar sua verificação em duas etapas.");\n        return;\n      }\n\n      const { error } = await supabase.auth.mfa.challengeAndVerify({\n        factorId: factor.id,\n        code: mfaCode,\n      });\n      if (error) throw error;\n\n      toast.success("Verificação concluída. Bem-vindo!");\n      setShowMfa(false);\n      setMfaCode("");\n      navigate({ to: next });\n    } catch {\n      toast.error("Código inválido ou expirado. Confira e tente novamente.");\n    } finally {\n      setIsLoading(false);\n    }\n  }\n'''
text = text[:start] + mfa_fn + text[end:]

# Keep recovery messages friendly and do not expose provider errors.
text = text.replace(
    'toast.error(error.message || "Erro ao enviar e-mail de recuperação");',
    'toast.error("Não foi possível enviar o e-mail de recuperação agora.");',
)
text = text.replace(
    'toast.error(error.message || "Erro ao atualizar senha");',
    'toast.error("Não foi possível atualizar a senha agora.");',
)

# Registration: only information necessary for the search account.
start = text.find("  async function onRegister(")
end = text.find("\n  if (isRecovery)", start)
if start < 0 or end < 0:
    raise SystemExit("register function boundaries not found")
register_fn = '''  async function onRegister(values: z.infer<typeof registerSchema>) {\n    setIsLoading(true);\n    try {\n      const { error } = await supabase.auth.signUp({\n        email: values.email,\n        password: values.password,\n        options: {\n          emailRedirectTo: window.location.origin,\n          data: {\n            full_name: values.fullName,\n            user_type: values.userType,\n          },\n        },\n      });\n\n      if (error) throw error;\n      toast.success("Conta criada. Verifique seu e-mail para continuar.");\n    } catch {\n      toast.error("Não foi possível criar sua conta agora. Confira os dados e tente novamente.");\n    } finally {\n      setIsLoading(false);\n    }\n  }\n'''
text = text[:start] + register_fn + text[end:]

# Replace old CRM/trial language.
replacements = {
    "Autenticação de Dois Fatores": "Verificação em duas etapas",
    "Sua conta possui MFA ativado. Insira o código do seu aplicativo autenticador.": "Insira o código de 6 dígitos do seu aplicativo autenticador.",
    "Código MFA": "Código de verificação",
    "mfa-code": "verification-code",
    "Bem-vindo à Inovação": "Encontre imóveis com mais inteligência",
    "7 dias grátis para transformar seu negócio.": "Pesquise, compare e salve imóveis em um só lugar.",
    "Acessar Painel": "Acessar MercadoImobi",
    "Entre com seu e-mail e senha para gerenciar seus imóveis e leads.": "Entre com seu e-mail e senha para continuar suas pesquisas e favoritos.",
    "Entrar no Painel": "Entrar",
    "Inicie seu teste de 7 dias grátis agora mesmo.": "Crie sua conta para pesquisar e salvar imóveis.",
    "E-mail Profissional": "E-mail",
}
for old, new in replacements.items():
    text = text.replace(old, new)

# Replace company/organization block with user profile type selection.
company_start = text.find('                  <div className="space-y-2">\n                    <Label htmlFor="companyName">')
if company_start >= 0:
    next_email = text.find('                  <div className="space-y-2">\n                    <Label htmlFor="reg-email">', company_start)
    if next_email < 0:
        raise SystemExit("registration email block not found")
    user_type_block = '''                  <div className="space-y-2">\n                    <Label htmlFor="userType">Como você vai usar a plataforma?</Label>\n                    <select\n                      id="userType"\n                      {...registerForm.register("userType")}\n                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"\n                    >\n                      <option value="cliente">Estou buscando um imóvel</option>\n                      <option value="corretor">Sou corretor de imóveis</option>\n                    </select>\n                  </div>\n'''
    text = text[:company_start] + user_type_block + text[next_email:]

# Remove false legal links that currently just point back to the login page.
footer_start = text.find('        <p className="px-8 text-center text-sm text-muted-foreground">')
if footer_start >= 0:
    footer_end = text.find("        </p>", footer_start)
    if footer_end >= 0:
        footer_end += len("        </p>")
        footer = '''        <p className="px-8 text-center text-xs leading-relaxed text-muted-foreground">\n          Use dados verdadeiros no cadastro. Seus favoritos e pesquisas ficam associados à sua conta.\n        </p>'''
        text = text[:footer_start] + footer + text[footer_end:]

# Visual alignment with the premium search experience.
text = text.replace(
    'className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12"',
    'className="flex min-h-screen items-center justify-center bg-[#06101c] px-4 py-12 text-white"',
)
text = text.replace(
    '<Card>',
    '<Card className="border-white/10 bg-white/[0.045] text-white shadow-2xl shadow-black/20">',
)
text = text.replace(
    '<TabsList className="grid w-full grid-cols-2 mb-8">',
    '<TabsList className="mb-8 grid w-full grid-cols-2 bg-white/[0.06]">',
)

# Reproducible database migrations.
migrations = Path("supabase/migrations")
migrations.mkdir(parents=True, exist_ok=True)
(migrations / "20260815212000_add_client_user_type.sql").write_text(
    "alter type public.user_type add value if not exists 'cliente';\n",
    encoding="utf-8",
)
(migrations / "20260815212100_update_signup_profile.sql").write_text(
    '''create or replace function public.handle_new_user()\nreturns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = public\nas $$\ndeclare\n  v_name text;\n  v_slug text;\n  v_tenant_id uuid;\n  v_user_type public.user_type;\nbegin\n  v_name := coalesce(\n    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),\n    split_part(new.email, '@', 1)\n  );\n\n  v_user_type := case\n    when new.raw_user_meta_data->>'user_type' = 'corretor' then 'corretor'::public.user_type\n    else 'cliente'::public.user_type\n  end;\n\n  v_slug := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');\n  v_slug := trim(both '-' from v_slug);\n  if v_slug is null or v_slug = '' then\n    v_slug := 'conta';\n  end if;\n  v_slug := v_slug || '-' || substr(replace(new.id::text, '-', ''), 1, 8);\n\n  insert into public.tenants (name, slug)\n  values (v_name, v_slug)\n  returning id into v_tenant_id;\n\n  insert into public.profiles (id, full_name, user_type, company_name, tenant_id)\n  values (new.id, new.raw_user_meta_data->>'full_name', v_user_type, null, v_tenant_id);\n\n  insert into public.tenant_members (tenant_id, user_id, member_role)\n  values (v_tenant_id, new.id, 'owner')\n  on conflict (tenant_id, user_id) do nothing;\n\n  return new;\nend;\n$$;\n''',
    encoding="utf-8",
)

# Keep generated TypeScript database enum aligned.
types_path = Path("src/integrations/supabase/types.ts")
types = types_path.read_text(encoding="utf-8")
types = types.replace(
    'user_type: "corretor" | "imobiliaria" | "proprietario" | "construtora" | "admin";',
    'user_type: "cliente" | "corretor" | "imobiliaria" | "proprietario" | "construtora" | "admin";',
)
types_path.write_text(types, encoding="utf-8")

required = [
    'userType: z.enum(["cliente", "corretor"])',
    'getAuthenticatorAssuranceLevel()',
    "Estou buscando um imóvel",
    "Sou corretor de imóveis",
    "Entre com seu e-mail e senha para continuar suas pesquisas e favoritos.",
]
for token in required:
    if token not in text:
        raise SystemExit(f"missing authentication correction: {token}")
for forbidden in ["client-ip-placeholder", "gerenciar seus imóveis e leads", "7 dias grátis", "Código MFA"]:
    if forbidden in text:
        raise SystemExit(f"legacy authentication text remains: {forbidden}")

path.write_text(text, encoding="utf-8")
print("authentication experience fixed")
