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
    <div className="min-h-screen bg-[#07111f] text-white">
      <header className="border-b border-white/10 bg-[#07111f]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link to="/dashboard" className="flex items-center gap-2 font-bold">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-300/10 text-cyan-200 ring-1 ring-cyan-300/20">
              <Building2 className="h-5 w-5" />
            </span>
            <span>Mercado<span className="text-cyan-300">Imobi</span></span>
          </Link>
          <Link to="/dashboard" className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5">
            <ArrowLeft className="h-4 w-4" /> Voltar para busca
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
        <div className="mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">Sua conta</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">Preferências e acesso</h1>
          <p className="mt-2 text-slate-400">Gerencie suas informações de acesso ao MercadoImobi.</p>
        </div>

        <div className="space-y-5">
          <Card className="rounded-3xl border-white/10 bg-white/[0.04] text-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><UserRound className="h-5 w-5 text-cyan-300" /> Seus dados</CardTitle>
              <CardDescription className="text-slate-400">Informações usadas para identificar sua conta.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Nome</span>
                <p className="mt-2 font-semibold">{user.user_metadata?.full_name || "Usuário MercadoImobi"}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500"><Mail className="h-3.5 w-3.5" /> E-mail</span>
                <p className="mt-2 break-all font-semibold">{user.email}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-white/10 bg-white/[0.04] text-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-cyan-300" /> Alterar senha</CardTitle>
              <CardDescription className="text-slate-400">Escolha uma nova senha para acessar sua conta.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password" className="text-slate-300">Nova senha</Label>
                <Input id="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="border-white/10 bg-black/15 text-white" placeholder="Mínimo de 8 caracteres" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password" className="text-slate-300">Confirmar nova senha</Label>
                <Input id="confirm-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="border-white/10 bg-black/15 text-white" placeholder="Digite novamente" />
              </div>
              <Button onClick={() => void updatePassword()} disabled={saving || !password || !confirmPassword} className="bg-cyan-300 font-bold text-[#06101c] hover:bg-cyan-200">
                {saving ? "Salvando..." : "Atualizar senha"}
              </Button>
            </CardContent>
          </Card>

          <button onClick={() => void signOut()} className="inline-flex items-center gap-2 rounded-xl border border-rose-300/15 px-4 py-2.5 text-sm font-semibold text-rose-200 transition hover:bg-rose-400/[0.06]">
            <LogOut className="h-4 w-4" /> Sair da conta
          </button>
        </div>
      </main>
    </div>
  );
}
