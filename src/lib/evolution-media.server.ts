import { evolutionGatewayConfig } from "@/lib/evolution-instance.server";

type JsonObject = Record<string, unknown>;

function parsePayload(raw: string): JsonObject {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as JsonObject) : { value: parsed };
  } catch {
    return { raw: raw.slice(0, 1000) };
  }
}

function responseMessage(payload: JsonObject): string {
  const response = payload["response"];
  if (response && typeof response === "object") {
    const message = (response as JsonObject)["message"];
    if (Array.isArray(message)) return message.flat(Infinity).map(String).join("; ").slice(0, 500);
    if (typeof message === "string") return message.slice(0, 500);
  }
  if (typeof payload["message"] === "string") return String(payload["message"]).slice(0, 500);
  if (typeof payload["error"] === "string") return String(payload["error"]).slice(0, 500);
  return "Falha desconhecida da Evolution API";
}

function normalizedBase64(value: string) {
  return value
    .replace(/^data:[^;]+;base64,/, "")
    .replace(/\s+/g, "")
    .trim();
}

function base64Bytes(value: string) {
  const clean = normalizedBase64(value);
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export type EvolutionMediaType = "image" | "video" | "document";

export async function sendEvolutionMediaMessage(input: {
  phone: string;
  mediaType: EvolutionMediaType;
  mimeType: string;
  fileName: string;
  base64: string;
  caption?: string;
  instanceName: string;
}): Promise<JsonObject> {
  const config = evolutionGatewayConfig();
  if (!config) throw new Error("WHATSAPP_NOT_CONFIGURED");

  const endpoint = `${config.baseUrl}/message/sendMedia/${encodeURIComponent(input.instanceName)}`;
  const body: JsonObject = {
    number: input.phone,
    mediatype: input.mediaType,
    mimetype: input.mimeType,
    media: normalizedBase64(input.base64),
    fileName: input.fileName,
    caption: input.caption?.trim() || "",
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const raw = await response.text();
  const payload = parsePayload(raw);
  if (response.ok) return payload;

  throw new Error(`EVOLUTION_MEDIA_FAILED:${response.status}:${responseMessage(payload)}`);
}

export async function sendEvolutionWhatsAppAudioMessage(input: {
  phone: string;
  mimeType: string;
  fileName: string;
  base64: string;
  instanceName: string;
}): Promise<JsonObject> {
  const config = evolutionGatewayConfig();
  if (!config) throw new Error("WHATSAPP_NOT_CONFIGURED");

  const bytes = base64Bytes(input.base64);
  if (!bytes.byteLength) throw new Error("AUDIO_EMPTY");
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const form = new FormData();
  form.append("number", input.phone);
  form.append("encoding", "true");
  form.append("file", new Blob([buffer], { type: input.mimeType || "audio/webm" }), input.fileName);

  const endpoint = `${config.baseUrl}/message/sendWhatsAppAudio/${encodeURIComponent(input.instanceName)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { apikey: config.apiKey },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const raw = await response.text();
  const payload = parsePayload(raw);
  if (response.ok) return payload;

  throw new Error(`EVOLUTION_AUDIO_FAILED:${response.status}:${responseMessage(payload)}`);
}
