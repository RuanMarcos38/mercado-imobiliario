import { createHmac, timingSafeEqual } from "node:crypto";
import { externalServiceParameters, platformBaseUrl } from "@/lib/platform-parameters.server";

type JsonObject = Record<string, unknown>;

const DEFAULT_GRAPH_VERSION = "v26.0";

export type MetaWhatsAppMediaType = "image" | "video" | "audio" | "document";

export type MetaWhatsAppConfig = {
  graphVersion: string;
  phoneNumberId: string;
  businessAccountId: string | null;
  accessToken: string;
  displayPhoneNumber: string | null;
  callbackUrl: string;
};

function firstEnv(names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function graphVersion() {
  const raw = firstEnv(["META_WHATSAPP_GRAPH_VERSION", "WHATSAPP_CLOUD_GRAPH_VERSION"]);
  if (!raw) return DEFAULT_GRAPH_VERSION;
  const normalized = raw.startsWith("v") ? raw : `v${raw}`;
  return /^v\d+\.\d+$/.test(normalized) ? normalized : DEFAULT_GRAPH_VERSION;
}

export function metaWhatsAppWebhookCallbackUrl() {
  return `${platformBaseUrl()}/api/public/hooks/whatsapp`;
}

export function metaWhatsAppVerifyToken() {
  return firstEnv([
    "META_WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_CLOUD_VERIFY_TOKEN",
    "WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  ]);
}

export function metaWhatsAppAppSecret() {
  return firstEnv(["META_WHATSAPP_APP_SECRET", "META_APP_SECRET"]);
}

export function metaWhatsAppConfig(phoneNumberIdOverride?: string): MetaWhatsAppConfig | null {
  const accessToken = firstEnv([
    "META_WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_CLOUD_ACCESS_TOKEN",
    "WHATSAPP_CLOUD_API_TOKEN",
    "WHATSAPP_ACCESS_TOKEN",
  ]);
  const phoneNumberId =
    phoneNumberIdOverride?.trim() ||
    firstEnv([
      "META_WHATSAPP_PHONE_NUMBER_ID",
      "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
      "WHATSAPP_PHONE_NUMBER_ID",
    ]);
  if (!accessToken || !phoneNumberId) return null;
  return {
    graphVersion: graphVersion(),
    phoneNumberId,
    businessAccountId:
      firstEnv([
        "META_WHATSAPP_BUSINESS_ACCOUNT_ID",
        "WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID",
        "WHATSAPP_BUSINESS_ACCOUNT_ID",
      ]) || null,
    accessToken,
    displayPhoneNumber: firstEnv(["META_WHATSAPP_DISPLAY_PHONE_NUMBER"]) || null,
    callbackUrl: metaWhatsAppWebhookCallbackUrl(),
  };
}

export function metaWhatsAppInstanceName(phoneNumberId: string) {
  const safe = phoneNumberId.replace(/[^a-zA-Z0-9_-]+/g, "").slice(0, 80);
  return `meta-${safe || "whatsapp"}`;
}

function endpoint(config: MetaWhatsAppConfig, path: string) {
  return `https://graph.facebook.com/${config.graphVersion}${path}`;
}

async function metaJson(url: string, config: MetaWhatsAppConfig, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.accessToken}`,
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(externalServiceParameters().metaTimeoutMs),
  });
  const text = await response.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok || payload?.error) {
    const message = payload?.error?.message || payload?.raw || `HTTP ${response.status}`;
    throw new Error(`META_WHATSAPP_API_FAILED:${String(message).slice(0, 260)}`);
  }
  return payload as JsonObject;
}

export function extractMetaWhatsAppMessageId(payload: JsonObject) {
  const messages = Array.isArray(payload["messages"]) ? payload["messages"] : [];
  const first = messages[0] && typeof messages[0] === "object" ? (messages[0] as JsonObject) : {};
  return typeof first["id"] === "string"
    ? first["id"]
    : typeof payload["id"] === "string"
      ? payload["id"]
      : null;
}

export async function sendMetaWhatsAppTextMessage(input: {
  phone: string;
  text: string;
  phoneNumberId?: string;
}) {
  const config = metaWhatsAppConfig(input.phoneNumberId);
  if (!config) throw new Error("META_WHATSAPP_NOT_CONFIGURED");
  return metaJson(
    endpoint(config, `/${encodeURIComponent(config.phoneNumberId)}/messages`),
    config,
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.phone,
        type: "text",
        text: {
          preview_url: false,
          body: input.text,
        },
      }),
    },
  );
}

function normalizedBase64(value: string) {
  return value
    .replace(/^data:[^;]+;base64,/, "")
    .replace(/\s+/g, "")
    .trim();
}

function base64Bytes(value: string) {
  return new Uint8Array(Buffer.from(normalizedBase64(value), "base64"));
}

async function uploadMetaWhatsAppMedia(input: {
  config: MetaWhatsAppConfig;
  mimeType: string;
  fileName: string;
  base64: string;
}) {
  const bytes = base64Bytes(input.base64);
  if (!bytes.byteLength) throw new Error("META_WHATSAPP_MEDIA_EMPTY");

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", input.mimeType || "application/octet-stream");
  form.append(
    "file",
    new Blob([bytes], { type: input.mimeType || "application/octet-stream" }),
    input.fileName,
  );

  const payload = await metaJson(
    endpoint(input.config, `/${encodeURIComponent(input.config.phoneNumberId)}/media`),
    input.config,
    { method: "POST", body: form },
  );
  const mediaId = typeof payload["id"] === "string" ? payload["id"] : "";
  if (!mediaId) throw new Error("META_WHATSAPP_MEDIA_ID_MISSING");
  return mediaId;
}

export async function sendMetaWhatsAppMediaMessage(input: {
  phone: string;
  mediaType: MetaWhatsAppMediaType;
  mimeType: string;
  fileName: string;
  base64: string;
  caption?: string;
  phoneNumberId?: string;
}) {
  const config = metaWhatsAppConfig(input.phoneNumberId);
  if (!config) throw new Error("META_WHATSAPP_NOT_CONFIGURED");

  const mediaId = await uploadMetaWhatsAppMedia({
    config,
    mimeType: input.mimeType,
    fileName: input.fileName,
    base64: input.base64,
  });
  const caption = input.caption?.trim();
  const mediaPayload: Record<string, unknown> =
    input.mediaType === "document"
      ? {
          id: mediaId,
          filename: input.fileName,
          ...(caption ? { caption } : {}),
        }
      : input.mediaType === "audio"
        ? { id: mediaId }
        : {
            id: mediaId,
            ...(caption ? { caption } : {}),
          };

  return metaJson(
    endpoint(config, `/${encodeURIComponent(config.phoneNumberId)}/messages`),
    config,
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.phone,
        type: input.mediaType,
        [input.mediaType]: mediaPayload,
      }),
    },
  );
}

export async function testMetaWhatsAppConnection(phoneNumberId?: string) {
  const config = metaWhatsAppConfig(phoneNumberId);
  if (!config) {
    return { configured: false, ok: false, connected: false };
  }
  try {
    const params = new URLSearchParams({
      fields: "id,display_phone_number,verified_name,quality_rating",
    });
    const payload = await metaJson(
      endpoint(config, `/${encodeURIComponent(config.phoneNumberId)}?${params.toString()}`),
      config,
      { method: "GET" },
    );
    return {
      configured: true,
      ok: true,
      connected: true,
      phoneNumberId: String(payload["id"] ?? config.phoneNumberId),
      displayPhoneNumber:
        typeof payload["display_phone_number"] === "string"
          ? payload["display_phone_number"]
          : config.displayPhoneNumber,
      verifiedName: typeof payload["verified_name"] === "string" ? payload["verified_name"] : null,
      qualityRating:
        typeof payload["quality_rating"] === "string" ? payload["quality_rating"] : null,
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      connected: false,
      error: error instanceof Error ? error.message : "META_WHATSAPP_TEST_FAILED",
    };
  }
}

export function verifyMetaWhatsAppWebhookChallenge(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode") ?? "";
  const suppliedToken = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const verifyToken = metaWhatsAppVerifyToken();
  if (mode === "subscribe" && verifyToken && suppliedToken === verifyToken && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new Response("Forbidden", { status: 403 });
}

export function metaWhatsAppWebhookSignatureValid(request: Request, rawBody: string) {
  const appSecret = metaWhatsAppAppSecret();
  if (!appSecret) return true;
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  if (!signature.startsWith("sha256=")) return false;
  try {
    const supplied = Buffer.from(signature.slice("sha256=".length), "hex");
    const expected = Buffer.from(
      createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex"),
      "hex",
    );
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  } catch {
    return false;
  }
}
