import { createHmac, timingSafeEqual } from "node:crypto";
import {
  deleteIntegrationSecret,
  readIntegrationSecret,
  writeIntegrationSecret,
} from "@/lib/integration-secrets.server";
import {
  externalServiceParameters,
  platformBaseUrl,
} from "@/lib/platform-parameters.server";

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
      "pages_manage_metadata",
      "pages_messaging",
      "instagram_basic",
      "instagram_manage_messages",
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
    !input.channel || input.channel === "all"
      ? ["facebook", "instagram"]
      : [input.channel];
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
