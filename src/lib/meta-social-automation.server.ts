import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  PLATFORM_HANDOFF_KEYWORDS,
  buildAutomaticInstructions,
  isCourtesyOnlyMessage,
  normalizeAutomaticReply,
  normalizeComparableText,
} from "@/lib/ai-conversation-policy";
import { externalServiceParameters, platformBaseUrl } from "@/lib/platform-parameters.server";
import {
  getMetaSocialConfig,
  sendMetaSocialText,
  type MetaPageConnection,
  type SocialChannel,
} from "@/lib/meta-social.server";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";

type JsonObject = Record<string, unknown>;

const CONNECTION_EVENT = "meta_social_connection";
const DISCONNECTION_EVENT = "meta_social_disconnection";
const AUTOMATION_EVENT = "meta_social_automation";
const DEFAULT_GRAPH_VERSION = "v26.0";

type MetaSocialOwner = {
  tenantId: string;
  userId: string;
  pageId: string;
  instagramUserId: string | null;
};

export type MetaSocialWebhookItem =
  | {
      kind: "message";
      channel: SocialChannel;
      accountId: string;
      externalId: string;
      senderId: string;
      text: string;
    }
  | {
      kind: "comment";
      channel: SocialChannel;
      accountId: string;
      externalId: string;
      senderId: string | null;
      text: string;
    };

function object(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function graphVersion() {
  const raw = process.env["META_GRAPH_VERSION"]?.trim() || DEFAULT_GRAPH_VERSION;
  const version = raw.startsWith("v") ? raw : `v${raw}`;
  return /^v\d+\.\d+$/.test(version) ? version : DEFAULT_GRAPH_VERSION;
}

function socialVerifyToken() {
  return (
    process.env["META_SOCIAL_VERIFY_TOKEN"]?.trim() ||
    process.env["META_WHATSAPP_VERIFY_TOKEN"]?.trim() ||
    process.env["META_OAUTH_STATE_SECRET"]?.trim() ||
    ""
  );
}

export function metaSocialWebhookCallbackUrl() {
  return `${platformBaseUrl()}/api/public/hooks/meta-social`;
}

export function verifyMetaSocialWebhookChallenge(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode") ?? "";
  const supplied = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const expected = socialVerifyToken();
  if (mode === "subscribe" && expected && supplied === expected && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export function metaSocialWebhookSignatureValid(request: Request, rawBody: string) {
  const appSecret = process.env["META_APP_SECRET"]?.trim() || "";
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  if (!appSecret || !signature.startsWith("sha256=")) return false;
  try {
    const supplied = Buffer.from(signature.slice("sha256=".length), "hex");
    const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  } catch {
    return false;
  }
}

function instagramComment(entryId: string, value: JsonObject): MetaSocialWebhookItem | null {
  const externalId = String(value["id"] ?? value["comment_id"] ?? "");
  const text = String(value["text"] ?? value["message"] ?? "").trim();
  if (!externalId || !text) return null;
  const from = object(value["from"]);
  return {
    kind: "comment",
    channel: "instagram",
    accountId: entryId,
    externalId,
    senderId: String(from["id"] ?? value["from_id"] ?? "") || null,
    text,
  };
}

function facebookComment(entryId: string, value: JsonObject): MetaSocialWebhookItem | null {
  if (String(value["item"] ?? "") !== "comment" || String(value["verb"] ?? "add") !== "add") {
    return null;
  }
  const externalId = String(value["comment_id"] ?? value["id"] ?? "");
  const text = String(value["message"] ?? value["text"] ?? "").trim();
  if (!externalId || !text) return null;
  const from = object(value["from"]);
  return {
    kind: "comment",
    channel: "facebook",
    accountId: entryId,
    externalId,
    senderId: String(from["id"] ?? "") || null,
    text,
  };
}

export function extractMetaSocialWebhookItems(payload: JsonObject): MetaSocialWebhookItem[] {
  const objectType = String(payload["object"] ?? "").toLowerCase();
  if (objectType !== "page" && objectType !== "instagram") return [];
  const channel: SocialChannel = objectType === "instagram" ? "instagram" : "facebook";
  const result: MetaSocialWebhookItem[] = [];
  const entries = Array.isArray(payload["entry"]) ? payload["entry"] : [];

  for (const rawEntry of entries) {
    const entry = object(rawEntry);
    const entryId = String(entry["id"] ?? "");
    if (!entryId) continue;

    const messaging = Array.isArray(entry["messaging"]) ? entry["messaging"] : [];
    for (const rawEvent of messaging) {
      const event = object(rawEvent);
      const message = object(event["message"]);
      if (!Object.keys(message).length || message["is_echo"] === true) continue;
      const senderId = String(object(event["sender"])["id"] ?? "");
      const externalId = String(message["mid"] ?? "");
      const text = String(message["text"] ?? "").trim();
      if (!senderId || !externalId || !text) continue;
      result.push({ kind: "message", channel, accountId: entryId, externalId, senderId, text });
    }

    const changes = Array.isArray(entry["changes"]) ? entry["changes"] : [];
    for (const rawChange of changes) {
      const change = object(rawChange);
      const field = String(change["field"] ?? "");
      const value = object(change["value"]);
      if (objectType === "instagram" && (field === "comments" || field === "live_comments")) {
        const item = instagramComment(entryId, value);
        if (item) result.push(item);
      } else if (objectType === "page" && field === "feed") {
        const item = facebookComment(entryId, value);
        if (item) result.push(item);
      }
    }
  }
  return result;
}

function registryMetadata(page: MetaPageConnection, userId: string) {
  return {
    userId,
    pageId: page.pageId,
    pageName: page.pageName,
    instagramUserId: page.instagramUserId,
    instagramUsername: page.instagramUsername,
  };
}

export async function registerMetaSocialConnections(input: { tenantId: string; userId: string }) {
  const config = await getMetaSocialConfig(input.tenantId, input.userId);
  if (!config?.pages.length) return { registered: 0 };
  const rows = config.pages.map((page) => ({
    tenant_id: input.tenantId,
    event_type: CONNECTION_EVENT,
    severity: "info",
    message: "Conta Meta vinculada ao atendimento omnichannel",
    metadata: registryMetadata(page, input.userId),
  }));
  const result = await (supabaseAdmin as any).from("system_events").insert(rows);
  if (result.error) throw new Error(result.error.message);
  return { registered: rows.length };
}

export async function unregisterMetaSocialConnections(input: { tenantId: string; userId: string }) {
  const config = await getMetaSocialConfig(input.tenantId, input.userId);
  if (!config?.pages.length) return { unregistered: 0 };
  const rows = config.pages.map((page) => ({
    tenant_id: input.tenantId,
    event_type: DISCONNECTION_EVENT,
    severity: "info",
    message: "Conta Meta removida do atendimento omnichannel",
    metadata: registryMetadata(page, input.userId),
  }));
  const result = await (supabaseAdmin as any).from("system_events").insert(rows);
  if (result.error) throw new Error(result.error.message);
  return { unregistered: rows.length };
}

async function resolveOwner(accountId: string): Promise<MetaSocialOwner | null> {
  const { data, error } = await (supabaseAdmin as any)
    .from("system_events")
    .select("tenant_id,event_type,metadata,created_at")
    .in("event_type", [CONNECTION_EVENT, DISCONNECTION_EVENT])
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const metadata = object(row?.metadata);
    const pageId = String(metadata["pageId"] ?? "");
    const instagramUserId = String(metadata["instagramUserId"] ?? "") || null;
    if (accountId !== pageId && accountId !== instagramUserId) continue;
    if (row.event_type === DISCONNECTION_EVENT) return null;
    const tenantId = String(row.tenant_id ?? "");
    const userId = String(metadata["userId"] ?? "");
    if (!tenantId || !userId || !pageId) return null;
    return { tenantId, userId, pageId, instagramUserId };
  }
  return null;
}

async function alreadyProcessed(owner: MetaSocialOwner, externalId: string) {
  const { data } = await (supabaseAdmin as any)
    .from("system_events")
    .select("id")
    .eq("tenant_id", owner.tenantId)
    .eq("event_type", AUTOMATION_EVENT)
    .contains("metadata", { externalId })
    .limit(1);
  return Boolean(data?.length);
}

async function recordAutomation(
  owner: MetaSocialOwner,
  item: MetaSocialWebhookItem,
  action: string,
  extra: Record<string, unknown> = {},
) {
  await (supabaseAdmin as any).from("system_events").insert({
    tenant_id: owner.tenantId,
    event_type: AUTOMATION_EVENT,
    severity: "info",
    message: "Automação de atendimento Meta processada",
    metadata: {
      externalId: item.externalId,
      channel: item.channel,
      kind: item.kind,
      action,
      accountId: item.accountId,
      ...extra,
    },
  });
}

const INTEREST_TERMS = [
  "tenho interesse",
  "interessado",
  "interessada",
  "quero saber",
  "quero mais",
  "quero conhecer",
  "quero visitar",
  "me chama",
  "chama no direct",
  "mais informacoes",
  "mais detalhes",
  "qual valor",
  "quanto custa",
  "preco",
  "valor",
  "entrada",
  "parcela",
  "financiamento",
  "simulacao",
  "visita",
  "agendar",
  "disponivel",
  "onde fica",
  "localizacao",
];

const NEGATIVE_TERMS = ["nao tenho interesse", "nao quero", "sem interesse", "nao me interessa"];

export function classifySocialInterestText(text: string) {
  const normalized = normalizeComparableText(text);
  if (!normalized) return false;
  if (NEGATIVE_TERMS.some((term) => normalized.includes(term))) return false;
  return INTEREST_TERMS.some((term) => normalized.includes(term));
}

function extractOpenAIText(payload: any) {
  return (payload?.output ?? [])
    .flatMap((item: any) => item?.content ?? [])
    .filter((content: any) => content?.type === "output_text" && typeof content?.text === "string")
    .map((content: any) => content.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function openAIText(instructions: string, input: unknown) {
  const apiKey = process.env["OPENAI_API_KEY"]?.trim();
  if (!apiKey) return null;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env["OPENAI_MODEL"] || "gpt-5.6",
        instructions,
        input,
        store: false,
      }),
      signal: AbortSignal.timeout(externalServiceParameters().metaTimeoutMs),
    });
    if (!response.ok) return null;
    return extractOpenAIText(await response.json());
  } catch {
    return null;
  }
}

async function classifyInterestWithAI(text: string) {
  const fallback = classifySocialInterestText(text);
  const answer = await openAIText(
    "Classifique somente se o comentário demonstra intenção real de saber mais, preço, disponibilidade, financiamento, visita, localização ou atendimento. Responda exatamente INTERESSE ou SEM_INTERESSE. Não invente contexto.",
    text.slice(0, 1200),
  );
  if (!answer) return fallback;
  const normalized = normalizeComparableText(answer);
  if (normalized === "interesse") return true;
  if (normalized === "sem interesse") return false;
  return fallback;
}

async function pageForOwner(owner: MetaSocialOwner) {
  const config = await getMetaSocialConfig(owner.tenantId, owner.userId);
  return config?.pages.find((page) => page.pageId === owner.pageId) ?? null;
}

async function graphJson(url: string, token: string, body: JsonObject) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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
    throw new Error(String(payload?.error?.message || payload?.raw || `HTTP ${response.status}`).slice(0, 260));
  }
  return payload;
}

async function tenantWhatsAppLink(tenantId: string) {
  const { data } = await (supabaseAdmin as any)
    .from("whatsapp_connections")
    .select("phone_number,status")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data?.phone_number || data.status === "disconnected") return null;
  const phone = normalizeWhatsAppPhone(String(data.phone_number));
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  const text = encodeURIComponent("Olá! Vim pelo Facebook/Instagram e gostaria de mais informações.");
  return `https://wa.me/${digits}?text=${text}`;
}

async function replyToInterestedComment(
  owner: MetaSocialOwner,
  item: Extract<MetaSocialWebhookItem, { kind: "comment" }>,
) {
  const page = await pageForOwner(owner);
  if (!page) return { acted: false, reason: "connection_not_found" };
  const whatsapp = await tenantWhatsAppLink(owner.tenantId);

  if (item.channel === "instagram") {
    if (!page.instagramUserId) return { acted: false, reason: "instagram_not_connected" };
    const text = whatsapp
      ? `Olá! Vi seu interesse 😊 Posso continuar seu atendimento aqui no Direct. Se preferir WhatsApp: ${whatsapp}`
      : "Olá! Vi seu interesse 😊 Posso continuar seu atendimento por aqui no Direct. Responda esta mensagem e eu te ajudo.";
    await graphJson(
      `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(page.instagramUserId)}/messages`,
      page.pageAccessToken,
      { recipient: { comment_id: item.externalId }, message: { text } },
    );
    return { acted: true, reason: "instagram_private_reply" };
  }

  const text = whatsapp
    ? `Olá! Obrigado pelo interesse. Para continuarmos seu atendimento, fale conosco pelo WhatsApp: ${whatsapp}`
    : "Olá! Obrigado pelo interesse. Envie uma mensagem para a página e continuamos seu atendimento por lá.";
  await graphJson(
    `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(item.externalId)}/comments`,
    page.pageAccessToken,
    { message: text },
  );
  return { acted: true, reason: "facebook_comment_reply" };
}

async function replyToDirect(
  owner: MetaSocialOwner,
  item: Extract<MetaSocialWebhookItem, { kind: "message" }>,
) {
  const { data: settings } = await (supabaseAdmin as any)
    .from("ai_agent_settings")
    .select("enabled,auto_reply,system_prompt,handoff_keywords")
    .eq("tenant_id", owner.tenantId)
    .maybeSingle();
  if (!settings?.enabled || !settings?.auto_reply) return { sent: false, reason: "disabled" };
  if (isCourtesyOnlyMessage(item.text)) return { sent: false, reason: "courtesy_only" };

  const normalized = normalizeComparableText(item.text);
  const handoffKeywords = [...PLATFORM_HANDOFF_KEYWORDS, ...(settings.handoff_keywords ?? [])]
    .map((value: unknown) => normalizeComparableText(String(value)))
    .filter(Boolean);
  if (handoffKeywords.some((keyword: string) => normalized.includes(keyword))) {
    return { sent: false, reason: "human_handoff" };
  }

  const response = await openAIText(
    `${buildAutomaticInstructions(settings.system_prompt)}\n\nCanal atual: ${item.channel === "instagram" ? "Instagram Direct" : "Facebook Messenger"}. Responda somente ao que foi perguntado. Não invente preço, disponibilidade, endereço ou condição.`,
    [{ role: "user", content: item.text }],
  );
  const reply = normalizeAutomaticReply(response ?? "");
  if (!reply) return { sent: false, reason: "ai_unavailable" };

  await sendMetaSocialText({
    tenantId: owner.tenantId,
    userId: owner.userId,
    pageId: owner.pageId,
    channel: item.channel,
    recipientId: item.senderId,
    text: reply,
  });
  return { sent: true, reason: "sent" };
}

export async function processMetaSocialWebhook(payload: JsonObject) {
  const items = extractMetaSocialWebhookItems(payload);
  let processed = 0;
  let automated = 0;
  let skipped = 0;

  for (const item of items) {
    try {
      const owner = await resolveOwner(item.accountId);
      if (!owner || (await alreadyProcessed(owner, item.externalId))) {
        skipped += 1;
        continue;
      }

      if (item.kind === "message") {
        const result = await replyToDirect(owner, item);
        await recordAutomation(owner, item, result.reason, { automated: result.sent });
        processed += 1;
        if (result.sent) automated += 1;
        continue;
      }

      const interested = await classifyInterestWithAI(item.text);
      if (!interested) {
        await recordAutomation(owner, item, "comment_without_interest", { interested: false });
        processed += 1;
        continue;
      }

      const result = await replyToInterestedComment(owner, item);
      await recordAutomation(owner, item, result.reason, { interested: true, automated: result.acted });
      processed += 1;
      if (result.acted) automated += 1;
    } catch {
      skipped += 1;
    }
  }

  return { received: items.length, processed, automated, skipped };
}
