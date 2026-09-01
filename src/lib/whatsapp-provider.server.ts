import {
  evolutionGatewayConfig,
  evolutionRequest,
  getTenantEvolutionInstance,
} from "@/lib/evolution-instance.server";
import {
  sendEvolutionMediaMessage,
  sendEvolutionWhatsAppAudioMessage,
  type EvolutionMediaType,
} from "@/lib/evolution-media.server";
import { sendEvolutionTextMessage } from "@/lib/evolution-text.server";
import {
  extractMetaWhatsAppMessageId,
  metaWhatsAppConfig,
  metaWhatsAppInstanceName,
  sendMetaWhatsAppMediaMessage,
  sendMetaWhatsAppTextMessage,
  testMetaWhatsAppConnection,
  type MetaWhatsAppMediaType,
} from "@/lib/meta-whatsapp.server";

type JsonObject = Record<string, unknown>;

export type WhatsAppProvider = "evolution" | "meta";
export type WhatsAppProviderMode = WhatsAppProvider | "auto";

export type TenantWhatsAppConnection = {
  id?: string;
  tenant_id?: string;
  owner_user_id?: string;
  instance_name?: string | null;
  display_name?: string | null;
  phone_number?: string | null;
  status?: string | null;
  last_connected_at?: string | null;
  provider?: string | null;
  provider_phone_number_id?: string | null;
  provider_business_account_id?: string | null;
  provider_metadata?: JsonObject | null;
};

const PROVIDER_COLUMNS =
  "id,tenant_id,owner_user_id,instance_name,display_name,phone_number,status,last_connected_at,provider,provider_phone_number_id,provider_business_account_id,provider_metadata";
const LEGACY_COLUMNS =
  "id,tenant_id,owner_user_id,instance_name,display_name,phone_number,status,last_connected_at";

function isMissingProviderColumn(error: any) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "");
  return (
    code === "42703" ||
    code === "PGRST204" ||
    /provider(_phone_number_id|_business_account_id|_metadata)?/i.test(message)
  );
}

function providerModeFromEnv(value: string): WhatsAppProviderMode {
  const normalized = value.trim().toLowerCase();
  if (["meta", "official", "oficial", "cloud", "cloud_api"].includes(normalized)) return "meta";
  if (["evolution", "baileys", "qr"].includes(normalized)) return "evolution";
  return "auto";
}

export function whatsappProviderMode(): WhatsAppProviderMode {
  return providerModeFromEnv(
    process.env["WHATSAPP_PROVIDER"] || process.env["WHATSAPP_MODE"] || "",
  );
}

function asConnection(row: unknown): TenantWhatsAppConnection | null {
  return row && typeof row === "object" ? (row as TenantWhatsAppConnection) : null;
}

export async function getTenantWhatsAppConnection(
  db: any,
  tenantId: string,
): Promise<TenantWhatsAppConnection | null> {
  const providerResult = await db
    .from("whatsapp_connections")
    .select(PROVIDER_COLUMNS)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!providerResult.error) return asConnection(providerResult.data);
  if (!isMissingProviderColumn(providerResult.error)) {
    throw new Error(providerResult.error.message);
  }

  const legacyResult = await db
    .from("whatsapp_connections")
    .select(LEGACY_COLUMNS)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (legacyResult.error) throw new Error(legacyResult.error.message);
  return asConnection(legacyResult.data);
}

export function connectionProvider(connection: TenantWhatsAppConnection | null): WhatsAppProvider {
  if (connection?.provider === "meta") return "meta";
  const instance = String(connection?.instance_name ?? "");
  if (instance.startsWith("meta-") && connection?.provider_phone_number_id) return "meta";
  return "evolution";
}

export function shouldUseMetaWhatsApp(connection: TenantWhatsAppConnection | null) {
  const mode = whatsappProviderMode();
  if (mode === "meta") return true;
  if (mode === "evolution") return false;
  if (connection && connectionProvider(connection) === "meta") return true;
  return Boolean(metaWhatsAppConfig() && !evolutionGatewayConfig());
}

function metaPhoneNumberId(connection: TenantWhatsAppConnection | null) {
  const stored = connection?.provider_phone_number_id?.trim();
  return stored || metaWhatsAppConfig()?.phoneNumberId || "";
}

function metaBusinessAccountId(connection: TenantWhatsAppConnection | null) {
  return (
    connection?.provider_business_account_id?.trim() ||
    metaWhatsAppConfig()?.businessAccountId ||
    null
  );
}

export async function ensureMetaWhatsAppConnection(input: {
  db: any;
  tenantId: string;
  userId: string;
}) {
  const config = metaWhatsAppConfig();
  if (!config) return null;

  const live = await testMetaWhatsAppConnection(config.phoneNumberId);
  const now = new Date().toISOString();
  const instanceName = metaWhatsAppInstanceName(config.phoneNumberId);
  const displayPhoneNumber =
    live.ok && "displayPhoneNumber" in live && live.displayPhoneNumber
      ? live.displayPhoneNumber
      : config.displayPhoneNumber;
  const fullRow = {
    tenant_id: input.tenantId,
    owner_user_id: input.userId,
    instance_name: instanceName,
    display_name: "WhatsApp Oficial Meta",
    phone_number: displayPhoneNumber,
    status: live.ok ? "connected" : "error",
    last_connected_at: live.ok ? now : null,
    provider: "meta",
    provider_phone_number_id: config.phoneNumberId,
    provider_business_account_id: config.businessAccountId,
    provider_metadata: {
      graphVersion: config.graphVersion,
      callbackUrl: config.callbackUrl,
      configuredBy: "server-env",
    },
    updated_at: now,
  };

  const saved = await input.db
    .from("whatsapp_connections")
    .upsert(fullRow, { onConflict: "tenant_id" })
    .select(PROVIDER_COLUMNS)
    .single();
  if (!saved.error) return asConnection(saved.data);
  if (!isMissingProviderColumn(saved.error)) throw new Error(saved.error.message);

  const legacy = await input.db
    .from("whatsapp_connections")
    .upsert(
      {
        tenant_id: input.tenantId,
        owner_user_id: input.userId,
        instance_name: instanceName,
        display_name: "WhatsApp Oficial Meta",
        phone_number: displayPhoneNumber,
        status: live.ok ? "connected" : "error",
        last_connected_at: live.ok ? now : null,
        updated_at: now,
      },
      { onConflict: "tenant_id" },
    )
    .select(LEGACY_COLUMNS)
    .single();
  if (legacy.error) throw new Error(legacy.error.message);
  return asConnection(legacy.data);
}

function evolutionMessageId(payload: JsonObject) {
  const key = payload["key"] as JsonObject | undefined;
  return (
    (typeof key?.["id"] === "string" && key["id"]) ||
    (typeof payload["id"] === "string" && payload["id"]) ||
    null
  );
}

export async function sendTenantWhatsAppText(input: {
  db: any;
  tenantId: string;
  userId?: string;
  phone: string;
  text: string;
  delay?: number;
}) {
  let connection = await getTenantWhatsAppConnection(input.db, input.tenantId);
  if (!connection && input.userId && shouldUseMetaWhatsApp(null)) {
    connection = await ensureMetaWhatsAppConnection({
      db: input.db,
      tenantId: input.tenantId,
      userId: input.userId,
    });
  }

  if (shouldUseMetaWhatsApp(connection)) {
    const phoneNumberId = metaPhoneNumberId(connection);
    if (!phoneNumberId || !metaWhatsAppConfig(phoneNumberId)) {
      throw new Error("META_WHATSAPP_NOT_CONFIGURED");
    }
    const payload = await sendMetaWhatsAppTextMessage({
      phone: input.phone,
      text: input.text,
      phoneNumberId,
    });
    return {
      provider: "meta" as const,
      payload,
      externalMessageId: extractMetaWhatsAppMessageId(payload),
    };
  }

  const gateway = evolutionGatewayConfig();
  const instanceName =
    connection?.instance_name?.trim() ||
    (await getTenantEvolutionInstance(input.db, input.tenantId)) ||
    process.env["EVOLUTION_INSTANCE"]?.trim() ||
    "";
  if (!gateway || !instanceName) throw new Error("WHATSAPP_NOT_CONFIGURED");
  const payload = await sendEvolutionTextMessage({
    phone: input.phone,
    text: input.text,
    delay: input.delay,
    instanceName,
  });
  return {
    provider: "evolution" as const,
    payload,
    externalMessageId: evolutionMessageId(payload),
  };
}

export async function sendTenantWhatsAppMedia(input: {
  db: any;
  tenantId: string;
  userId?: string;
  phone: string;
  mediaType: EvolutionMediaType | "audio";
  mimeType: string;
  fileName: string;
  base64: string;
  caption?: string;
}) {
  let connection = await getTenantWhatsAppConnection(input.db, input.tenantId);
  if (!connection && input.userId && shouldUseMetaWhatsApp(null)) {
    connection = await ensureMetaWhatsAppConnection({
      db: input.db,
      tenantId: input.tenantId,
      userId: input.userId,
    });
  }

  if (shouldUseMetaWhatsApp(connection)) {
    const phoneNumberId = metaPhoneNumberId(connection);
    if (!phoneNumberId || !metaWhatsAppConfig(phoneNumberId)) {
      throw new Error("META_WHATSAPP_NOT_CONFIGURED");
    }
    const payload = await sendMetaWhatsAppMediaMessage({
      phone: input.phone,
      mediaType: input.mediaType as MetaWhatsAppMediaType,
      mimeType: input.mimeType,
      fileName: input.fileName,
      base64: input.base64,
      caption: input.caption,
      phoneNumberId,
    });
    return {
      provider: "meta" as const,
      payload,
      externalMessageId: extractMetaWhatsAppMessageId(payload),
    };
  }

  const gateway = evolutionGatewayConfig();
  const instanceName =
    connection?.instance_name?.trim() ||
    (await getTenantEvolutionInstance(input.db, input.tenantId)) ||
    process.env["EVOLUTION_INSTANCE"]?.trim() ||
    "";
  if (!gateway || !instanceName) throw new Error("WHATSAPP_NOT_CONFIGURED");
  const payload =
    input.mediaType === "audio"
      ? await sendEvolutionWhatsAppAudioMessage({
          phone: input.phone,
          mimeType: input.mimeType,
          fileName: input.fileName,
          base64: input.base64,
          instanceName,
        })
      : await sendEvolutionMediaMessage({
          phone: input.phone,
          mediaType: input.mediaType,
          mimeType: input.mimeType,
          fileName: input.fileName,
          base64: input.base64,
          caption: input.caption,
          instanceName,
        });
  return {
    provider: "evolution" as const,
    payload,
    externalMessageId: evolutionMessageId(payload),
  };
}

export async function testTenantWhatsAppRuntime(db: any, tenantId: string) {
  const connection = await getTenantWhatsAppConnection(db, tenantId);
  if (shouldUseMetaWhatsApp(connection)) {
    const phoneNumberId = metaPhoneNumberId(connection);
    const result = await testMetaWhatsAppConnection(phoneNumberId);
    return {
      provider: "meta" as const,
      configured: result.configured,
      ok: result.ok,
      state: result.ok ? ("connected" as const) : ("error" as const),
      displayName: connection?.display_name ?? "WhatsApp Oficial Meta",
      phoneNumber: result.ok && "displayPhoneNumber" in result ? result.displayPhoneNumber : null,
      instanceName: phoneNumberId ? metaWhatsAppInstanceName(phoneNumberId) : null,
      phoneNumberId,
      businessAccountId: metaBusinessAccountId(connection),
      detail: result.ok
        ? `Phone Number ID ${phoneNumberId} validado na Meta Cloud API.`
        : String("error" in result ? result.error : "META_WHATSAPP_NOT_CONFIGURED"),
    };
  }

  const gateway = evolutionGatewayConfig();
  const instance =
    connection?.instance_name?.trim() ||
    (await getTenantEvolutionInstance(db, tenantId)) ||
    process.env["EVOLUTION_INSTANCE"]?.trim() ||
    "";
  if (!gateway || !instance) {
    return {
      provider: "evolution" as const,
      configured: false,
      ok: false,
      state: "disconnected" as const,
      displayName: connection?.display_name ?? null,
      phoneNumber: connection?.phone_number ?? null,
      instanceName: instance || null,
      detail: "Gateway Evolution ou instância do tenant não configurados.",
    };
  }
  const response = await evolutionRequest(
    gateway,
    `/instance/connectionState/${encodeURIComponent(instance)}`,
    { method: "GET" },
  );
  const payload = await response.json().catch(() => ({}));
  const raw = String(
    payload?.instance?.state ?? payload?.state ?? payload?.status ?? "",
  ).toLowerCase();
  const ok = response.ok && ["open", "connected", "online"].includes(raw);
  return {
    provider: "evolution" as const,
    configured: true,
    ok,
    state: ok ? ("connected" as const) : raw ? ("error" as const) : ("disconnected" as const),
    displayName: connection?.display_name ?? instance,
    phoneNumber: connection?.phone_number ?? null,
    instanceName: instance,
    detail: ok
      ? `Instância ${instance} online.`
      : `Instância ${instance}: ${raw || `HTTP ${response.status}`}.`,
  };
}
