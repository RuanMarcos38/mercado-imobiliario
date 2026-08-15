import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Shield, Search, Filter, Download, Activity, AlertTriangle, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { getFilteredAuditLogs, generateRetentionReport } from "@/lib/alerts.functions";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/audit")({
  component: AuditPage,
});

function AuditPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const failedAttempts = logs.filter((log) => log.event_type === "failed_attempt").length;
  const mfaEvents = logs.filter((log) => log.event_type === "mfa_verification");
  const successfulMfa = mfaEvents.filter((log) => log.success !== false).length;
  const mfaRate =
    mfaEvents.length > 0 ? Math.round((successfulMfa / mfaEvents.length) * 100) : null;

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const { logs: data } = await getFilteredAuditLogs({
        data: {
          eventType: filterType === "all" ? undefined : filterType,
          limit: 50,
        },
      });
      setLogs(data || []);
    } catch (error) {
      toast.error("Erro ao carregar logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [filterType]);

  const handleExportReport = async () => {
    try {
      const report = await generateRetentionReport({ data: { days: 30 } });
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `relatorio-retencao-${format(new Date(), "yyyy-MM-dd")}.json`;
      a.click();
      toast.success("Relatório gerado com sucesso");
    } catch (error) {
      toast.error("Erro ao gerar relatório");
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-8 w-8 text-primary" />
            Auditoria e Segurança Avançada
          </h1>
          <p className="text-muted-foreground">
            Monitoramento em tempo real, rate limiting e relatórios de conformidade.
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleExportReport} className="gap-2">
            <FileText className="h-4 w-4" />
            Relatório de Retenção
          </Button>
          <Button onClick={fetchLogs} disabled={loading} className="gap-2">
            <Activity className="h-4 w-4" />
            Atualizar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="bg-primary/5 border-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Status do Rate Limit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Configurado</div>
            <p className="text-xs text-muted-foreground">
              Validação RPC aplicada no fluxo de autenticação
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Tentativas Hoje
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{logs.length}</div>
            <p className="text-xs text-muted-foreground">Eventos carregados no lote atual</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              IPs Bloqueados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{failedAttempts}</div>
            <p className="text-xs text-muted-foreground">Falhas no lote atual de auditoria</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Alertas MFA
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mfaRate === null ? "—" : `${mfaRate}%`}</div>
            <p className="text-xs text-muted-foreground">Taxa baseada nos eventos MFA carregados</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <CardTitle>Logs de Auditoria</CardTitle>
              <CardDescription>
                Rastreamento detalhado de acessos e eventos de segurança.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="relative w-64">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por IP ou Usuário..."
                  className="pl-9"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-[180px]">
                  <Filter className="mr-2 h-4 w-4" />
                  <SelectValue placeholder="Tipo de Evento" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Eventos</SelectItem>
                  <SelectItem value="login">Login Sucesso</SelectItem>
                  <SelectItem value="failed_attempt">Falha de Login</SelectItem>
                  <SelectItem value="logout">Logout</SelectItem>
                  <SelectItem value="mfa_verification">MFA</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="relative overflow-x-auto border rounded-lg">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase bg-muted/50 border-b">
                <tr>
                  <th className="px-6 py-4">Data/Hora</th>
                  <th className="px-6 py-4">Evento</th>
                  <th className="px-6 py-4">IP</th>
                  <th className="px-6 py-4">Usuário/ID</th>
                  <th className="px-6 py-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground italic">
                      Carregando logs de segurança...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                      Nenhum log encontrado para os filtros selecionados.
                    </td>
                  </tr>
                ) : (
                  logs
                    .filter(
                      (log) =>
                        log.ip_address?.includes(searchTerm) ||
                        log.user_id?.includes(searchTerm) ||
                        log.event_type.includes(searchTerm),
                    )
                    .map((log) => (
                      <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-6 py-4 font-medium whitespace-nowrap">
                          {format(new Date(log.created_at), "dd/MM/yyyy HH:mm:ss", {
                            locale: ptBR,
                          })}
                        </td>
                        <td className="px-6 py-4">
                          <Badge
                            variant={
                              log.event_type === "failed_attempt" ? "destructive" : "outline"
                            }
                          >
                            {log.event_type}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 font-mono text-xs">{log.ip_address || "---"}</td>
                        <td className="px-6 py-4 text-muted-foreground">
                          {log.user_id ? log.user_id.substring(0, 8) + "..." : "Anônimo"}
                        </td>
                        <td className="px-6 py-4">
                          {log.event_type === "failed_attempt" ? (
                            <div className="flex items-center text-destructive gap-1 font-medium">
                              <AlertTriangle className="h-3 w-3" /> Bloqueado
                            </div>
                          ) : (
                            <div className="text-green-600 font-medium">Sucesso</div>
                          )}
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
