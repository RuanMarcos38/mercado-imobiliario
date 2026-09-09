import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  deleteIntegrationSecret,
  readIntegrationSecret,
  writeIntegrationSecret,
} from "@/lib/integration-secrets.server";
import { normalizeComparableText } from "@/lib/ai-conversation-policy";
import { externalServiceParameters, platformBaseUrl } from "@/lib/platform-parameters.server";

const SECRET_NAME = "meta-social";

export type SocialChannel = "facebook" | "instagram";

export type MetaPageConnection = {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  instagramUserId: string | null;
  instagramUsername: string | null;
};

export type MetaSocialConfig = {
  connectedAt: string;
  pages: MetaPageConnection[];
};

export type SocialConversation = {
  id: string;
  conversationId: string;
  channel: SocialChannel;
  pageId: string;
  accountName: string;
  contactId: string;
  contactName: string;
  lastMessage: string;
  updatedTime: string | null;
};

export type SocialMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  senderName: string | null;
  createdTime: string | null;
  attachments: Array<{ type: string; url: string | null }>;
};

export type SocialInterestComment = {
  id: string;
  channel: SocialChannel;
  pageId: string;
  accountName: string;
  sourceId: string;
  sourceCaption: string | null;
  sourcePermalinkUrl: string | null;
  commentId: string;
  authorId: string | null;
  authorName: string;
  text: string;
  createdTime: string | null;
  permalinkUrl: string | null;
  matchedKeywords: string[];
  interestScore: number;
  inviteStatus: "not_sent" | "sent" | "failed";
  inviteError?: string;
  suggestedMessage: string;
  whatsappAvailable: boolean;
};

export type SocialCommentScanResult = {
  scannedAt: string;
  scannedSources: number;
  scannedComments: number;
  interestedComments: SocialInterestComment[];
  sentInvites: number;
  errors: string[];
};

function baseUrl() {
  return platformBaseUrl();
}

function metaAppConfig() {
  const appId = process.env["META_APP_ID"]?.trim();
  const appSecret = process.env["META_APP_SECRET"]?.trim();
  if (!appId || !appSecret) return null;
  return {
    appId,
    appSecret,
    redirectUri: `${baseUrl()}/api/public/oauth/meta`,
  };
}

function stateSecret() {
  return (
    process.env["META_OAUTH_STATE_SECRET"]?.trim() ||
    process.env["META_APP_SECRET"]?.trim() ||
    process.env["INTEGRATIONS_ENCRYPTION_KEY"]?.trim() ||
    process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim() ||
    ""
  );
}

function signStatePayload(payload: string) {
  const secret = stateSecret();
  if (!secret) throw new Error("META_OAUTH_STATE_SECRET_MISSING");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createMetaOAuthState(input: { tenantId: string; userId: string }) {
  const payload = Buffer.from(
    JSON.stringify({
      tenantId: input.tenantId,
      userId: input.userId,
      exp: Date.now() + 10 * 60_000,
    }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${signStatePayload(payload)}`;
}

export function verifyMetaOAuthState(state: string) {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) throw new Error("META_OAUTH_STATE_INVALID");
  const expected = signStatePayload(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error("META_OAUTH_STATE_INVALID");
  }
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    tenantId?: string;
    userId?: string;
    exp?: number;
  };
  if (!parsed.tenantId || !parsed.userId || !parsed.exp || parsed.exp < Date.now()) {
    throw new Error("META_OAUTH_STATE_EXPIRED");
  }
  return { tenantId: parsed.tenantId, userId: parsed.userId };
}

export function getMetaOAuthUrl(input: { tenantId: string; userId: string }) {
  const app = metaAppConfig();
  if (!app) return null;
  const scopes =
    process.env["META_OAUTH_SCOPES"]?.trim() ||
    [
      "pages_show_list",
      "pages_read_engagement",
      "pages_read_user_content",
      "pages_manage_metadata",
      "pages_messaging",
      "pages_manage_engagement",
      "instagram_basic",
      "instagram_manage_messages",
      "instagram_manage_comments",
    ].join(",");
  const params = new URLSearchParams({
    client_id: app.appId,
    redirect_uri: app.redirectUri,
    response_type: "code",
    scope: scopes,
    state: createMetaOAuthState(input),
  });
  return `https://www.facebook.com/dialog/oauth?${params.toString()}`;
}

async function metaJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
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
    throw new Error(`META_API_FAILED:${String(message).slice(0, 260)}`);
  }
  return payload;
}

const DEFAULT_INTEREST_KEYWORDS = [
  "quero",
  "interesse",
  "interessado",
  "interessada",
  "valor",
  "preco",
  "preço",
  "disponivel",
  "disponível",
  "visita",
  "visitar",
  "endereco",
  "endereço",
  "financiamento",
  "entrada",
  "parcela",
  "whatsapp",
  "zap",
  "direct",
  "corretor",
  "simulacao",
  "simulação",
  "comprar",
  "alugar",
  "aluguel",
  "imovel",
  "imóvel",
  "apartamento",
  "casa",
  "terreno",
] as const;

type SocialSource = {
  id: string;
  channel: SocialChannel;
  pageId: string;
  accountName: string;
  caption: string | null;
  permalinkUrl: string | null;
  createdTime: string | null;
};

type SocialCommentEventState = {
  seen: Set<string>;
  sent: Set<string>;
};

function clampInteger(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value ?? fallback)));
}

function accountNameForPage(page: MetaPageConnection, channel: SocialChannel) {
  if (channel === "instagram")
    return page.instagramUsername ? `@${page.instagramUsername}` : page.pageName;
  return page.pageName;
}

function matchedInterestKeywords(text: string, keywords?: string[]) {
  const normalizedText = normalizeComparableText(text);
  if (!normalizedText) return [];
  const haystack = ` ${normalizedText} `;
  const terms = (keywords?.length ? keywords : [...DEFAULT_INTEREST_KEYWORDS])
    .map((keyword) => normalizeComparableText(keyword))
    .filter(Boolean);
  return [
    ...new Set(terms.filter((term) => haystack.includes(` ${term} `) || haystack.includes(term))),
  ];
}

function scoreInterestComment(text: string, matchedKeywords: string[]) {
  if (!matchedKeywords.length) return 0;
  let score = Math.min(75, matchedKeywords.length * 18);
  if (text.includes("?")) score += 10;
  if (/\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-.\s]?\d{4}\b/.test(text)) score += 15;
  return Math.min(100, score);
}

function whatsappLink(value?: string) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const withCountry = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${withCountry}`;
}

function socialInviteMessage(input: {
  channel: SocialChannel;
  whatsappNumber?: string;
  inviteMessage?: string;
}) {
  const custom = input.inviteMessage?.trim();
  if (custom) return custom.slice(0, 700);
  const link = whatsappLink(input.whatsappNumber);
  if (link) {
    return `Olá, vi seu comentário e posso te ajudar com os detalhes do imóvel. Podemos continuar por aqui ou pelo WhatsApp: ${link}`;
  }
  return input.channel === "instagram"
    ? "Olá, vi seu comentário e posso te ajudar com os detalhes do imóvel. Podemos continuar pelo Direct?"
    : "Olá, vi seu comentário e posso te ajudar com os detalhes do imóvel. Podemos continuar pelo Messenger?";
}

function socialCommentText(channel: SocialChannel, comment: any) {
  return String(channel === "instagram" ? (comment?.text ?? "") : (comment?.message ?? "")).trim();
}

function socialCommentAuthor(channel: SocialChannel, comment: any) {
  if (channel === "instagram") {
    return {
      id: null,
      name: String(comment?.username ?? "Contato"),
    };
  }
  return {
    id: comment?.from?.id ? String(comment.from.id) : null,
    name: String(comment?.from?.name ?? "Contato"),
  };
}

async function fetchSocialSources(input: {
  page: MetaPageConnection;
  channel: SocialChannel;
  sourceId?: string;
  sourceLimit: number;
}) {
  const { page, channel } = input;
  if (channel === "instagram" && !page.instagramUserId) return [] as SocialSource[];
  if (input.sourceId) {
    const params = new URLSearchParams({
      fields:
        channel === "instagram"
          ? "id,caption,timestamp,permalink"
          : "id,message,created_time,permalink_url",
      access_token: page.pageAccessToken,
    });
    const item = await metaJson(
      `https://graph.facebook.com/${encodeURIComponent(input.sourceId)}?${params.toString()}`,
    );
    return [
      {
        id: String(item?.id ?? input.sourceId),
        channel,
        pageId: page.pageId,
        accountName: accountNameForPage(page, channel),
        caption:
          channel === "instagram" ? String(item?.caption ?? "") : String(item?.message ?? ""),
        permalinkUrl: item?.permalink
          ? String(item.permalink)
          : item?.permalink_url
            ? String(item.permalink_url)
            : null,
        createdTime: item?.timestamp
          ? String(item.timestamp)
          : item?.created_time
            ? String(item.created_time)
            : null,
      },
    ];
  }

  const params = new URLSearchParams({
    fields:
      channel === "instagram"
        ? "id,caption,timestamp,permalink"
        : "id,message,created_time,permalink_url",
    limit: String(input.sourceLimit),
    access_token: page.pageAccessToken,
  });
  const ownerId = channel === "instagram" ? page.instagramUserId : page.pageId;
  const edge = channel === "instagram" ? "media" : "posts";
  const payload = await metaJson(
    `https://graph.facebook.com/${encodeURIComponent(ownerId!)}/${edge}?${params.toString()}`,
  );
  return (payload.data ?? []).map(
    (item: any) =>
      ({
        id: String(item?.id ?? ""),
        channel,
        pageId: page.pageId,
        accountName: accountNameForPage(page, channel),
        caption:
          channel === "instagram" ? String(item?.caption ?? "") : String(item?.message ?? ""),
        permalinkUrl: item?.permalink
          ? String(item.permalink)
          : item?.permalink_url
            ? String(item.permalink_url)
            : null,
        createdTime: item?.timestamp
          ? String(item.timestamp)
          : item?.created_time
            ? String(item.created_time)
            : null,
      }) satisfies SocialSource,
  );
}

async function fetchSocialComments(input: {
  page: MetaPageConnection;
  source: SocialSource;
  commentLimit: number;
}) {
  const params = new URLSearchParams({
    fields:
      input.source.channel === "instagram"
        ? "id,text,username,timestamp"
        : "id,message,from,created_time,permalink_url",
    limit: String(input.commentLimit),
    access_token: input.page.pageAccessToken,
  });
  if (input.source.channel === "facebook") params.set("filter", "stream");
  const payload = await metaJson(
    `https://graph.facebook.com/${encodeURIComponent(input.source.id)}/comments?${params.toString()}`,
  );
  return payload.data ?? [];
}

async function sendSocialCommentPrivateReply(input: {
  page: MetaPageConnection;
  channel: SocialChannel;
  commentId: string;
  text: string;
}) {
  if (input.channel === "instagram") {
    return metaJson(
      `https://graph.facebook.com/${encodeURIComponent(input.commentId)}/private_replies`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${input.page.pageAccessToken}` },
        body: JSON.stringify({ message: input.text }),
      },
    );
  }
  return metaJson(`https://graph.facebook.com/${encodeURIComponent(input.page.pageId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.page.pageAccessToken}` },
    body: JSON.stringify({
      messaging_type: "RESPONSE",
      recipient: { comment_id: input.commentId },
      message: { text: input.text },
    }),
  });
}

function metadataCommentId(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const value = (metadata as Record<string, unknown>)["commentId"];
  return typeof value === "string" ? value : "";
}

function metadataInviteStatus(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const value = (metadata as Record<string, unknown>)["inviteStatus"];
  return typeof value === "string" ? value : "";
}

async function recentSocialCommentEventState(tenantId: string) {
  const db = supabaseAdmin as any;
  const { data } = await db
    .from("system_events")
    .select("metadata")
    .eq("tenant_id", tenantId)
    .eq("event_type", "meta_social_interest_comment")
    .order("created_at", { ascending: false })
    .limit(1000);
  return (data ?? []).reduce<SocialCommentEventState>(
    (state, event: any) => {
      const commentId = metadataCommentId(event?.metadata);
      if (!commentId) return state;
      state.seen.add(commentId);
      if (metadataInviteStatus(event.metadata) === "sent") state.sent.add(commentId);
      return state;
    },
    { seen: new Set<string>(), sent: new Set<string>() },
  );
}

async function recordSocialInterestEvent(tenantId: string, item: SocialInterestComment) {
  const db = supabaseAdmin as any;
  await db.from("system_events").insert({
    tenant_id: tenantId,
    event_type: "meta_social_interest_comment",
    severity: item.inviteStatus === "failed" ? "warning" : "info",
    message: `${item.authorName}: ${item.text}`.slice(0, 500),
    metadata: {
      channel: item.channel,
      pageId: item.pageId,
      accountName: item.accountName,
      sourceId: item.sourceId,
      sourceCaption: item.sourceCaption,
      sourcePermalinkUrl: item.sourcePermalinkUrl,
      commentId: item.commentId,
      authorId: item.authorId,
      authorName: item.authorName,
      text: item.text,
      permalinkUrl: item.permalinkUrl,
      matchedKeywords: item.matchedKeywords,
      interestScore: item.interestScore,
      inviteStatus: item.inviteStatus,
      inviteError: item.inviteError ?? null,
      suggestedMessage: item.suggestedMessage,
      whatsappAvailable: item.whatsappAvailable,
    },
  });
}

export async function completeMetaOAuth(input: { code: string; state: string }) {
  const app = metaAppConfig();
  if (!app) throw new Error("META_APP_NOT_CONFIGURED");
  const owner = verifyMetaOAuthState(input.state);
  const tokenParams = new URLSearchParams({
    client_id: app.appId,
    client_secret: app.appSecret,
    redirect_uri: app.redirectUri,
    code: input.code,
  });
  const tokenPayload = await metaJson(
    `https://graph.facebook.com/oauth/access_token?${tokenParams.toString()}`,
  );
  let userAccessToken = String(tokenPayload.access_token ?? "");
  if (!userAccessToken) throw new Error("META_ACCESS_TOKEN_MISSING");

  try {
    const longParams = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: app.appId,
      client_secret: app.appSecret,
      fb_exchange_token: userAccessToken,
    });
    const longPayload = await metaJson(
      `https://graph.facebook.com/oauth/access_token?${longParams.toString()}`,
    );
    if (longPayload.access_token) userAccessToken = String(longPayload.access_token);
  } catch {
    // The short-lived token can still be used to retrieve page tokens when long-lived exchange is unavailable.
  }

  const accountsParams = new URLSearchParams({
    fields: "id,name,access_token,instagram_business_account{id,username}",
    limit: "100",
    access_token: userAccessToken,
  });
  const accounts = await metaJson(
    `https://graph.facebook.com/me/accounts?${accountsParams.toString()}`,
  );
  const pages: MetaPageConnection[] = (accounts.data ?? [])
    .map((page: any) => ({
      pageId: String(page?.id ?? ""),
      pageName: String(page?.name ?? "Página do Facebook"),
      pageAccessToken: String(page?.access_token ?? ""),
      instagramUserId: page?.instagram_business_account?.id
        ? String(page.instagram_business_account.id)
        : null,
      instagramUsername: page?.instagram_business_account?.username
        ? String(page.instagram_business_account.username)
        : null,
    }))
    .filter((page: MetaPageConnection) => page.pageId && page.pageAccessToken);

  if (!pages.length) throw new Error("META_NO_MANAGED_PAGES");
  const config: MetaSocialConfig = { connectedAt: new Date().toISOString(), pages };
  await writeIntegrationSecret(owner.tenantId, owner.userId, SECRET_NAME, config);
  return {
    ...owner,
    pageCount: pages.length,
    instagramCount: pages.filter((p) => p.instagramUserId).length,
  };
}

export async function getMetaSocialConfig(tenantId: string, userId: string) {
  return readIntegrationSecret<MetaSocialConfig>(tenantId, userId, SECRET_NAME);
}

export async function disconnectMetaSocial(tenantId: string, userId: string) {
  await deleteIntegrationSecret(tenantId, userId, SECRET_NAME);
}

function participantForConversation(
  conversation: any,
  page: MetaPageConnection,
  channel: SocialChannel,
) {
  const ownIds = new Set(
    [page.pageId, channel === "instagram" ? page.instagramUserId : null].filter(Boolean),
  );
  const participants = conversation?.participants?.data ?? [];
  const external = participants.find(
    (participant: any) => !ownIds.has(String(participant?.id ?? "")),
  );
  return {
    id: String(external?.id ?? ""),
    name: String(external?.name ?? external?.username ?? "Contato"),
  };
}

async function fetchConversationsForPage(page: MetaPageConnection, channel: SocialChannel) {
  if (channel === "instagram" && !page.instagramUserId) return [] as SocialConversation[];
  const params = new URLSearchParams({
    fields: "id,updated_time,participants,messages.limit(1){id,message,from,created_time}",
    limit: "50",
    access_token: page.pageAccessToken,
  });
  if (channel === "instagram") params.set("platform", "instagram");
  const payload = await metaJson(
    `https://graph.facebook.com/${encodeURIComponent(page.pageId)}/conversations?${params.toString()}`,
  );
  return (payload.data ?? []).map((conversation: any) => {
    const participant = participantForConversation(conversation, page, channel);
    const latest = conversation?.messages?.data?.[0];
    return {
      id: `${channel}:${page.pageId}:${conversation.id}`,
      conversationId: String(conversation.id),
      channel,
      pageId: page.pageId,
      accountName:
        channel === "instagram"
          ? page.instagramUsername
            ? `@${page.instagramUsername}`
            : page.pageName
          : page.pageName,
      contactId: participant.id,
      contactName: participant.name,
      lastMessage: String(latest?.message ?? ""),
      updatedTime: conversation?.updated_time ? String(conversation.updated_time) : null,
    } satisfies SocialConversation;
  });
}

export async function listMetaSocialConversations(input: {
  tenantId: string;
  userId: string;
  channel?: SocialChannel | "all";
}) {
  const config = await getMetaSocialConfig(input.tenantId, input.userId);
  if (!config) return [] as SocialConversation[];
  const channels: SocialChannel[] =
    !input.channel || input.channel === "all" ? ["facebook", "instagram"] : [input.channel];
  const jobs = config.pages.flatMap((page) =>
    channels.map((channel) => fetchConversationsForPage(page, channel)),
  );
  const settled = await Promise.allSettled(jobs);
  return settled
    .flatMap((entry) => (entry.status === "fulfilled" ? entry.value : []))
    .sort((a, b) => String(b.updatedTime ?? "").localeCompare(String(a.updatedTime ?? "")));
}

export async function listMetaSocialMessages(input: {
  tenantId: string;
  userId: string;
  pageId: string;
  conversationId: string;
  channel: SocialChannel;
}) {
  const config = await getMetaSocialConfig(input.tenantId, input.userId);
  const page = config?.pages.find((item) => item.pageId === input.pageId);
  if (!page) throw new Error("META_CONNECTION_NOT_FOUND");
  const params = new URLSearchParams({
    fields: "messages.limit(100){id,message,from,to,created_time,attachments}",
    access_token: page.pageAccessToken,
  });
  const payload = await metaJson(
    `https://graph.facebook.com/${encodeURIComponent(input.conversationId)}?${params.toString()}`,
  );
  const ownIds = new Set([page.pageId, page.instagramUserId].filter(Boolean));
  return (payload?.messages?.data ?? [])
    .map((message: any) => {
      const attachments = (message?.attachments?.data ?? []).map((attachment: any) => ({
        type: String(attachment?.mime_type ?? attachment?.type ?? "mídia"),
        url: attachment?.image_data?.url
          ? String(attachment.image_data.url)
          : attachment?.file_url
            ? String(attachment.file_url)
            : null,
      }));
      return {
        id: String(message?.id ?? crypto.randomUUID()),
        direction: ownIds.has(String(message?.from?.id ?? "")) ? "outbound" : "inbound",
        body: String(message?.message ?? ""),
        senderName: message?.from?.name ? String(message.from.name) : null,
        createdTime: message?.created_time ? String(message.created_time) : null,
        attachments,
      } satisfies SocialMessage;
    })
    .reverse();
}

export async function sendMetaSocialText(input: {
  tenantId: string;
  userId: string;
  pageId: string;
  channel: SocialChannel;
  recipientId: string;
  text: string;
}) {
  const config = await getMetaSocialConfig(input.tenantId, input.userId);
  const page = config?.pages.find((item) => item.pageId === input.pageId);
  if (!page) throw new Error("META_CONNECTION_NOT_FOUND");
  const senderId = input.channel === "instagram" ? page.instagramUserId : page.pageId;
  if (!senderId) throw new Error("INSTAGRAM_NOT_CONNECTED");
  const endpoint = `https://graph.facebook.com/${encodeURIComponent(senderId)}/messages`;
  const body: Record<string, unknown> = {
    recipient: { id: input.recipientId },
    message: { text: input.text },
  };
  if (input.channel === "facebook") body["messaging_type"] = "RESPONSE";
  return metaJson(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${page.pageAccessToken}` },
    body: JSON.stringify(body),
  });
}

export async function scanMetaSocialComments(input: {
  tenantId: string;
  userId: string;
  channel?: SocialChannel | "all";
  pageId?: string;
  sourceId?: string;
  sourceLimit?: number;
  commentLimit?: number;
  keywords?: string[];
  sendPrivateReplies?: boolean;
  whatsappNumber?: string;
  inviteMessage?: string;
}) {
  const config = await getMetaSocialConfig(input.tenantId, input.userId);
  if (!config?.pages.length) throw new Error("META_CONNECTION_NOT_FOUND");

  const channels: SocialChannel[] =
    !input.channel || input.channel === "all" ? ["facebook", "instagram"] : [input.channel];
  const pages = input.pageId
    ? config.pages.filter((page) => page.pageId === input.pageId)
    : config.pages;
  if (!pages.length) throw new Error("META_CONNECTION_NOT_FOUND");

  const result: SocialCommentScanResult = {
    scannedAt: new Date().toISOString(),
    scannedSources: 0,
    scannedComments: 0,
    interestedComments: [],
    sentInvites: 0,
    errors: [],
  };
  const eventState = await recentSocialCommentEventState(input.tenantId);
  const sourceLimit = clampInteger(input.sourceLimit, 5, 1, 20);
  const commentLimit = clampInteger(input.commentLimit, 25, 1, 100);

  for (const page of pages) {
    for (const channel of channels) {
      try {
        const sources = await fetchSocialSources({
          page,
          channel,
          sourceId: input.sourceId,
          sourceLimit,
        });
        result.scannedSources += sources.length;
        for (const source of sources) {
          if (!source.id) continue;
          try {
            const comments = await fetchSocialComments({ page, source, commentLimit });
            result.scannedComments += comments.length;
            for (const comment of comments) {
              const text = socialCommentText(channel, comment);
              if (!text) continue;
              const matchedKeywords = matchedInterestKeywords(text, input.keywords);
              const interestScore = scoreInterestComment(text, matchedKeywords);
              if (!interestScore) continue;

              const commentId = String(comment?.id ?? "");
              if (!commentId) continue;
              const author = socialCommentAuthor(channel, comment);
              const suggestedMessage = socialInviteMessage({
                channel,
                whatsappNumber: input.whatsappNumber,
                inviteMessage: input.inviteMessage,
              });
              let inviteStatus: SocialInterestComment["inviteStatus"] = "not_sent";
              let inviteError = "";

              if (input.sendPrivateReplies) {
                if (eventState.sent.has(commentId)) {
                  inviteError = "Convite privado já enviado anteriormente.";
                } else {
                  try {
                    await sendSocialCommentPrivateReply({
                      page,
                      channel,
                      commentId,
                      text: suggestedMessage,
                    });
                    inviteStatus = "sent";
                    result.sentInvites += 1;
                    eventState.sent.add(commentId);
                  } catch (error) {
                    inviteStatus = "failed";
                    inviteError =
                      error instanceof Error ? error.message : "META_PRIVATE_REPLY_FAILED";
                  }
                }
              }

              const item: SocialInterestComment = {
                id: `${channel}:${page.pageId}:${commentId}`,
                channel,
                pageId: page.pageId,
                accountName: source.accountName,
                sourceId: source.id,
                sourceCaption: source.caption,
                sourcePermalinkUrl: source.permalinkUrl,
                commentId,
                authorId: author.id,
                authorName: author.name,
                text,
                createdTime: comment?.timestamp
                  ? String(comment.timestamp)
                  : comment?.created_time
                    ? String(comment.created_time)
                    : null,
                permalinkUrl: comment?.permalink_url
                  ? String(comment.permalink_url)
                  : source.permalinkUrl,
                matchedKeywords,
                interestScore,
                inviteStatus,
                ...(inviteError ? { inviteError } : {}),
                suggestedMessage,
                whatsappAvailable: Boolean(whatsappLink(input.whatsappNumber)),
              };
              result.interestedComments.push(item);

              if (!eventState.seen.has(commentId) || inviteStatus === "sent") {
                try {
                  await recordSocialInterestEvent(input.tenantId, item);
                  eventState.seen.add(commentId);
                } catch (error) {
                  result.errors.push(
                    error instanceof Error ? error.message : "META_SOCIAL_EVENT_RECORD_FAILED",
                  );
                }
              }
            }
          } catch (error) {
            result.errors.push(error instanceof Error ? error.message : "META_COMMENTS_FAILED");
          }
        }
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : "META_SOURCES_FAILED");
      }
    }
  }

  result.interestedComments.sort((a, b) => b.interestScore - a.interestScore);
  return result;
}

export async function testMetaConnection(tenantId: string, userId: string) {
  const config = await getMetaSocialConfig(tenantId, userId);
  if (!config?.pages.length)
    return { configured: Boolean(metaAppConfig()), connected: false, ok: false };
  const page = config.pages[0];
  try {
    const params = new URLSearchParams({
      fields: "id,name",
      access_token: page.pageAccessToken,
    });
    await metaJson(
      `https://graph.facebook.com/${encodeURIComponent(page.pageId)}?${params.toString()}`,
    );
    return { configured: true, connected: true, ok: true };
  } catch (error) {
    return {
      configured: true,
      connected: true,
      ok: false,
      error: error instanceof Error ? error.message : "META_TEST_FAILED",
    };
  }
}
