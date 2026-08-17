import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";

type EvolutionState = "connected" | "connecting" | "disconnected" | "error";

type EvolutionConfig = {
  baseUrl: string;
  apiKey: string;
  instance: string;
};

function evolutionConfig(): EvolutionConfig | null {
  const baseUrl = process.env["EVOLUTION_API_URL"]?.trim().replace(/\/$/, "");
  const apiKey = process.env["EVOLUTION_API_KEY"]?.trim();
  const instance = process.env["EVOLUTION_INSTANCE"]?.trim();
  if (!baseUrl || !apiKey || !instance) return null;
  return { baseUrl, apiKey, instance };
}

async function evolutionRequest(config: EvolutionConfig, path: string, init?: RequestInit) {
  return fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: config.apiKey,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
}

function normalizeState(payload: unknown): EvolutionState {
  if (!payload || typeof payload !== "object") return "error";
  const object = payload as Record<string, unknown>;
  const instance =
    object["instance"] && typeof object["instance"] === "object"
      ? (object["instance"] as Record<string, unknown>)
      : object;
  const raw = String(instance["state"] ?? instance["status"] ?? "").toLowerCase();
  if (["open", "connected", "online"].includes(raw)) return "connected";
  if (["connecting", "qrcode", "qr", "pairing"].includes(raw)) return "connecting";
  if (["close", "closed", "disconnected", "offline"].includes(raw)) return "disconnected";
  return "error";
}

function webhookUrl(): string | null {
  const explicit = process.env["WHATSAPP_WEBHOOK_URL"]?.trim();
  if (explicit) return explicit;

  const appBaseUrl = process.env["MERCADOIMOBI_BASE_URL"]?.trim().replace(/\/$/, "");
  return appBaseUrl ? `${appBaseUrl}/api/public/hooks/whatsapp` : null;
}

async function configureWebhook(config: EvolutionConfig) {
  const url = webhookUrl();
  if (!url) {
    return {
      configured: false,
      url: null as string | null,
      warning: "WHATSAPP_WEBHOOK_URL_MISSING" as string | null,
    };
  }

  const secret = process.env["WHATSAPP_WEBHOOK_SECRET"]?.trim();
  const response = await evolutionRequest(
    config,
    `/webhook/set/${encodeURIComponent(config.instance)}`,
    {
      method: "POST",
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url,
          headers: secret ? { "x-webhook-secret": secret } : {},
          byEvents: false,
          base64: false,
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
        },
      }),
    },
  );

  if (!response.ok) {
    return {
      configured: false,
      url,
      warning: `EVOLUTION_WEBHOOK_HTTP_${response.status}`,
    };
  }

  return { configured: true, url, warning: null as string | null };
}

export const prepareWhatsAppConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const config = evolutionConfig();

    if (!config) {
      return {
        configured: false,
        ready: false,
        connected: false,
        state: "disconnected" as EvolutionState,
        webhookConfigured: false,
        webhookUrl: null as string | null,
        warning: "EVOLUTION_ENV_MISSING" as string | null,
        instanceName: null as string | null,
      };
    }

    const stateResponse = await evolutionRequest(
      config,
      `/instance/connectionState/${encodeURIComponent(config.instance)}`,
      { method: "GET" },
    );

    if (stateResponse.status === 401 || stateResponse.status === 403) {
      throw new Error("EVOLUTION_API_AUTH_FAILED");
    }
    if (stateResponse.status === 404) {
      throw new Error("EVOLUTION_INSTANCE_NOT_FOUND");
    }
    if (!stateResponse.ok) {
      throw new Error(`EVOLUTION_API_HTTP_${stateResponse.status}`);
    }

    const statePayload = await stateResponse.json().catch(() => ({}));
    const state = normalizeState(statePayload);
    const webhook = await configureWebhook(config);

    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const now = new Date().toISOString();
    const status =
      state === "connected"
        ? "connected"
        : state === "connecting"
          ? "connecting"
          : state === "disconnected"
            ? "disconnected"
            : "error";

    const { error } = await db.from("whatsapp_connections").upsert(
      {
        tenant_id: tenantId,
        owner_user_id: context.userId,
        instance_name: config.instance,
        display_name: config.instance,
        status,
        last_connected_at: state === "connected" ? now : null,
        updated_at: now,
      },
      { onConflict: "tenant_id" },
    );

    if (error) throw new Error(error.message);

    return {
      configured: true,
      ready: true,
      connected: state === "connected",
      state,
      webhookConfigured: webhook.configured,
      webhookUrl: webhook.url,
      warning: webhook.warning,
      instanceName: config.instance,
    };
  });
