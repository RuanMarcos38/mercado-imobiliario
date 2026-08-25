import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  deleteIntegrationSecret,
  readIntegrationSecret,
  writeIntegrationSecret,
} from "@/lib/integration-secrets.server";
import { platformBaseUrl } from "@/lib/platform-parameters.server";

const SECRET_NAME = "google-workspace";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.file",
];

type GoogleSecret = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scope: string;
  tokenType: string;
  email: string | null;
  connectedAt: string;
};

function appConfig() {
  const clientId = process.env["GOOGLE_CLIENT_ID"]?.trim();
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"]?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: `${platformBaseUrl()}/api/public/oauth/google`,
  };
}

function stateSecret() {
  return (
    process.env["GOOGLE_OAUTH_STATE_SECRET"]?.trim() ||
    process.env["GOOGLE_CLIENT_SECRET"]?.trim() ||
    process.env["INTEGRATIONS_ENCRYPTION_KEY"]?.trim() ||
    process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim() ||
    ""
  );
}

function signState(payload: string) {
  const secret = stateSecret();
  if (!secret) throw new Error("GOOGLE_OAUTH_STATE_SECRET_MISSING");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function createState(input: { tenantId: string; userId: string }) {
  const payload = Buffer.from(
    JSON.stringify({ ...input, exp: Date.now() + 10 * 60_000 }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${signState(payload)}`;
}

function verifyState(state: string) {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) throw new Error("GOOGLE_OAUTH_STATE_INVALID");
  const expected = signState(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error("GOOGLE_OAUTH_STATE_INVALID");
  }
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    tenantId?: string;
    userId?: string;
    exp?: number;
  };
  if (!parsed.tenantId || !parsed.userId || !parsed.exp || parsed.exp < Date.now()) {
    throw new Error("GOOGLE_OAUTH_STATE_EXPIRED");
  }
  return { tenantId: parsed.tenantId, userId: parsed.userId };
}

export function getGoogleOAuthUrl(input: { tenantId: string; userId: string }) {
  const app = appConfig();
  if (!app) return null;
  const params = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: app.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    state: createState(input),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function tokenRequest(params: URLSearchParams) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(25_000),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || !payload["access_token"]) {
    throw new Error(
      String(payload["error_description"] || payload["error"] || "GOOGLE_TOKEN_FAILED"),
    );
  }
  return payload;
}

export async function completeGoogleOAuth(input: { code: string; state: string }) {
  const app = appConfig();
  if (!app) throw new Error("GOOGLE_OAUTH_NOT_CONFIGURED");
  const owner = verifyState(input.state);
  const previous = await readIntegrationSecret<GoogleSecret>(
    owner.tenantId,
    owner.userId,
    SECRET_NAME,
  );
  const params = new URLSearchParams({
    client_id: app.clientId,
    client_secret: app.clientSecret,
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: app.redirectUri,
  });
  const payload = await tokenRequest(params);
  const accessToken = String(payload["access_token"]);
  const expiresIn = Number(payload["expires_in"] || 3600);
  const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const userInfo = (await userInfoResponse.json().catch(() => ({}))) as Record<string, unknown>;
  const secret: GoogleSecret = {
    accessToken,
    refreshToken:
      typeof payload["refresh_token"] === "string"
        ? String(payload["refresh_token"])
        : previous?.refreshToken || null,
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
    scope: String(payload["scope"] || GOOGLE_SCOPES.join(" ")),
    tokenType: String(payload["token_type"] || "Bearer"),
    email:
      typeof userInfo["email"] === "string" ? String(userInfo["email"]) : previous?.email || null,
    connectedAt: new Date().toISOString(),
  };
  await writeIntegrationSecret(owner.tenantId, owner.userId, SECRET_NAME, secret);
  await (supabaseAdmin as any).from("integration_accounts").upsert(
    {
      tenant_id: owner.tenantId,
      user_id: owner.userId,
      provider_key: "google_workspace",
      status: "connected",
      account_label: secret.email,
      public_config: { calendar: true, meet: true, drive: true },
      connected_at: secret.connectedAt,
      last_error: null,
      updated_at: secret.connectedAt,
    },
    { onConflict: "user_id,provider_key" },
  );
  return { ...owner, email: secret.email };
}

async function accessToken(tenantId: string, userId: string) {
  const app = appConfig();
  if (!app) throw new Error("GOOGLE_OAUTH_NOT_CONFIGURED");
  const secret = await readIntegrationSecret<GoogleSecret>(tenantId, userId, SECRET_NAME);
  if (!secret) throw new Error("GOOGLE_NOT_CONNECTED");
  if (secret.expiresAt > Date.now() + 90_000) return secret.accessToken;
  if (!secret.refreshToken) throw new Error("GOOGLE_REAUTH_REQUIRED");
  const payload = await tokenRequest(
    new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      refresh_token: secret.refreshToken,
      grant_type: "refresh_token",
    }),
  );
  const refreshed: GoogleSecret = {
    ...secret,
    accessToken: String(payload["access_token"]),
    expiresAt: Date.now() + Number(payload["expires_in"] || 3600) * 1000,
    scope: String(payload["scope"] || secret.scope),
    tokenType: String(payload["token_type"] || secret.tokenType),
  };
  await writeIntegrationSecret(tenantId, userId, SECRET_NAME, refreshed);
  return refreshed.accessToken;
}

export async function getGoogleWorkspaceSummary(tenantId: string, userId: string) {
  const configured = Boolean(appConfig());
  const secret = configured
    ? await readIntegrationSecret<GoogleSecret>(tenantId, userId, SECRET_NAME).catch(() => null)
    : null;
  return {
    configured,
    connected: Boolean(secret),
    email: secret?.email ?? null,
    connectedAt: secret?.connectedAt ?? null,
    scopes: secret?.scope ? secret.scope.split(/\s+/).filter(Boolean) : [],
  };
}

export async function disconnectGoogleWorkspace(tenantId: string, userId: string) {
  await deleteIntegrationSecret(tenantId, userId, SECRET_NAME).catch(() => undefined);
  await (supabaseAdmin as any).from("integration_accounts").upsert(
    {
      tenant_id: tenantId,
      user_id: userId,
      provider_key: "google_workspace",
      status: "disconnected",
      account_label: null,
      public_config: {},
      connected_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider_key" },
  );
}

export async function createGoogleCalendarMeeting(input: {
  tenantId: string;
  userId: string;
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  attendeeEmail?: string | null;
}) {
  const token = await accessToken(input.tenantId, input.userId);
  const eventBody: Record<string, unknown> = {
    summary: input.title,
    description: input.description || undefined,
    start: { dateTime: input.startsAt, timeZone: input.timezone },
    end: { dateTime: input.endsAt, timeZone: input.timezone },
    conferenceData: { createRequest: { requestId: randomUUID() } },
  };
  if (input.attendeeEmail) eventBody["attendees"] = [{ email: input.attendeeEmail }];
  const endpoint =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(eventBody),
    signal: AbortSignal.timeout(25_000),
  });
  let event = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok || !event.id) {
    throw new Error(String(event?.error?.message || `GOOGLE_CALENDAR_HTTP_${response.status}`));
  }
  for (let attempt = 0; attempt < 3 && !event.hangoutLink; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const check = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(String(event.id))}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (check.ok) event = (await check.json()) as Record<string, any>;
  }
  const meetUrl =
    (typeof event.hangoutLink === "string" && event.hangoutLink) ||
    event?.conferenceData?.entryPoints?.find((entry: any) => entry?.entryPointType === "video")
      ?.uri ||
    null;
  return {
    eventId: String(event.id),
    calendarId: "primary",
    meetUrl: meetUrl ? String(meetUrl) : null,
    htmlLink: typeof event.htmlLink === "string" ? event.htmlLink : null,
  };
}

export async function cancelGoogleCalendarMeeting(input: {
  tenantId: string;
  userId: string;
  eventId: string;
  calendarId?: string | null;
}) {
  const token = await accessToken(input.tenantId, input.userId);
  const calendarId = input.calendarId || "primary";
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.eventId)}?sendUpdates=all`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(`GOOGLE_CALENDAR_DELETE_${response.status}`);
  }
}

export async function uploadGoogleDriveFile(input: {
  tenantId: string;
  userId: string;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}) {
  const token = await accessToken(input.tenantId, input.userId);
  const metadata = JSON.stringify({ name: input.name, mimeType: input.mimeType });
  const form = new FormData();
  form.append("metadata", new Blob([metadata], { type: "application/json" }));
  form.append("file", new Blob([input.bytes], { type: input.mimeType }), input.name);
  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,createdTime",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(40_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || !payload["id"]) {
    throw new Error(
      String((payload["error"] as any)?.message || `GOOGLE_DRIVE_HTTP_${response.status}`),
    );
  }
  return payload;
}

export async function backupCrmSnapshotToDrive(tenantId: string, userId: string) {
  const db = supabaseAdmin as any;
  const [{ data: opportunities }, { data: appointments }, { data: documents }] = await Promise.all([
    db
      .from("crm_opportunities")
      .select("*")
      .eq("tenant_id", tenantId)
      .or(`owner_user_id.eq.${userId},owner_user_id.is.null`)
      .order("updated_at", { ascending: false })
      .limit(2000),
    db
      .from("crm_appointments")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("owner_user_id", userId)
      .order("starts_at", { ascending: false })
      .limit(2000),
    db
      .from("crm_documents")
      .select("id,opportunity_id,name,document_type,status,created_at,updated_at")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .limit(2000),
  ]);
  const payload = {
    generatedAt: new Date().toISOString(),
    product: "MercadoImobi",
    tenantId,
    userId,
    opportunities: opportunities ?? [],
    appointments: appointments ?? [],
    documents: documents ?? [],
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
  const fileName = `MercadoImobi-backup-${new Date().toISOString().slice(0, 10)}.json`;
  return uploadGoogleDriveFile({
    tenantId,
    userId,
    name: fileName,
    mimeType: "application/json",
    bytes,
  });
}
