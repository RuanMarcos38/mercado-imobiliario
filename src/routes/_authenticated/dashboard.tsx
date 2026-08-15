import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Building2,
  Users,
  Home,
  Zap,
  ShieldCheck,
  Shield,
  Search,
  LayoutDashboard,
  LogOut,
  Bell,
  ArrowDownRight,
  Server,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { OnboardingGuide } from "@/components/OnboardingGuide";
import { getDashboardMetrics } from "@/lib/metrics.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: Dashboard });

function Dashboard() {
  const [user, setUser] = useState<any>(null);
  const navigate = useNavigate();
  const fetchMetrics = useServerFn(getDashboardMetrics);
  const metricsQuery = useQuery({
    queryKey: ["dashboard-metrics", user?.id],
    queryFn: () => fetchMetrics(),
    enabled: Boolean(user),
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) navigate({ to: "/auth" });
      else setUser(session.user);
    });
  }, [navigate]);

  const handleLogout = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user)
        await supabase
          .from("auth_audit_log")
          .insert({ event_type: "logout", user_id: session.user.id });
    } catch (error) {
      console.error("Erro ao registrar logout:", error);
    }
    await supabase.auth.signOut();
    toast.success("Sessão encerrada");
    navigate({ to: "/" });
  };

  if (!user) return null;
  const metrics = metricsQuery.data;
  const configured =
    metrics?.integrations.filter((item) => item.state === "configurada").length ?? 0;
  const integrationsTotal = metrics?.integrations.length ?? 0;

  return (
    <div className="flex min-h-screen bg-muted/20">
      <OnboardingGuide />
      <aside className="hidden lg:flex flex-col w-64 border-r bg-background shrink-0">
        <div className="p-6 border-b">
          <Link
            to="/"
            className="flex items-center gap-2 font-bold text-xl tracking-tighter text-primary"
          >
            <Building2 className="h-6 w-6" />
            <span>
              MERCADO<span className="text-muted-foreground font-light">IMOBI</span>
            </span>
          </Link>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          <NavItem icon={LayoutDashboard} label="Dashboard" to="/dashboard" active />
          <NavItem icon={Search} label="Buscar Imóveis" to="/dashboard" />
          <NavItem icon={Server} label="Gestão de VPS" to="/vps" />
          <NavItem
            icon={Users}
            label="Meus Leads"
            badge={String(metrics?.totals.leads ?? 0)}
            to="/dashboard"
          />
          <NavItem icon={ShieldCheck} label="Auditoria Avançada" to="/audit" />
          <NavItem icon={Shield} label="Segurança e MFA" to="/settings/security" />
          <NavItem icon={Home} label="Minhas Listas" to="/dashboard" />
          <NavItem
            icon={Zap}
            label="Conectar importação n8n"
            onClick={() => {
              const url = window.location.origin + "/api/public/hooks/n8n-webhook";
              void navigator.clipboard.writeText(url);
              toast.info("Endpoint n8n copiado", {
                description: "Configure N8N_WEBHOOK_SECRET antes de usar.",
              });
            }}
          />
        </nav>
        <div className="p-4 border-t space-y-4">
          <div className="rounded-xl bg-primary/5 p-4 border border-primary/10">
            <p className="text-xs font-bold text-primary uppercase mb-2 tracking-widest">
              Plano Profissional
            </p>
            <p className="text-sm text-muted-foreground mb-3 font-medium">
              Período de Trial: 7 dias grátis.
            </p>
            <Button size="sm" className="w-full">
              Assinar Agora
            </Button>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start text-destructive"
            onClick={handleLogout}
          >
            <LogOut className="mr-2 h-4 w-4" /> Sair
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background px-8">
          <h1 className="text-lg font-bold">Dashboard Operacional</h1>
          <div className="flex items-center gap-4">
            <Link to="/settings/security">
              <Button variant="ghost" size="icon">
                <Shield className="h-5 w-5" />
              </Button>
            </Link>
            <Button variant="ghost" size="icon">
              <Bell className="h-5 w-5" />
            </Button>
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs border">
              {user.email?.[0]?.toUpperCase()}
            </div>
          </div>
        </header>
        <div className="p-8 space-y-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">
                Olá, {user.user_metadata?.full_name || user.email}
              </h2>
              <p className="text-muted-foreground text-lg">Dados reais da sua organização.</p>
            </div>
            <div className="flex gap-3 flex-wrap">
              <Button
                variant="outline"
                onClick={async () => {
                  const { exportLeadsCsv } = await import("@/lib/ops.functions");
                  const csv = await exportLeadsCsv();
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `leads-${new Date().toISOString()}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <ArrowDownRight className="h-4 w-4 mr-2" />
                Exportar Leads
              </Button>
              <Button variant="outline" onClick={() => navigate({ to: "/audit" })}>
                <Shield className="h-4 w-4 mr-2" />
                Auditoria
              </Button>
              <Button onClick={() => window.open("/api/public/status", "_blank")}>
                <Zap className="h-4 w-4 mr-2" />
                Status
              </Button>
            </div>
          </div>

          {metricsQuery.isError && (
            <Card className="border-destructive">
              <CardContent className="p-4 text-sm text-destructive">
                Falha ao carregar métricas:{" "}
                {metricsQuery.error instanceof Error
                  ? metricsQuery.error.message
                  : "erro desconhecido"}
              </CardContent>
            </Card>
          )}

          <Card className="shadow-sm border-muted">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-lg">Gestão e Integração de Dados</CardTitle>
                <CardDescription>
                  Somente integrações com credencial configurada aparecem como ativas.
                </CardDescription>
              </div>
              <Badge variant="outline">
                {metricsQuery.isLoading
                  ? "Carregando"
                  : `${configured}/${integrationsTotal} configuradas`}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {(metrics?.integrations ?? []).slice(0, 4).map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-muted/10"
                  >
                    <div
                      className={`h-2 w-2 rounded-full ${item.state === "configurada" ? "bg-green-500" : "bg-muted-foreground/40"}`}
                    />
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">{item.state}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard
              title="Leads Totais"
              value={metricsQuery.isLoading ? "—" : String(metrics?.totals.leads ?? 0)}
              description="No seu tenant"
            />
            <StatCard
              title="Imóveis"
              value={metricsQuery.isLoading ? "—" : String(metrics?.totals.properties ?? 0)}
              description="Cadastrados"
            />
            <StatCard
              title="Imóveis Verificados"
              value={metricsQuery.isLoading ? "—" : String(metrics?.totals.verifiedProperties ?? 0)}
              description="Validados"
            />
            <StatCard
              title="Construtoras"
              value={metricsQuery.isLoading ? "—" : String(metrics?.totals.companies ?? 0)}
              description="Base nacional"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <Card className="lg:col-span-2 shadow-sm border-muted">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Fluxo de Leads e Imóveis</CardTitle>
                  <CardDescription>Últimos 7 dias</CardDescription>
                </div>
                <Badge variant="outline">Dados reais</Badge>
              </CardHeader>
              <CardContent>
                <div className="h-[350px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={metrics?.series ?? []}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} />
                      <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
                      <RechartsTooltip />
                      <Area
                        type="monotone"
                        dataKey="leads"
                        stroke="hsl(var(--primary))"
                        fill="hsl(var(--primary))"
                        fillOpacity={0.08}
                      />
                      <Line
                        type="monotone"
                        dataKey="imoveis"
                        stroke="hsl(var(--accent-foreground))"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card className="shadow-sm border-muted">
              <CardHeader>
                <CardTitle>Atividade Recente</CardTitle>
                <CardDescription>Eventos registrados no seu tenant</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {metricsQuery.isLoading && (
                  <p className="text-sm text-muted-foreground">Carregando...</p>
                )}
                {!metricsQuery.isLoading && (metrics?.activity.length ?? 0) === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhuma atividade registrada.</p>
                )}
                {metrics?.activity.map((item) => (
                  <ActivityItem
                    key={item.id}
                    title={item.title}
                    desc={item.desc}
                    time={formatRelative(item.createdAt)}
                  />
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

function formatRelative(iso: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `há ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} d`;
}
function NavItem({ icon: Icon, label, active = false, badge, onClick, to }: any) {
  const content = (
    <div
      onClick={onClick}
      className={`flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-colors ${active ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:bg-primary/10 hover:text-primary"}`}
    >
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5" />
        <span className="text-sm">{label}</span>
      </div>
      {badge && (
        <Badge variant={active ? "secondary" : "default"} className="h-5 px-1.5">
          {badge}
        </Badge>
      )}
    </div>
  );
  return to ? (
    <Link to={to} className="block no-underline">
      {content}
    </Link>
  ) : (
    content
  );
}
function StatCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <Card className="shadow-sm border-muted">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold mb-1">{value}</div>
        <span className="text-xs text-muted-foreground">{description}</span>
      </CardContent>
    </Card>
  );
}
function ActivityItem({ title, desc, time }: { title: string; desc: string; time: string }) {
  return (
    <div className="flex gap-4">
      <div className="mt-1 h-2 w-2 rounded-full shrink-0 bg-primary" />
      <div className="space-y-1">
        <p className="text-sm font-semibold leading-none">{title}</p>
        <p className="text-xs text-muted-foreground leading-snug">{desc}</p>
        <p className="text-[10px] font-bold text-muted-foreground/60 uppercase">{time}</p>
      </div>
    </div>
  );
}
