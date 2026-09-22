import { createHmac, timingSafeEqual } from "node:crypto";
import { externalServiceParameters, platformBaseUrl } from "@/lib/platform-parameters.server";

type JsonObject = Record<string, unknown>;

const DEFAULT_GRAPH_VERSION = "v26.0";
const META_WHATSAPP_PHONE_FIELDS = [
  "id",
  "display_phone_number",
  "verified_name",
  "quality_rating",
  "code_verification_status",
  "platform_type",
  "name_status",
  "status",
].join(",");

export type MetaWhatsAppMediaType = "image" | "video" | "audio" | "document";

export type MetaWhatsAppBusinessProfile = {
  about: string | null;
  address: string | null;
  description: string | null;
  email: string | null;
  websites: string[];
  vertical: string | null;
  profilePictureUrl: string | null;
};

export type MetaWhatsAppCommerceSettings = {
  isCatalogVisible: boolean;
  isCartEnabled: boolean;
  id: string | null;
};

const META_WHATSAPP_PROFILE_FIELDS = [
  "about",
  "address",
  "description",
  "email",
  "profile_picture_url",
  "websites",
  "vertical",
].join(",");

export type MetaWhatsAppConfig = {
  graphVersion: string;
  phoneNumberId: string;
  businessAccountId: string | null;
  accessToken: string;
  displayPhoneNumber: string | null;
  callbackUrl: string;
};

export type StoredMetaWhatsAppConfig = {
  graphVersion?: string | null;
  phoneNumberId: string;
  businessAccountId?: string | null;
  accessToken: string;
  displayPhoneNumber?: string | null;
  updatedAt?: string | null;
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
  return normalizeGraphVersion(raw);
}

function normalizeGraphVersion(raw: string | null | undefined) {
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

export function metaWhatsAppConfigFromStored(
  stored: StoredMetaWhatsAppConfig | null,
): MetaWhatsAppConfig | null {
  const accessToken = stored?.accessToken?.trim();
  const phoneNumberId = stored?.phoneNumberId?.trim();
  if (!accessToken || !phoneNumberId) return null;
  return {
    graphVersion: normalizeGraphVersion(stored.graphVersion),
    phoneNumberId,
    businessAccountId: stored.businessAccountId?.trim() || null,
    accessToken,
    displayPhoneNumber: stored.displayPhoneNumber?.trim() || null,
    callbackUrl: metaWhatsAppWebhookCallbackUrl(),
  };
}

export async function readStoredMetaWhatsAppConfig(tenantId: string, userId: string) {
  const { readIntegrationSecret } = await import("@/lib/integration-secrets.server");
  const stored = await readIntegrationSecret<StoredMetaWhatsAppConfig>(
    tenantId,
    userId,
    "meta-whatsapp",
  );
  return metaWhatsAppConfigFromStored(stored);
}

export async function writeStoredMetaWhatsAppConfig(
  tenantId: string,
  userId: string,
  config: MetaWhatsAppConfig,
) {
  const { writeIntegrationSecret } = await import("@/lib/integration-secrets.server");
  await writeIntegrationSecret(tenantId, userId, "meta-whatsapp", {
    graphVersion: config.graphVersion,
    phoneNumberId: config.phoneNumberId,
    businessAccountId: config.businessAccountId,
    accessToken: config.accessToken,
    displayPhoneNumber: config.displayPhoneNumber,
    updatedAt: new Date().toISOString(),
  } satisfies StoredMetaWhatsAppConfig);
}

export function metaWhatsAppInstanceName(phoneNumberId: string) {
  const safe = phoneNumberId.replace(/[^a-zA-Z0-9_-]+/g, "").slice(0, 80);
  return `meta-${safe || "whatsapp"}`;
}

function endpoint(config: MetaWhatsAppConfig, path: string) {
  return `https://graph.facebook.com/${config.graphVersion}${path}`;
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function textField(value: JsonObject, key: string) {
  return typeof value[key] === "string" ? (value[key] as string) : null;
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

function metaApiErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "META_WHATSAPP_TEST_FAILED";
}

export function isMetaWhatsAppAccessTokenFailure(errorMessage: string) {
  const normalized = errorMessage.toLowerCase();
  return (
    normalized.includes("session has expired") ||
    normalized.includes("error validating access token") ||
    normalized.includes("invalid oauth access token") ||
    normalized.includes("oauth access token cannot be parsed") ||
    normalized.includes("access token could not be decrypted") ||
    (normalized.includes("access token") &&
      (normalized.includes("expired") ||
        normalized.includes("invalid") ||
        normalized.includes("malformed") ||
        normalized.includes("cannot be parsed")))
  );
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
  config?: MetaWhatsAppConfig;
}) {
  const config = input.config ?? metaWhatsAppConfig(input.phoneNumberId);
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
  config?: MetaWhatsAppConfig;
}) {
  const config = input.config ?? metaWhatsAppConfig(input.phoneNumberId);
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

function profileFromPayload(payload: JsonObject): MetaWhatsAppBusinessProfile {
  const data = Array.isArray(payload["data"]) ? payload["data"] : [];
  const first = data[0] && typeof data[0] === "object" ? object(data[0]) : {};
  const nested = object(first["business_profile"]);
  const source = Object.keys(nested).length ? nested : first;
  const websites = Array.isArray(source["websites"])
    ? source["websites"].filter((value): value is string => typeof value === "string")
    : [];

  return {
    about: textField(source, "about"),
    address: textField(source, "address"),
    description: textField(source, "description"),
    email: textField(source, "email"),
    websites,
    vertical: textField(source, "vertical"),
    profilePictureUrl: textField(source, "profile_picture_url"),
  };
}

export async function getMetaWhatsAppBusinessProfile(config: MetaWhatsAppConfig) {
  const params = new URLSearchParams({ fields: META_WHATSAPP_PROFILE_FIELDS });
  const payload = await metaJson(
    endpoint(
      config,
      `/${encodeURIComponent(config.phoneNumberId)}/whatsapp_business_profile?${params.toString()}`,
    ),
    config,
    { method: "GET" },
  );
  return profileFromPayload(payload);
}

async function uploadMetaWhatsAppProfilePicture(input: {
  config: MetaWhatsAppConfig;
  mimeType: "image/jpeg" | "image/png";
  fileName: string;
  base64: string;
}) {
  const bytes = base64Bytes(input.base64);
  if (!bytes.byteLength) throw new Error("META_WHATSAPP_PROFILE_PICTURE_EMPTY");
  if (bytes.byteLength > 5 * 1024 * 1024) {
    throw new Error("META_WHATSAPP_PROFILE_PICTURE_TOO_LARGE");
  }

  const params = new URLSearchParams({
    file_length: String(bytes.byteLength),
    file_type: input.mimeType,
    file_name: input.fileName || "whatsapp-profile",
  });
  const sessionPayload = await metaJson(
    endpoint(input.config, `/app/uploads/?${params.toString()}`),
    input.config,
    { method: "POST" },
  );
  const uploadId = typeof sessionPayload["id"] === "string" ? sessionPayload["id"] : "";
  if (!uploadId) throw new Error("META_WHATSAPP_PROFILE_UPLOAD_SESSION_MISSING");

  const uploadPayload = await metaJson(endpoint(input.config, `/${uploadId}`), input.config, {
    method: "POST",
    headers: {
      "Content-Type": input.mimeType,
      file_offset: "0",
    },
    body: bytes,
  });
  const handle = typeof uploadPayload["h"] === "string" ? uploadPayload["h"] : "";
  if (!handle) throw new Error("META_WHATSAPP_PROFILE_PICTURE_HANDLE_MISSING");
  return handle;
}

export async function updateMetaWhatsAppBusinessProfile(input: {
  config: MetaWhatsAppConfig;
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  websites?: string[];
  vertical?: string;
  profilePicture?: {
    mimeType: "image/jpeg" | "image/png";
    fileName: string;
    base64: string;
  };
}) {
  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
  };

  if (input.about !== undefined) body["about"] = input.about;
  if (input.address !== undefined) body["address"] = input.address;
  if (input.description !== undefined) body["description"] = input.description;
  if (input.email !== undefined) body["email"] = input.email;
  if (input.websites !== undefined) body["websites"] = input.websites.slice(0, 2);
  if (input.vertical !== undefined) body["vertical"] = input.vertical;
  if (input.profilePicture) {
    body["profile_picture_handle"] = await uploadMetaWhatsAppProfilePicture({
      config: input.config,
      ...input.profilePicture,
    });
  }

  await metaJson(
    endpoint(
      input.config,
      `/${encodeURIComponent(input.config.phoneNumberId)}/whatsapp_business_profile`,
    ),
    input.config,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

  return getMetaWhatsAppBusinessProfile(input.config);
}

export async function getMetaWhatsAppCommerceSettings(
  config: MetaWhatsAppConfig,
): Promise<MetaWhatsAppCommerceSettings> {
  const payload = await metaJson(
    endpoint(config, `/${encodeURIComponent(config.phoneNumberId)}/whatsapp_commerce_settings`),
    config,
    { method: "GET" },
  );
  const data = Array.isArray(payload["data"]) ? payload["data"] : [];
  const first = data[0] && typeof data[0] === "object" ? object(data[0]) : {};
  return {
    isCatalogVisible: first["is_catalog_visible"] === true,
    isCartEnabled: first["is_cart_enabled"] === true,
    id: textField(first, "id"),
  };
}

export async function updateMetaWhatsAppCommerceSettings(input: {
  config: MetaWhatsAppConfig;
  isCatalogVisible: boolean;
  isCartEnabled: boolean;
}) {
  const params = new URLSearchParams({
    is_catalog_visible: String(input.isCatalogVisible),
    is_cart_enabled: String(input.isCartEnabled),
  });
  await metaJson(
    endpoint(
      input.config,
      `/${encodeURIComponent(input.config.phoneNumberId)}/whatsapp_commerce_settings?${params.toString()}`,
    ),
    input.config,
    { method: "POST" },
  );
  return getMetaWhatsAppCommerceSettings(input.config);
}

export async function testMetaWhatsAppConnection(phoneNumberId?: string) {
  return testMetaWhatsAppConfig(metaWhatsAppConfig(phoneNumberId));
}

export async function testMetaWhatsAppConfig(config: MetaWhatsAppConfig | null) {
  if (!config) {
    return { configured: false, ok: false, connected: false, metadataValidated: false };
  }
  try {
    const params = new URLSearchParams({
      fields: META_WHATSAPP_PHONE_FIELDS,
    });
    const payload = await metaJson(
      endpoint(config, `/${encodeURIComponent(config.phoneNumberId)}?${params.toString()}`),
      config,
      { method: "GET" },
    );
    let businessAccountMatched: boolean | null = config.businessAccountId ? null : true;
    let businessAccountWarning: string | null = null;
    let matchedBusinessPhone: JsonObject | null = null;

    if (config.businessAccountId) {
      try {
        const accountParams = new URLSearchParams({
          fields: META_WHATSAPP_PHONE_FIELDS,
          limit: "100",
        });
        const accountPayload = await metaJson(
          endpoint(
            config,
            `/${encodeURIComponent(config.businessAccountId)}/phone_numbers?${accountParams.toString()}`,
          ),
          config,
          { method: "GET" },
        );
        const phones = Array.isArray(accountPayload["data"]) ? accountPayload["data"] : [];
        matchedBusinessPhone =
          phones
            .map((phone) => object(phone))
            .find((phone) => String(phone["id"] ?? "") === config.phoneNumberId) ?? null;
        businessAccountMatched = Boolean(matchedBusinessPhone);

        if (!businessAccountMatched) {
          return {
            configured: true,
            ok: false,
            connected: false,
            metadataValidated: true,
            phoneNumberId: String(payload["id"] ?? config.phoneNumberId),
            businessAccountId: config.businessAccountId,
            businessAccountMatched: false,
            displayPhoneNumber:
              textField(payload, "display_phone_number") ?? config.displayPhoneNumber,
            verifiedName: textField(payload, "verified_name"),
            qualityRating: textField(payload, "quality_rating"),
            codeVerificationStatus: textField(payload, "code_verification_status"),
            platformType: textField(payload, "platform_type"),
            nameStatus: textField(payload, "name_status"),
            phoneStatus: textField(payload, "status"),
            error: `A conta WhatsApp Business ${config.businessAccountId} não contém o Phone Number ID ${config.phoneNumberId}.`,
          };
        }
      } catch (businessError) {
        businessAccountWarning = metaApiErrorMessage(businessError);
      }
    }

    const phone = matchedBusinessPhone ?? payload;
    return {
      configured: true,
      ok: true,
      connected: true,
      metadataValidated: true,
      phoneNumberId: String(payload["id"] ?? config.phoneNumberId),
      businessAccountId: config.businessAccountId,
      businessAccountMatched,
      displayPhoneNumber:
        textField(phone, "display_phone_number") ??
        textField(payload, "display_phone_number") ??
        config.displayPhoneNumber,
      verifiedName: textField(phone, "verified_name") ?? textField(payload, "verified_name"),
      qualityRating: textField(phone, "quality_rating") ?? textField(payload, "quality_rating"),
      codeVerificationStatus:
        textField(phone, "code_verification_status") ??
        textField(payload, "code_verification_status"),
      platformType: textField(phone, "platform_type") ?? textField(payload, "platform_type"),
      nameStatus: textField(phone, "name_status") ?? textField(payload, "name_status"),
      phoneStatus: textField(phone, "status") ?? textField(payload, "status"),
      ...(businessAccountWarning ? { warning: businessAccountWarning } : {}),
    };
  } catch (error) {
    const message = metaApiErrorMessage(error);
    if (!isMetaWhatsAppAccessTokenFailure(message)) {
      return {
        configured: true,
        ok: true,
        connected: true,
        metadataValidated: false,
        phoneNumberId: config.phoneNumberId,
        businessAccountId: config.businessAccountId,
        businessAccountMatched: null,
        displayPhoneNumber: config.displayPhoneNumber,
        verifiedName: null,
        qualityRating: null,
        codeVerificationStatus: null,
        platformType: null,
        nameStatus: null,
        phoneStatus: null,
        warning: message,
      };
    }
    return {
      configured: true,
      ok: false,
      connected: false,
      metadataValidated: false,
      phoneNumberId: config.phoneNumberId,
      businessAccountId: config.businessAccountId,
      businessAccountMatched: null,
      displayPhoneNumber: config.displayPhoneNumber,
      error: message,
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
