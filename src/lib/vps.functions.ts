import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const vpsActionSchema = z.object({
  vpsId: z.string().uuid(),
  action: z.enum([
    "install_node",
    "install_docker",
    "setup_nginx",
    "setup_ssl",
    "deploy_project",
    "restart_services",
    "setup_firewall",
  ]),
});

export interface VpsServerRow {
  readonly id: string;
  readonly name: string;
  readonly ip_address: string;
  readonly provider: string | null;
  readonly status: string | null;
  readonly ssh_key_secret_name: string | null;
}

export const listVpsServers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<readonly VpsServerRow[]> => {
    const { data, error } = await context.supabase
      .from("vps_servers")
      .select("id, name, ip_address, provider, status, ssh_key_secret_name")
      .eq("owner_id", context.userId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const configureVps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => vpsActionSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: server, error } = await context.supabase
      .from("vps_servers")
      .select("id, ssh_key_secret_name")
      .eq("id", data.vpsId)
      .eq("owner_id", context.userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!server) throw new Error("VPS não encontrada para este usuário.");

    const jobId = crypto.randomUUID();
    const credentialName = server.ssh_key_secret_name;
    const hasCredential = Boolean(credentialName && process.env[credentialName]);

    const { error: logError } = await context.supabase.from("vps_automation_logs").insert({
      vps_id: data.vpsId,
      action: data.action,
      status: hasCredential ? "queued" : "blocked_missing_credential",
      output: hasCredential
        ? `Job ${jobId} registrado para execução pelo worker SSH/API.`
        : "Credencial SSH/API ausente no ambiente do servidor.",
    });
    if (logError) throw new Error(logError.message);

    if (!hasCredential) {
      return {
        success: false,
        status: "nao_configurada" as const,
        jobId,
        message:
          "Automação não configurada: vincule a credencial SSH/API desta VPS aos segredos do backend.",
      };
    }

    return {
      success: true,
      status: "enfileirada" as const,
      jobId,
      message: `Ação ${data.action} enfileirada. O worker SSH/API deve consumir este job.`,
    };
  });

export const getVpsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ vpsId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: server, error } = await context.supabase
      .from("vps_servers")
      .select("id, status, ssh_key_secret_name")
      .eq("id", data.vpsId)
      .eq("owner_id", context.userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!server) return { configured: false as const, reason: "VPS não encontrada." };

    const credentialName = server.ssh_key_secret_name;
    if (!credentialName || !process.env[credentialName]) {
      return {
        configured: false as const,
        reason: "Coleta de métricas não configurada (credencial SSH/API ausente).",
      };
    }

    return {
      configured: false as const,
      reason:
        "Credencial presente, mas o coletor SSH/API precisa estar ativo para fornecer CPU, RAM e disco reais.",
    };
  });
