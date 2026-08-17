import { whatsappParameters } from "@/lib/platform-parameters.server";

type DbClient = any;

export type EvolutionGatewayConfig = {
  baseUrl: string;
  apiKey: string;
};

function firstEnv(names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

/**
 * Resolve o gateway Evolution sem depender de um único nome de variável.
 *
 * EasyPanel/Evolution costuma expor a chave global como AUTHENTICATION_API_KEY,
 * enquanto instalações antigas do MercadoImobi usam EVOLUTION_API_KEY. Mantemos
 * compatibilidade com ambos sem mudar o frontend ou o modelo multi-tenant.
 */
export function evolutionGatewayConfig(): EvolutionGatewayConfig | null {
  const baseUrl = firstEnv([
    "EVOLUTION_API_URL",
    "EVOLUTION_URL",
    "EVOLUTION_SERVER_URL",
    "EVOLUTION_BASE_URL",
  ]).replace(/\/$/, "");
  const apiKey = firstEnv([
    "EVOLUTION_API_KEY",
    "EVOLUTION_GLOBAL_API_KEY",
    "AUTHENTICATION_API_KEY",
  ]);
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

export function evolutionGatewayDiagnostics() {
  return {
    configured: Boolean(evolutionGatewayConfig()),
    hasUrl: Boolean(
      firstEnv(["EVOLUTION_API_URL", "EVOLUTION_URL", "EVOLUTION_SERVER_URL", "EVOLUTION_BASE_URL"]),
    ),
    hasApiKey: Boolean(
      firstEnv(["EVOLUTION_API_KEY", "EVOLUTION_GLOBAL_API_KEY", "AUTHENTICATION_API_KEY"]),
    ),
  } as const;
}

export async function evolutionRequest(
  config: EvolutionGatewayConfig,
  path: string,
  init?: RequestInit,
) {
  return fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: config.apiKey,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(whatsappParameters().evolutionTimeoutMs),
  });
}

export async function getTenantEvolutionInstance(
  db: DbClient,
  tenantId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("whatsapp_connections")
    .select("instance_name")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.instance_name ? String(data.instance_name) : null;
}

export function generatedEvolutionInstanceName(tenantId: string) {
  const compact = tenantId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return `mercadoimobi-${compact.slice(0, 20)}`;
}

export async function getTenantEvolutionRuntime(db: DbClient, tenantId: string) {
  const config = evolutionGatewayConfig();
  if (!config) return null;
  const instance = await getTenantEvolutionInstance(db, tenantId);
  if (!instance) return null;
  return { ...config, instance };
}
