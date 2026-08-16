import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Building2, KeyRound, LogOut, Mail, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings/security")({
  component: AccountPage,
  head: () => ({ title: "Minha conta | MercadoImobi" }),
});

function AccountPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) navigate({ to: "/auth" });
      else setUser(session.user);
    });
  }, [navigate]);

  const updatePassword = async () => {
    if (password.length < 8) {
      toast.error("Use uma senha com pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("As senhas não são iguais.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (error) {
      toast.error("Não foi possível atualizar sua senha agora.");
      return;
    }

    setPassword("");
    setConfirmPassword("");
    toast.success("Senha atualizada com sucesso.");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-[var(--mi-bg)] text-[var(--mi-text)]">
      <header className="border-b border-[var(--mi-border)] bg-[var(--mi-bg)]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link to="/dashboard" className="flex items-center gap-2 font-bold">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-600/10 text-blue-600 ring-1 ring-blue-500/20">
              <Building2 className="h-5 w-5" />
            </span>
            <span>
              Mercado<span className="text-blue-600">Imobi</span>
            </span>
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--mi-border)] px-3 py-2 text-sm text-[var(--mi-text-muted)] hover:bg-white/5"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar para busca
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
        <div className="mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Sua conta</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">Preferências e acesso</h1>
          <p className="mt-2 text-[var(--mi-text-muted)]">
            Gerencie suas informações de acesso ao MercadoImobi.
          </p>
        </div>

        <div className="space-y-5">
          <Card className="rounded-3xl border-[var(--mi-border)] bg-[var(--mi-surface)] text-[var(--mi-text)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRound className="h-5 w-5 text-blue-600" /> Seus dados
              </CardTitle>
              <CardDescription className="text-[var(--mi-text-muted)]">
                Informações usadas para identificar sua conta.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-4">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--mi-text-soft)]">
                  Nome
                </span>
                <p className="mt-2 font-semibold">
                  {user.user_metadata?.full_name || "Usuário MercadoImobi"}
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-4">
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--mi-text-soft)]">
                  <Mail className="h-3.5 w-3.5" /> E-mail
                </span>
                <p className="mt-2 break-all font-semibold">{user.email}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-[var(--mi-border)] bg-[var(--mi-surface)] text-[var(--mi-text)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-blue-600" /> Alterar senha
              </CardTitle>
              <CardDescription className="text-[var(--mi-text-muted)]">
                Escolha uma nova senha para acessar sua conta.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password" className="text-[var(--mi-text-muted)]">
                  Nova senha
                </Label>
                <Input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="border-[var(--mi-border)] bg-[var(--mi-surface-soft)] text-[var(--mi-text)]"
                  placeholder="Mínimo de 8 caracteres"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password" className="text-[var(--mi-text-muted)]">
                  Confirmar nova senha
                </Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="border-[var(--mi-border)] bg-[var(--mi-surface-soft)] text-[var(--mi-text)]"
                  placeholder="Digite novamente"
                />
              </div>
              <Button
                onClick={() => void updatePassword()}
                disabled={saving || !password || !confirmPassword}
                className="bg-blue-600 font-bold text-white hover:bg-blue-700"
              >
                {saving ? "Salvando..." : "Atualizar senha"}
              </Button>
            </CardContent>
          </Card>

          <button
            onClick={() => void signOut()}
            className="inline-flex items-center gap-2 rounded-xl border border-rose-300/15 px-4 py-2.5 text-sm font-semibold text-rose-200 transition hover:bg-rose-400/[0.06]"
          >
            <LogOut className="h-4 w-4" /> Sair da conta
          </button>
        </div>
      </main>
    </div>
  );
}
