type JsonObject = Record<string, unknown>;

function evolutionGatewayConfig() {
  const baseUrl = process.env["EVOLUTION_API_URL"]?.trim().replace(/\/$/, "");
  const apiKey = process.env["EVOLUTION_API_KEY"]?.trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

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
  const cleanBase64 = input.base64.replace(/^data:[^;]+;base64,/, "").trim();
  const body: JsonObject = {
    number: input.phone,
    mediatype: input.mediaType,
    mimetype: input.mimeType,
    media: cleanBase64,
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

export async function sendEvolutionAudioMessage(input: {
  phone: string;
  base64: string;
  instanceName: string;
}): Promise<JsonObject> {
  const config = evolutionGatewayConfig();
  if (!config) throw new Error("WHATSAPP_NOT_CONFIGURED");

  const endpoint = `${config.baseUrl}/message/sendWhatsAppAudio/${encodeURIComponent(input.instanceName)}`;
  const cleanBase64 = input.base64.replace(/^data:[^;]+;base64,/, "").trim();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.apiKey,
    },
    body: JSON.stringify({
      number: input.phone,
      audio: cleanBase64,
      encoding: true,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const raw = await response.text();
  const payload = parsePayload(raw);
  if (response.ok) return payload;

  throw new Error(`EVOLUTION_AUDIO_FAILED:${response.status}:${responseMessage(payload)}`);
}
