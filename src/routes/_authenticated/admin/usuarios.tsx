import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  Clock3,
  KeyRound,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createPlatformUser,
  listPlatformUsers,
  updatePlatformUser,
  type PlatformUser,
} from "@/lib/platform-admin.functions";
import { getAdminRealtimeUsage, listAdminActivityLogs } from "@/lib/user-activity.functions";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  component: AdminUsersPage,
  head: () => ({ title: "Usuários | Administração MercadoImobi" }),
});

const statusLabels: Record<string, string> = {
  trialing: "Teste",
  active: "Ativa",
  past_due: "Pendente",
  canceled: "Cancelada",
  unpaid: "Sem pagamento",
};

function randomPassword() {
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  return Array.from({ length: 14 }, () => alpha[Math.floor(Math.random() * alpha.length)]).join("");
}

function AdminUsersPage() {
  const listFn = useServerFn(listPlatformUsers);
  const createFn = useServerFn(createPlatformUser);
  const updateFn = useServerFn(updatePlatformUser);
  const usageFn = useServerFn(getAdminRealtimeUsage);
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
  });
  useEffect(() => {
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
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: randomPassword(),
    userType: "corretor",
    companyName: "",
    subscriptionStatus: "trialing",
    trialDays: 7,
  });

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return users.data ?? [];
    return (users.data ?? []).filter((user) =>
      [user.fullName, user.email, user.companyName, user.tenantName]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(value)),
    );
  }, [query, users.data]);

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([users.refetch(), usage.refetch(), activity.refetch()]);
      toast.success("Usuários, acessos e sessões atualizados.");
    } catch {
      toast.error("Não foi possível atualizar os dados agora.");
    } finally {
      setRefreshing(false);
    }
  };

  const create = async () => {
    setSaving(true);
    try {
      await createFn({
        data: {
          email: form.email,
          password: form.password,
          fullName: form.fullName,
          userType: form.userType as any,
          companyName: form.companyName || undefined,
          isActive: true,
          subscriptionStatus: form.subscriptionStatus as any,
          trialDays: Number(form.trialDays),
        },
      });
      toast.success("Usuário criado com ambiente isolado.");
      setOpen(false);
      setForm({
        fullName: "",
        email: "",
        password: randomPassword(),
        userType: "corretor",
        companyName: "",
        subscriptionStatus: "trialing",
        trialDays: 7,
      });
      await users.refetch();
    } catch (error) {
      const message = String((error as Error)?.message ?? "");
      toast.error(
        message.includes("FORBIDDEN_ADMIN")
          ? "Acesso restrito ao administrador."
          : message || "Não foi possível criar o usuário.",
      );
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (user: PlatformUser) => {
    try {
      await updateFn({ data: { userId: user.id, isActive: !user.isActive } });
      toast.success(user.isActive ? "Acesso suspenso." : "Acesso reativado.");
      await users.refetch();
    } catch {
      toast.error("Não foi possível alterar o acesso.");
    }
  };

  const changeSubscription = async (user: PlatformUser, status: string) => {
    try {
      await updateFn({ data: { userId: user.id, subscriptionStatus: status as any } });
      toast.success("Status da assinatura atualizado.");
      await users.refetch();
    } catch {
      toast.error("Não foi possível atualizar a assinatura.");
    }
  };

  const sendPasswordReset = async (user: PlatformUser) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/auth?type=recovery`,
      });
      if (error) throw error;
      toast.success(`Redefinição de senha enviada para ${user.email}.`);
    } catch {
      toast.error("Não foi possível enviar a redefinição de senha.");
    }
  };

  if (users.error && String(users.error).includes("FORBIDDEN_ADMIN")) {
    return (
      <div className="grid min-h-[calc(100vh-56px)] place-items-center bg-[var(--mi-bg)] p-6">
        <div className="max-w-md rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-8 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-blue-600" />
          <h1 className="mt-4 text-xl font-black">Área restrita</h1>
          <p className="mt-2 text-sm text-[var(--mi-text-muted)]">
            Somente o administrador global da plataforma pode criar e gerenciar usuários.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1500px]">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">
              Administração
            </p>
            <h1 className="mt-2 text-3xl font-black">Usuários e assinantes</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--mi-text-muted)]">
              Crie acessos, acompanhe assinaturas e suspenda contas. Cada novo usuário recebe sua
              própria organização para impedir mistura de dados.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void refreshAll()} disabled={refreshing}>
              <RefreshCcw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Atualizando..." : "Atualizar"}
            </Button>
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Novo usuário
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Usuários" value={users.data?.length ?? 0} />
          <Metric
            label="Ativos"
            value={(users.data ?? []).filter((user) => user.isActive).length}
          />
          <Metric
            label="Assinaturas ativas"
            value={(users.data ?? []).filter((user) => user.subscriptionStatus === "active").length}
          />
          <Metric label="Online agora" value={usage.data?.onlineUsers ?? 0} />
          <Metric label="Sessões online" value={usage.data?.onlineSessions ?? 0} />
        </div>

        <section className="mt-6 overflow-hidden rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)]">
          <div className="flex flex-col gap-3 border-b border-[var(--mi-border)] p-4 sm:flex-row sm:items-center">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--mi-text-soft)]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar nome, e-mail ou imobiliária..."
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--mi-text-muted)]">
              <Users className="h-4 w-4" /> {filtered.length} registros
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead className="bg-[var(--mi-bg)] text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
                <tr>
                  <th className="px-5 py-3">Usuário</th>
                  <th className="px-5 py-3">Perfil</th>
                  <th className="px-5 py-3">Organização</th>
                  <th className="px-5 py-3">Assinatura</th>
                  <th className="px-5 py-3">Acesso</th>
                  <th className="px-5 py-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr key={user.id} className="border-t border-[var(--mi-border)]">
                    <td className="px-5 py-4">
                      <p className="font-black">{user.fullName || "Sem nome"}</p>
                      <p className="mt-1 text-xs text-[var(--mi-text-muted)]">{user.email}</p>
                      <p className="mt-1 text-[10px] text-[var(--mi-text-soft)]">
                        {user.lastSignInAt
                          ? `Último acesso: ${new Date(user.lastSignInAt).toLocaleString("pt-BR")}`
                          : "Nunca acessou"}
                      </p>
                    </td>
                    <td className="px-5 py-4 capitalize">{user.userType || "—"}</td>
                    <td className="px-5 py-4">
                      <p className="font-semibold">
                        {user.tenantName || user.companyName || "Conta individual"}
                      </p>
                      <p className="mt-1 text-xs text-[var(--mi-text-soft)]">
                        {user.memberRole || "owner"}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <select
                        value={user.subscriptionStatus || "trialing"}
                        onChange={(event) => void changeSubscription(user, event.target.value)}
                        className="rounded-lg border border-[var(--mi-border)] bg-[var(--mi-bg)] px-2 py-2 text-xs font-bold outline-none"
                      >
                        {Object.entries(statusLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-black ${user.isActive ? "bg-emerald-500/10 text-emerald-700" : "bg-rose-500/10 text-rose-700"}`}
                      >
                        {user.isActive ? "ATIVO" : "SUSPENSO"}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => void toggle(user)}>
                          {user.isActive ? "Suspender" : "Reativar"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void sendPasswordReset(user)}
                          title="Enviar redefinição de senha"
                        >
                          <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Senha
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!users.isLoading && filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-5 py-14 text-center text-sm text-[var(--mi-text-muted)]"
                    >
                      Nenhum usuário encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="overflow-hidden rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)]">
          <div className="flex items-center justify-between border-b border-[var(--mi-border)] p-4">
            <div>
              <p className="text-xs font-black">Usuários online em tempo real</p>
              <p className="mt-1 text-[11px] text-[var(--mi-text-muted)]">
                Ativo = heartbeat recebido nos últimos 90 segundos.
              </p>
            </div>
            <Activity className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="max-h-[420px] overflow-auto">
            {(usage.data?.sessions ?? []).map((session) => {
              const user = userById.get(session.userId);
              return (
                <div
                  key={`${session.userId}:${session.sessionId}`}
                  className="flex items-center justify-between gap-3 border-t border-[var(--mi-border)] px-4 py-3 text-sm"
                >
                  <div>
                    <p className="font-bold">
                      {user?.fullName || user?.email || session.userId.slice(0, 8)}
                    </p>
                    <p className="text-xs text-[var(--mi-text-muted)]">
                      {session.currentPath || "/"}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-black text-emerald-700">
                      ONLINE
                    </span>
                    <p className="mt-1 text-[10px] text-[var(--mi-text-soft)]">
                      {new Date(session.lastSeenAt).toLocaleTimeString("pt-BR")}
                    </p>
                  </div>
                </div>
              );
            })}
            {!usage.isLoading && (usage.data?.sessions?.length ?? 0) === 0 && (
              <p className="p-6 text-center text-sm text-[var(--mi-text-muted)]">
                Nenhum usuário online agora.
              </p>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)]">
          <div className="flex items-center justify-between border-b border-[var(--mi-border)] p-4">
            <div>
              <p className="text-xs font-black">Histórico de uso</p>
              <p className="mt-1 text-[11px] text-[var(--mi-text-muted)]">
                Sessões, páginas acessadas e saídas registradas.
              </p>
            </div>
            <Clock3 className="h-5 w-5 text-blue-600" />
          </div>
          <div className="max-h-[420px] overflow-auto">
            {(activity.data ?? []).map((log) => {
              const user = userById.get(log.userId);
              return (
                <div key={log.id} className="border-t border-[var(--mi-border)] px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-bold">
                      {user?.fullName || user?.email || log.userId.slice(0, 8)}
                    </p>
                    <span className="text-[10px] text-[var(--mi-text-soft)]">
                      {new Date(log.createdAt).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--mi-text-muted)]">
                    {log.eventType} · {log.path || "—"}
                  </p>
                </div>
              );
            })}
            {!activity.isLoading && (activity.data?.length ?? 0) === 0 && (
              <p className="p-6 text-center text-sm text-[var(--mi-text-muted)]">
                O histórico será preenchido conforme os usuários navegam.
              </p>
            )}
          </div>
        </div>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Criar novo acesso</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome completo">
              <Input
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </Field>
            <Field label="E-mail">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Senha inicial">
              <div className="flex gap-2">
                <Input
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setForm({ ...form, password: randomPassword() })}
                  title="Gerar senha"
                >
                  <KeyRound className="h-4 w-4" />
                </Button>
              </div>
            </Field>
            <Field label="Tipo de usuário">
              <select
                value={form.userType}
                onChange={(e) => setForm({ ...form, userType: e.target.value })}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="corretor">Corretor</option>
                <option value="imobiliaria">Imobiliária</option>
                <option value="construtora">Construtora</option>
                <option value="proprietario">Proprietário</option>
                <option value="cliente">Cliente</option>
                <option value="admin">Administrador</option>
              </select>
            </Field>
            <Field label="Empresa / imobiliária">
              <Input
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
              />
            </Field>
            <Field label="Assinatura inicial">
              <select
                value={form.subscriptionStatus}
                onChange={(e) => setForm({ ...form, subscriptionStatus: e.target.value })}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="trialing">Período de teste</option>
                <option value="active">Ativa</option>
                <option value="unpaid">Aguardando pagamento</option>
              </select>
            </Field>
            {form.subscriptionStatus === "trialing" && (
              <Field label="Dias de teste">
                <Input
                  type="number"
                  min={0}
                  max={90}
                  value={form.trialDays}
                  onChange={(e) => setForm({ ...form, trialDays: Number(e.target.value) })}
                />
              </Field>
            )}
          </div>
          <div className="mt-2 rounded-xl border border-blue-500/20 bg-blue-500/[0.05] p-3 text-xs leading-5 text-[var(--mi-text-muted)]">
            O cadastro cria uma organização própria para o usuário. O administrador global gerencia
            a conta, mas os dados operacionais permanecem separados por tenant e usuário.
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void create()}
              disabled={saving || !form.fullName || !form.email || form.password.length < 8}
            >
              {saving ? "Criando..." : "Criar usuário"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--mi-text-soft)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
