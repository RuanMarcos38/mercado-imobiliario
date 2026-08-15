import { createFileRoute } from "@tanstack/react-router";
import {
  Server,
  Cpu,
  HardDrive,
  Activity,
  Plus,
  Settings,
  Terminal,
  Globe,
  Lock,
  Box,
  RefreshCw,
  Layout,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { configureVps, listVpsServers } from "@/lib/vps.functions";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/vps")({ component: VpsManagement });

function VpsManagement() {
  const configure = useServerFn(configureVps);
  const fetchServers = useServerFn(listVpsServers);
  const {
    data: vpsList,
    isLoading,
    refetch,
  } = useQuery({ queryKey: ["vps-servers"], queryFn: () => fetchServers() });

  const handleAction = (
    vpsId: string,
    action:
      | "install_node"
      | "install_docker"
      | "setup_nginx"
      | "setup_ssl"
      | "deploy_project"
      | "restart_services"
      | "setup_firewall",
    label: string,
  ) => {
    toast.promise(configure({ data: { vpsId, action } }), {
      loading: `Executando: ${label}...`,
      success: (res) => res.message,
      error: (err: Error) => err.message || "Falha ao iniciar automação.",
    });
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gestão de VPS</h1>
          <p className="text-muted-foreground">Automação de servidores e deploy profissional.</p>
        </div>
        <Button className="flex gap-2" onClick={() => void refetch()}>
          <Plus className="h-4 w-4" /> Atualizar lista
        </Button>
      </div>

      {isLoading && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Carregando servidores cadastrados...
          </CardContent>
        </Card>
      )}
      {!isLoading && (vpsList?.length ?? 0) === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center space-y-2">
            <Server className="h-8 w-8 mx-auto text-muted-foreground" />
            <h2 className="font-semibold">Nenhuma VPS cadastrada</h2>
            <p className="text-sm text-muted-foreground">
              Cadastre uma VPS e vincule a credencial SSH/API nos segredos do backend para habilitar
              automações reais.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {(vpsList ?? []).map((vps) => (
          <Card
            key={vps.id}
            className="overflow-hidden border-muted shadow-sm hover:shadow-md transition-shadow"
          >
            <CardHeader className="bg-muted/30 pb-4">
              <div className="flex justify-between items-start">
                <div className="flex gap-3 items-center">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary">
                    <Server className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{vps.name}</CardTitle>
                    <CardDescription>
                      {vps.ip_address} • {vps.provider ?? "provedor não informado"}
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="outline">{(vps.status ?? "desconhecido").toUpperCase()}</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="grid grid-cols-3 gap-4">
                <MetricItem icon={Cpu} label="CPU" />
                <MetricItem icon={Activity} label="RAM" />
                <MetricItem icon={HardDrive} label="Disco" />
              </div>
              <p className="text-xs text-muted-foreground">
                Métricas aparecem somente quando o coletor SSH/API estiver configurado. Nenhum valor
                é simulado.
              </p>
              <div className="space-y-3 pt-4 border-t">
                <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Automação e Configuração
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <ActionButton
                    icon={Box}
                    label="Docker"
                    onClick={() => handleAction(vps.id, "install_docker", "Instalar Docker")}
                  />
                  <ActionButton
                    icon={Layout}
                    label="Nginx"
                    onClick={() => handleAction(vps.id, "setup_nginx", "Configurar Nginx")}
                  />
                  <ActionButton
                    icon={Lock}
                    label="SSL"
                    onClick={() => handleAction(vps.id, "setup_ssl", "Gerar SSL")}
                  />
                  <ActionButton
                    icon={RefreshCw}
                    label="Restart"
                    onClick={() => handleAction(vps.id, "restart_services", "Reiniciar Serviços")}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Button
                    variant="secondary"
                    className="w-full flex gap-2"
                    onClick={() => handleAction(vps.id, "deploy_project", "Fazer Deploy")}
                  >
                    <Globe className="h-4 w-4" /> Deploy do Projeto
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full flex gap-2"
                    onClick={() =>
                      toast.info(
                        "Logs SSH/API disponíveis quando o worker de automação estiver configurado.",
                      )
                    }
                  >
                    <Terminal className="h-4 w-4" /> Acessar Logs
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-6">
          <div className="flex gap-4">
            <div className="p-2 rounded-full bg-primary/10 text-primary h-fit">
              <Settings className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-primary">Arquitetura de Automação Profissional</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Frontend → Backend → SSH/API → VPS. As ações ficam auditadas e só executam quando
                houver credencial e worker configurados.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricItem({ icon: Icon, label }: { icon: typeof Cpu; label: string }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-[10px] font-bold uppercase text-muted-foreground">
        <span className="flex items-center gap-1">
          <Icon className="h-3 w-3" /> {label}
        </span>
        <span>—</span>
      </div>
      <Progress value={0} className="h-1.5" />
    </div>
  );
}
function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Cpu;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="flex flex-col h-16 gap-1 border-dashed"
      onClick={onClick}
    >
      <Icon className="h-4 w-4" />
      <span className="text-[10px] uppercase font-bold">{label}</span>
    </Button>
  );
}
