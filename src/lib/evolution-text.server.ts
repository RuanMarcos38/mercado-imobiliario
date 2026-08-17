type JsonObject = Record<string, unknown>;

function evolutionConfig() {
  const baseUrl = process.env["EVOLUTION_API_URL"]?.replace(/\/$/, "");
  const apiKey = process.env["EVOLUTION_API_KEY"];
  const instance = process.env["EVOLUTION_INSTANCE"];
  if (!baseUrl || !apiKey || !instance) return null;
  return { baseUrl, apiKey, instance };
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

export async function sendEvolutionTextMessage(input: {
  phone: string;
  text: string;
  delay?: number;
}): Promise<JsonObject> {
  const config = evolutionConfig();
  if (!config) throw new Error("WHATSAPP_NOT_CONFIGURED");

  const endpoint = `${config.baseUrl}/message/sendText/${encodeURIComponent(config.instance)}`;
  const delay = Math.max(0, Math.min(input.delay ?? 800, 10_000));

  // Evolution API has used more than one sendText contract across releases.
  // Try the currently used top-level schema first, then older documented shapes.
  const bodies: JsonObject[] = [
    {
      number: input.phone,
      text: input.text,
      delay,
      linkPreview: false,
    },
    {
      number: input.phone,
      text: input.text,
      options: { delay, presence: "composing" },
    },
    {
      number: input.phone,
      options: { delay, presence: "composing" },
      textMessage: { text: input.text },
    },
  ];

  let lastStatus = 0;
  let lastPayload: JsonObject = {};

  for (const body of bodies) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: config.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });

      const raw = await response.text();
      const payload = parsePayload(raw);
      if (response.ok) return payload;

      lastStatus = response.status;
      lastPayload = payload;

      // Auth and missing-instance failures are not payload-shape problems.
      if ([401, 403, 404].includes(response.status)) break;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "request_failed";
      throw new Error(`EVOLUTION_UNREACHABLE:${reason}`);
    }
  }

  const detail = responseMessage(lastPayload);
  throw new Error(`EVOLUTION_SEND_FAILED:${lastStatus || "network"}:${detail}`);
}
