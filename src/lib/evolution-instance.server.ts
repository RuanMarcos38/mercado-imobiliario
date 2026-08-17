type DbClient = any;

export type EvolutionGatewayConfig = {
  baseUrl: string;
  apiKey: string;
};

export function evolutionGatewayConfig(): EvolutionGatewayConfig | null {
  const baseUrl = process.env["EVOLUTION_API_URL"]?.trim().replace(/\/$/, "");
  const apiKey = process.env["EVOLUTION_API_KEY"]?.trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
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
    signal: AbortSignal.timeout(20_000),
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
