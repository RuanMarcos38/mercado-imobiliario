import { aiParameters } from "@/lib/platform-parameters.server";

type JsonObject = Record<string, unknown>;

type OpenAITextInput = string | Array<{ role?: string; content?: unknown }> | unknown;

export type OpenAITextResult = {
  text: string;
  model: string;
  endpoint: "responses" | "chat_completions";
};

function safeErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const error = (payload as JsonObject)["error"];
  if (error && typeof error === "object") {
    const message = (error as JsonObject)["message"];
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  const message = (payload as JsonObject)["message"];
  if (typeof message === "string" && message.trim()) return message.trim();
  const raw = (payload as JsonObject)["raw"];
  return typeof raw === "string" ? raw.trim() : "";
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function endpointError(endpoint: string, status: number, payload: unknown) {
  const message = safeErrorMessage(payload);
  return `${endpoint} HTTP ${status}${message ? `: ${message}` : ""}`;
}

export function describeOpenAIError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (!message) return "Falha de conexão com a OpenAI.";
  return message.replace(/^AI_REQUEST_FAILED:\s*/, "").slice(0, 320);
}

export function extractOpenAIText(payload: any): string {
  const direct = typeof payload?.output_text === "string" ? payload.output_text.trim() : "";
  if (direct) return direct;

  const responsesText = (payload?.output ?? [])
    .flatMap((item: any) => item?.content ?? [])
    .map((item: any) => {
      if (typeof item?.text === "string") return item.text;
      if (typeof item?.text?.value === "string") return item.text.value;
      if (typeof item?.content === "string") return item.content;
      return "";
    })
    .map((text: string) => text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  if (responsesText) return responsesText;

  return (payload?.choices ?? [])
    .map((choice: any) => {
      const content = choice?.message?.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .map((part: any) => {
            if (typeof part?.text === "string") return part.text;
            if (typeof part?.text?.value === "string") return part.text.value;
            return "";
          })
          .filter(Boolean)
          .join("\n");
      }
      return "";
    })
    .map((text: string) => text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function contentToString(content: unknown) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content == null) return "";
  return JSON.stringify(content);
}

function chatMessages(input: OpenAITextInput, instructions: string) {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  if (instructions.trim()) messages.push({ role: "system", content: instructions.trim() });

  if (Array.isArray(input)) {
    for (const item of input) {
      if (!item || typeof item !== "object") continue;
      const role = item.role === "assistant" || item.role === "system" ? item.role : "user";
      const content = contentToString(item.content).trim();
      if (content) messages.push({ role, content });
    }
  } else {
    const content = contentToString(input).trim();
    if (content) messages.push({ role: "user", content });
  }

  if (messages.length === (instructions.trim() ? 1 : 0)) {
    messages.push({ role: "user", content: "Teste técnico do MercadoImobi." });
  }
  return messages;
}

export async function createOpenAIText(
  input: OpenAITextInput,
  instructions: string,
  options?: { maxOutputTokens?: number; timeoutMs?: number },
): Promise<OpenAITextResult> {
  const apiKey = process.env["OPENAI_API_KEY"]?.trim();
  if (!apiKey) throw new Error("AI_NOT_CONFIGURED");

  const parameters = aiParameters();
  const model = parameters.model;
  const timeoutMs = options?.timeoutMs ?? parameters.requestTimeoutMs;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  let responsesFailure = "";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      instructions,
      input,
      store: false,
      ...(options?.maxOutputTokens ? { max_output_tokens: options.maxOutputTokens } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const responsePayload = await readJson(response);
  if (response.ok) {
    const text = extractOpenAIText(responsePayload);
    if (text) return { text, model, endpoint: "responses" };
    responsesFailure = "Responses API retornou sem texto utilizável.";
  } else {
    responsesFailure = endpointError("Responses API", response.status, responsePayload);
  }

  const chatResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: chatMessages(input, instructions),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const chatPayload = await readJson(chatResponse);
  if (chatResponse.ok) {
    const text = extractOpenAIText(chatPayload);
    if (text) return { text, model, endpoint: "chat_completions" };
    throw new Error(
      `AI_REQUEST_FAILED: ${responsesFailure}; Chat Completions retornou sem texto utilizável.`,
    );
  }

  throw new Error(
    `AI_REQUEST_FAILED: ${responsesFailure}; ${endpointError(
      "Chat Completions",
      chatResponse.status,
      chatPayload,
    )}`,
  );
}
