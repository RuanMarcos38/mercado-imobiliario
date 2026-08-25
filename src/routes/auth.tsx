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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const loginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(6, "A senha deve ter pelo menos 6 caracteres"),
});

const registerSchema = loginSchema.extend({
  fullName: z.string().min(3, "Nome completo é obrigatório"),
  userType: z.enum(["cliente", "corretor"]),
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
  const requestedNext = (searchParams as any).next;
  const next =
    typeof requestedNext === "string" &&
    requestedNext.startsWith("/") &&
    !requestedNext.startsWith("//")
      ? requestedNext
      : "/dashboard";
  const type = (searchParams as any).type;
  const isRecovery = type === "recovery";

  const loginForm = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const registerForm = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: "",
      password: "",
      fullName: "",
      userType: "cliente",
    },
  });

  async function onLogin(values: z.infer<typeof loginSchema>) {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });
      if (error) throw error;

      const { data: assurance, error: assuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;

      if (assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
        setShowMfa(true);
        setMfaCode("");
        return;
      }

      toast.success("Login realizado com sucesso.");
      navigate({ to: next });
    } catch (error: any) {
      const message = String(error?.message ?? "").toLowerCase();
      if (
        message.includes("invalid login credentials") ||
        message.includes("invalid credentials")
      ) {
        toast.error("E-mail ou senha inválidos.");
      } else if (message.includes("email not confirmed")) {
        toast.error("Confirme seu e-mail antes de entrar.");
      } else {
        toast.error("Não foi possível entrar agora. Tente novamente em instantes.");
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleMfaVerify() {
    setIsLoading(true);
    try {
      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
      if (factorsError) throw factorsError;
      const factor = factors?.all.find((item) => item.status === "verified");
      if (!factor) {
        toast.error("Não foi possível localizar sua verificação em duas etapas.");
        return;
      }

      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code: mfaCode,
      });
      if (error) throw error;

      toast.success("Verificação concluída. Bem-vindo!");
      setShowMfa(false);
      setMfaCode("");
      navigate({ to: next });
    } catch {
      toast.error("Código inválido ou expirado. Confira e tente novamente.");
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
      toast.error("Não foi possível enviar o e-mail de recuperação agora.");
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
      toast.error("Não foi possível atualizar a senha agora.");
    } finally {
      setIsLoading(false);
    }
  }

  async function onRegister(values: z.infer<typeof registerSchema>) {
    setIsLoading(true);
    try {
      const referralCode =
        typeof (searchParams as any).ref === "string"
          ? String((searchParams as any).ref).trim()
          : "";
      const { error } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            full_name: values.fullName,
            user_type: values.userType,
            referral_code: referralCode || undefined,
          },
        },
      });

      if (error) throw error;
      toast.success("Conta criada. Verifique seu e-mail para continuar.");
    } catch {
      toast.error("Não foi possível criar sua conta agora. Confira os dados e tente novamente.");
    } finally {
      setIsLoading(false);
    }
  }

  if (isRecovery) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#06101c] px-4 py-12 text-white">
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

          <Card className="border-white/10 bg-white/[0.045] text-white shadow-2xl shadow-black/20">
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
    <div className="flex min-h-screen items-center justify-center bg-[#06101c] px-4 py-12 text-white">
      <div className="w-full max-w-md space-y-8">
        <Dialog open={showMfa} onOpenChange={setShowMfa}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Verificação em duas etapas</DialogTitle>
              <DialogDescription>
                Insira o código de 6 dígitos do seu aplicativo autenticador.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="verification-code">Código de verificação</Label>
                <Input
                  id="verification-code"
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
          <h2 className="text-2xl font-bold tracking-tight">
            Encontre imóveis com mais inteligência
          </h2>
          <p className="text-muted-foreground">Pesquise, compare e salve imóveis em um só lugar.</p>
        </div>

        <Tabs defaultValue="login" className="w-full">
          <TabsList className="mb-8 grid w-full grid-cols-2 bg-white/[0.06]">
            <TabsTrigger value="login">Entrar</TabsTrigger>
            <TabsTrigger value="register">Cadastrar</TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <Card className="border-white/10 bg-white/[0.045] text-white shadow-2xl shadow-black/20">
              <CardHeader>
                <CardTitle>Acessar MercadoImobi</CardTitle>
                <CardDescription>
                  Entre com seu e-mail e senha para continuar suas pesquisas e favoritos.
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
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Entrar"}
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>

          <TabsContent value="register">
            <Card className="border-white/10 bg-white/[0.045] text-white shadow-2xl shadow-black/20">
              <CardHeader>
                <CardTitle>Criar Conta</CardTitle>
                <CardDescription>Crie sua conta para pesquisar e salvar imóveis.</CardDescription>
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
                    <Label htmlFor="userType">Como você vai usar a plataforma?</Label>
                    <select
                      id="userType"
                      {...registerForm.register("userType")}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="cliente">Estou buscando um imóvel</option>
                      <option value="corretor">Sou corretor de imóveis</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-email">E-mail</Label>
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

        <p className="px-8 text-center text-xs leading-relaxed text-muted-foreground">
          Use dados verdadeiros no cadastro. Seus favoritos e pesquisas ficam associados à sua
          conta.
        </p>
      </div>
    </div>
  );
}
