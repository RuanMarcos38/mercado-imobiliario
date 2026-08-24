import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  evolutionGatewayConfig,
  evolutionRequest,
  generatedEvolutionInstanceName,
  getTenantEvolutionInstance,
  type EvolutionGatewayConfig,
} from "@/lib/evolution-instance.server";
import { requireTenantId } from "@/lib/tenant.server";

type EvolutionState = "connected" | "connecting" | "disconnected" | "error";

type QrPayload = {
  base64: string | null;
  code: string | null;
  pairingCode: string | null;
  count: number;
};

const DEFAULT_MERCADOIMOBI_URL = "https://r2rmarketingdigital-mercadomobi.ke4n49.easypanel.host";

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

function extractQr(payload: unknown): QrPayload {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const nested =
    root["qrcode"] && typeof root["qrcode"] === "object"
      ? (root["qrcode"] as Record<string, unknown>)
      : root;
  const base64 = typeof nested["base64"] === "string" && nested["base64"] ? nested["base64"] : null;
  const code = typeof nested["code"] === "string" && nested["code"] ? nested["code"] : null;
  const pairingCode =
    typeof nested["pairingCode"] === "string" && nested["pairingCode"]
      ? nested["pairingCode"]
      : null;
  const count = Number(nested["count"] ?? 0);
  return { base64, code, pairingCode, count: Number.isFinite(count) ? count : 0 };
}

function webhookUrl(): string {
  const explicit = process.env["WHATSAPP_WEBHOOK_URL"]?.trim();
  if (explicit) return explicit;
  const appBaseUrl =
    process.env["MERCADOIMOBI_BASE_URL"]?.trim().replace(/\/$/, "") ||
    process.env["EASYPANEL_PUBLIC_URL"]?.trim().replace(/\/$/, "") ||
    process.env["APP_URL"]?.trim().replace(/\/$/, "") ||
    DEFAULT_MERCADOIMOBI_URL;
  return `${appBaseUrl}/api/public/hooks/whatsapp`;
}

async function configureWebhook(config: EvolutionGatewayConfig, instance: string) {
  const url = webhookUrl();
  const secret = process.env["WHATSAPP_WEBHOOK_SECRET"]?.trim();
  const response = await evolutionRequest(config, `/webhook/set/${encodeURIComponent(instance)}`, {
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
  });

  if (!response.ok) {
    return {
      configured: false,
      url,
      warning: `EVOLUTION_WEBHOOK_HTTP_${response.status}` as string | null,
    };
  }
  return { configured: true, url, warning: null as string | null };
}

async function isPlatformAdmin(db: any, userId: string) {
  const { data } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return Boolean(data);
}

async function ensureTenantInstance(input: {
  db: any;
  tenantId: string;
  userId: string;
  config: EvolutionGatewayConfig;
}) {
  const saved = await getTenantEvolutionInstance(input.db, input.tenantId);
  if (saved) return { instance: saved, created: false, qr: null as QrPayload | null };

  // Preserve the original administrator's already-connected legacy instance when present,
  // while all subscriber tenants receive their own dedicated Evolution instance.
  const legacyInstance = process.env["EVOLUTION_INSTANCE"]?.trim();
  const instance =
    legacyInstance && (await isPlatformAdmin(input.db, input.userId))
      ? legacyInstance
      : generatedEvolutionInstanceName(input.tenantId);

  let created = false;
  let qr: QrPayload | null = null;
  const stateResponse = await evolutionRequest(
    input.config,
    `/instance/connectionState/${encodeURIComponent(instance)}`,
    { method: "GET" },
  );

  if (stateResponse.status === 401 || stateResponse.status === 403) {
    throw new Error("EVOLUTION_API_AUTH_FAILED");
  }

  if (stateResponse.status === 404) {
    const response = await evolutionRequest(input.config, "/instance/create", {
      method: "POST",
      body: JSON.stringify({
        instanceName: instance,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
      }),
    });
    if (response.status === 401 || response.status === 403)
      throw new Error("EVOLUTION_API_AUTH_FAILED");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        payload && typeof payload === "object"
          ? String((payload as Record<string, unknown>)["message"] ?? "")
          : "";
      throw new Error(
        `EVOLUTION_INSTANCE_CREATE_FAILED:${response.status}:${message.slice(0, 180)}`,
      );
    }
    created = true;
    qr = extractQr(payload);
  } else if (!stateResponse.ok) {
    throw new Error(`EVOLUTION_API_HTTP_${stateResponse.status}`);
  }

  const now = new Date().toISOString();
  const { error } = await input.db.from("whatsapp_connections").upsert(
    {
      tenant_id: input.tenantId,
      owner_user_id: input.userId,
      instance_name: instance,
      display_name: "Meu WhatsApp",
      status: "connecting",
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );
  if (error) throw new Error(error.message);

  return { instance, created, qr };
}

export const prepareWhatsAppConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const config = evolutionGatewayConfig();
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
        qrBase64: null as string | null,
        qrCode: null as string | null,
        pairingCode: null as string | null,
      };
    }

    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const ensured = await ensureTenantInstance({ db, tenantId, userId: context.userId, config });
    const webhook = await configureWebhook(config, ensured.instance);

    const stateResponse = await evolutionRequest(
      config,
      `/instance/connectionState/${encodeURIComponent(ensured.instance)}`,
      { method: "GET" },
    );
    if (stateResponse.status === 401 || stateResponse.status === 403) {
      throw new Error("EVOLUTION_API_AUTH_FAILED");
    }
    if (!stateResponse.ok && stateResponse.status !== 404) {
      throw new Error(`EVOLUTION_API_HTTP_${stateResponse.status}`);
    }

    const statePayload = await stateResponse.json().catch(() => ({}));
    const state = stateResponse.ok ? normalizeState(statePayload) : "disconnected";
    const now = new Date().toISOString();
    const status =
      state === "connected"
        ? "connected"
        : state === "connecting"
          ? "connecting"
          : state === "disconnected"
            ? "disconnected"
            : "error";

    const { error } = await db
      .from("whatsapp_connections")
      .update({
        status,
        last_connected_at: state === "connected" ? now : null,
        updated_at: now,
      })
      .eq("tenant_id", tenantId)
      .eq("instance_name", ensured.instance);
    if (error) throw new Error(error.message);

    return {
      configured: true,
      ready: true,
      connected: state === "connected",
      state,
      webhookConfigured: webhook.configured,
      webhookUrl: webhook.url,
      warning: webhook.warning,
      instanceName: ensured.instance,
      qrBase64: ensured.qr?.base64 ?? null,
      qrCode: ensured.qr?.code ?? null,
      pairingCode: ensured.qr?.pairingCode ?? null,
    };
  });

export const disconnectWhatsAppConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const config = evolutionGatewayConfig();
    if (!config) throw new Error("EVOLUTION_ENV_MISSING");

    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const instance = await getTenantEvolutionInstance(db, tenantId);
    if (!instance) {
      return { success: true, connected: false, state: "disconnected" as EvolutionState };
    }

    let response = await evolutionRequest(
      config,
      `/instance/logout/${encodeURIComponent(instance)}`,
      { method: "DELETE" },
    );
    if (response.status === 405) {
      response = await evolutionRequest(
        config,
        `/instance/logout/${encodeURIComponent(instance)}`,
        { method: "POST" },
      );
    }
    if (!response.ok && response.status !== 404) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("EVOLUTION_API_AUTH_FAILED");
      }
      throw new Error(`EVOLUTION_LOGOUT_HTTP_${response.status}`);
    }

    const now = new Date().toISOString();
    const { error } = await db
      .from("whatsapp_connections")
      .update({ status: "disconnected", last_connected_at: null, updated_at: now })
      .eq("tenant_id", tenantId)
      .eq("instance_name", instance);
    if (error) throw new Error(error.message);

    return { success: true, connected: false, state: "disconnected" as EvolutionState };
  });
