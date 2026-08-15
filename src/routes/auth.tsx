import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Building2, Mail, Lock, ArrowRight, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveTenantContext, type TenantContext } from "@/lib/tenant";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const authSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(6, "A senha deve ter pelo menos 6 caracteres"),
  fullName: z.string().min(3, "Nome completo é obrigatório").optional(),
  companyName: z.string().min(2, "Informe o nome da sua imobiliária ou organização").optional(),
});

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showMfa, setShowMfa] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const navigate = useNavigate();
  const searchParams = Route.useSearch();
  const next = (searchParams as any).next || "/dashboard";
  const type = (searchParams as any).type;
  const isRecovery = type === "recovery";

  const loginForm = useForm<z.infer<typeof authSchema>>({
    resolver: zodResolver(authSchema.omit({ fullName: true })),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const registerForm = useForm<z.infer<typeof authSchema>>({
    resolver: zodResolver(authSchema),
    defaultValues: {
      email: "",
      password: "",
      fullName: "",
      companyName: "",
    },
  });

  async function onLogin(values: z.infer<typeof authSchema>) {
    setIsLoading(true);
    try {
      // 1. Rate Limiting Check
      try {
        const { data: isAllowed, error: rateLimitError } = await supabase.rpc("check_rate_limit", {
          _ip: "client-ip-placeholder",
        });

        if (rateLimitError) {
          console.error("Rate limit check error:", rateLimitError);
        } else if (isAllowed === false) {
          throw new Error("Múltiplas tentativas falhas. Acesso bloqueado temporariamente.");
        }
      } catch (err) {
        console.warn("Ignorando erro de rate limit para garantir login:", err);
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });

      if (error) throw error;

      // If session is null but no error, it might be waiting for MFA
      // MFA Enforcement: Every login must check for MFA if user has it enabled
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        // This might be null if user has MFA and hasn't solved it yet
        setShowMfa(true);
        setIsLoading(false);
        return;
      }

      // If session exists, we should still check if it's "aal2" (MFA solved)
      // for users that are required to have MFA.
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const hasVerifiedFactors = factors?.all.some((f) => f.status === "verified");

      // Note: We check amr (Authentication Method Reference) in the session
      const amr = (session as any).auth_level || (session as any).amr;

      if (hasVerifiedFactors && amr !== "aal2") {
        // Force MFA solving
        await supabase.auth.signOut(); // Clear partial session
        setShowMfa(true);
        setIsLoading(false);
        toast.info("Autenticação de dois fatores necessária.");
        return;
      }

      // Login multi-tenant: resolve a organização do usuário autenticado
      const { data: userData } = await supabase.auth.getUser();
      let tenant: TenantContext | null = null;

      if (userData.user) {
        tenant = await resolveTenantContext(userData.user.id);

        // Log de auditoria silencioso e resiliente
        try {
          await supabase.from("auth_audit_log").insert({
            event_type: "login",
            user_id: userData.user.id,
            metadata: {
              source: "Auth Page",
              tenant_id: tenant?.tenantId ?? null,
              tenant_slug: tenant?.tenantSlug ?? null,
            } as any,
          });
        } catch (auditErr) {
          console.warn("Erro ao registrar log de auditoria, prosseguindo login.");
        }
      }

      if (tenant) {
        toast.success(`Login realizado — organização: ${tenant.tenantName}`);
      } else {
        toast.success("Login realizado com sucesso!");
        toast.warning("Nenhuma organização vinculada a esta conta ainda.");
      }
      navigate({ to: next });
    } catch (error: any) {
      // Treat specific Supabase MFA error if any
      if (error.message?.includes("mfa")) {
        setShowMfa(true);
        setIsLoading(false);
        return;
      }
      // Audit log: login failed
      try {
        await supabase.from("auth_audit_log").insert({
          event_type: "failed_attempt",
          user_id: null,
          metadata: { email: values.email } as any,
        });

        // Check for multiple failures in last 5 minutes
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { count } = await supabase
          .from("auth_audit_log")
          .select("*", { count: "exact", head: true })
          .eq("event_type", "failed_attempt")
          .gt("created_at", fiveMinutesAgo);

        if (count && count >= 3) {
          toast.error("ALERTA DE SEGURANÇA: Múltiplas tentativas falhas detectadas.", {
            description: "Sua conta pode ser bloqueada temporariamente para proteção.",
          });

          // Enviar alerta crítico
          const { sendSlackAlert } = await import("@/lib/alerts.functions");
          await sendSlackAlert({
            data: {
              message: `Possível ataque de força bruta para o e-mail: ${values.email}`,
              type: "security",
            },
          });
        }
      } catch (auditError) {
        console.error("Erro ao registrar auditoria de falha:", auditError);
      }

      console.error("Erro de login detalhado:", error);
      const errorMessage =
        error.message?.includes("Database error querying schema") || error.code === "42501"
          ? "Erro de permissão no servidor. Estamos resolvendo, tente novamente em alguns segundos (migrações em curso)."
          : error.message || "Erro ao realizar login";
      toast.error(errorMessage);
    } finally {
      if (!showMfa) setIsLoading(false);
    }
  }

  async function handleMfaVerify() {
    setIsLoading(true);
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const factor = factors?.all.find((f) => f.status === "verified");

      if (!factor) throw new Error("Nenhum fator MFA verificado encontrado.");

      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code: mfaCode,
      });

      if (error) throw error;

      toast.success("MFA verificado com sucesso!");
      setShowMfa(false);
      navigate({ to: next });
    } catch (error: any) {
      toast.error(error.message || "Código MFA inválido");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResetPassword() {
    const email = loginForm.getValues("email");
    if (!email || !z.string().email().safeParse(email).success) {
      toast.error("Por favor, insira um e-mail válido no campo de login primeiro.");
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth?type=recovery`,
      });
      if (error) throw error;
      toast.success("E-mail de recuperação enviado! Verifique sua caixa de entrada.");
    } catch (error: any) {
      toast.error(error.message || "Erro ao enviar e-mail de recuperação");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error("A senha deve ter pelo menos 6 caracteres");
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) throw error;
      toast.success("Senha atualizada com sucesso!");
      navigate({ to: "/dashboard" });
    } catch (error: any) {
      toast.error(error.message || "Erro ao atualizar senha");
    } finally {
      setIsLoading(false);
    }
  }

  async function onRegister(values: z.infer<typeof authSchema>) {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            full_name: values.fullName,
            // Usado pelo backend para criar a organização (tenant) do usuário
            company_name: values.companyName,
          },
        },
      });

      if (error) throw error;

      toast.success("Conta criada! Verifique seu e-mail.");
    } catch (error: any) {
      toast.error(error.message || "Erro ao criar conta");
    } finally {
      setIsLoading(false);
    }
  }

  if (isRecovery) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
        <div className="w-full max-w-md space-y-8">
          <div className="flex flex-col items-center text-center">
            <Link
              to="/"
              className="flex items-center gap-2 font-bold text-3xl tracking-tighter text-primary mb-6"
            >
              <Building2 className="h-8 w-8" />
              <span>
                MERCADO<span className="text-muted-foreground font-light">IMOBI</span>
              </span>
            </Link>
            <h2 className="text-2xl font-bold tracking-tight">Redefinir Senha</h2>
            <p className="text-muted-foreground">Escolha uma nova senha segura para sua conta.</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Nova Senha</CardTitle>
              <CardDescription>Digite sua nova senha abaixo.</CardDescription>
            </CardHeader>
            <form onSubmit={handleUpdatePassword}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">Senha</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="new-password"
                      type="password"
                      placeholder="Nova senha"
                      className="pl-10"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                    />
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                <Button className="w-full" type="submit" disabled={isLoading}>
                  {isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    "Atualizar Senha"
                  )}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <Dialog open={showMfa} onOpenChange={setShowMfa}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Autenticação de Dois Fatores</DialogTitle>
              <DialogDescription>
                Sua conta possui MFA ativado. Insira o código do seu aplicativo autenticador.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="mfa-code">Código MFA</Label>
                <Input
                  id="mfa-code"
                  placeholder="000000"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleMfaVerify} disabled={mfaCode.length !== 6 || isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Verificar e Entrar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="flex flex-col items-center text-center">
          <Link
            to="/"
            className="flex items-center gap-2 font-bold text-3xl tracking-tighter text-primary mb-6"
          >
            <Building2 className="h-8 w-8" />
            <span>
              MERCADO<span className="text-muted-foreground font-light">IMOBI</span>
            </span>
          </Link>
          <h2 className="text-2xl font-bold tracking-tight">Bem-vindo à Inovação</h2>
          <p className="text-muted-foreground">7 dias grátis para transformar seu negócio.</p>
        </div>

        <Tabs defaultValue="login" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-8">
            <TabsTrigger value="login">Entrar</TabsTrigger>
            <TabsTrigger value="register">Cadastrar</TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <Card>
              <CardHeader>
                <CardTitle>Acessar Painel</CardTitle>
                <CardDescription>
                  Entre com seu e-mail e senha para gerenciar seus imóveis e leads.
                </CardDescription>
              </CardHeader>
              <form onSubmit={loginForm.handleSubmit(onLogin)}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">E-mail</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="email"
                        placeholder="seu@email.com"
                        className="pl-10"
                        {...loginForm.register("email")}
                      />
                    </div>
                    {loginForm.formState.errors.email && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {loginForm.formState.errors.email.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">Senha</Label>
                      <button
                        type="button"
                        onClick={handleResetPassword}
                        className="text-xs text-primary hover:underline bg-transparent border-none p-0 cursor-pointer"
                        disabled={isLoading}
                      >
                        Esqueceu a senha?
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="password"
                        type="password"
                        className="pl-10"
                        {...loginForm.register("password")}
                      />
                    </div>
                    {loginForm.formState.errors.password && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {loginForm.formState.errors.password.message}
                      </p>
                    )}
                  </div>
                </CardContent>
                <CardFooter>
                  <Button className="w-full" type="submit" disabled={isLoading}>
                    {isLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      "Entrar no Painel"
                    )}
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>

          <TabsContent value="register">
            <Card>
              <CardHeader>
                <CardTitle>Criar Conta</CardTitle>
                <CardDescription>Inicie seu teste de 7 dias grátis agora mesmo.</CardDescription>
              </CardHeader>
              <form onSubmit={registerForm.handleSubmit(onRegister)}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="fullName">Nome Completo</Label>
                    <Input
                      id="fullName"
                      placeholder="Como você quer ser chamado?"
                      {...registerForm.register("fullName")}
                    />
                    {registerForm.formState.errors.fullName && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {registerForm.formState.errors.fullName.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="companyName">Imobiliária / Organização</Label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="companyName"
                        placeholder="Nome da sua imobiliária"
                        className="pl-10"
                        {...registerForm.register("companyName")}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Cada organização tem dados totalmente isolados das demais.
                    </p>
                    {registerForm.formState.errors.companyName && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {registerForm.formState.errors.companyName.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-email">E-mail Profissional</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="reg-email"
                        placeholder="seu@email.com"
                        className="pl-10"
                        {...registerForm.register("email")}
                      />
                    </div>
                    {registerForm.formState.errors.email && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {registerForm.formState.errors.email.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-password">Senha</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="reg-password"
                        type="password"
                        className="pl-10"
                        {...registerForm.register("password")}
                      />
                    </div>
                    {registerForm.formState.errors.password && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {registerForm.formState.errors.password.message}
                      </p>
                    )}
                  </div>
                </CardContent>
                <CardFooter>
                  <Button className="w-full" type="submit" disabled={isLoading}>
                    {isLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      "Criar minha conta"
                    )}
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>
        </Tabs>

        <p className="px-8 text-center text-sm text-muted-foreground">
          Ao clicar em continuar, você concorda com nossos{" "}
          <Link to="/auth" className="underline underline-offset-4 hover:text-primary">
            Termos de Serviço
          </Link>{" "}
          e{" "}
          <Link to="/auth" className="underline underline-offset-4 hover:text-primary">
            Política de Privacidade
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
