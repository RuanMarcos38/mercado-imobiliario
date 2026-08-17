import { createHmac, timingSafeEqual } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";
import { externalServiceParameters, platformBaseUrl } from "@/lib/platform-parameters.server";

const callSchema = z.object({
  agentPhone: z.string().trim().min(8).max(30),
  customerPhone: z.string().trim().min(8).max(30),
  leadId: z.string().uuid().optional(),
});

function normalizeE164(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (trimmed.startsWith("+") && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55"))
    return `+55${digits}`;
  if (digits.length >= 12 && digits.length <= 15) return `+${digits}`;
  return null;
}

function twilioConfig() {
  const accountSid = process.env["TWILIO_ACCOUNT_SID"]?.trim();
  const authToken = process.env["TWILIO_AUTH_TOKEN"]?.trim();
  const fromNumber = normalizeE164(process.env["TWILIO_PHONE_NUMBER"]?.trim() || "");
  if (!accountSid || !authToken || !fromNumber) return null;
  return {
    accountSid,
    authToken,
    fromNumber,
    apiKeySid: process.env["TWILIO_API_KEY_SID"]?.trim() || null,
    apiKeySecret: process.env["TWILIO_API_KEY_SECRET"]?.trim() || null,
  };
}

function appBaseUrl() {
  return platformBaseUrl();
}

function voiceSecret() {
  return (
    process.env["VOICE_WEBHOOK_SECRET"]?.trim() || process.env["TWILIO_AUTH_TOKEN"]?.trim() || ""
  );
}

export function createVoiceBridgeToken(customerPhone: string) {
  const secret = voiceSecret();
  if (!secret) throw new Error("VOICE_WEBHOOK_SECRET_MISSING");
  const { voiceBridgeTokenMinutes } = externalServiceParameters();
  const exp = Date.now() + voiceBridgeTokenMinutes * 60_000;
  const payload = Buffer.from(JSON.stringify({ to: customerPhone, exp }), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyVoiceBridgeToken(token: string) {
  const secret = voiceSecret();
  if (!secret) throw new Error("VOICE_WEBHOOK_SECRET_MISSING");
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw new Error("VOICE_TOKEN_INVALID");
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right))
    throw new Error("VOICE_TOKEN_INVALID");
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    to?: string;
    exp?: number;
  };
  if (!parsed.to || !parsed.exp || parsed.exp < Date.now()) throw new Error("VOICE_TOKEN_EXPIRED");
  const to = normalizeE164(parsed.to);
  if (!to) throw new Error("VOICE_NUMBER_INVALID");
  return { to };
}

export const getDialerStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const config = twilioConfig();
    return {
      configured: Boolean(config),
      callerNumber: config?.fromNumber
        ? `${config.fromNumber.slice(0, 4)}••••${config.fromNumber.slice(-3)}`
        : null,
    };
  });

export const startDialerCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => callSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requireTenantId(context.supabase, context.userId);
    const config = twilioConfig();
    if (!config) throw new Error("TWILIO_NOT_CONFIGURED");
    const agentPhone = normalizeE164(data.agentPhone);
    const customerPhone = normalizeE164(data.customerPhone);
    if (!agentPhone) throw new Error("Informe seu telefone com DDD para receber a chamada.");
    if (!customerPhone) throw new Error("Informe o telefone do cliente com DDD.");

    const bridge = new URL("/api/public/voice/bridge", appBaseUrl());
    bridge.searchParams.set("token", createVoiceBridgeToken(customerPhone));

    const params = new URLSearchParams({
      To: agentPhone,
      From: config.fromNumber,
      Url: bridge.toString(),
      Method: "POST",
    });
    const authUser = config.apiKeySid || config.accountSid;
    const authPass = config.apiKeySecret || config.authToken;
    const { twilioTimeoutMs } = externalServiceParameters();
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${authUser}:${authPass}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
        signal: AbortSignal.timeout(twilioTimeoutMs),
      },
    );
    const text = await response.text();
    let payload: any = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      throw new Error(
        `TWILIO_CALL_FAILED:${response.status}:${String(payload?.message ?? payload?.raw ?? "").slice(0, 220)}`,
      );
    }
    return {
      success: true,
      callSid: payload?.sid ? String(payload.sid) : null,
      agentPhone,
      customerPhone,
      status: payload?.status ? String(payload.status) : "queued",
    };
  });

export async function testTwilioRuntime() {
  const config = twilioConfig();
  if (!config) return { configured: false, ok: false };
  const authUser = config.apiKeySid || config.accountSid;
  const authPass = config.apiKeySecret || config.authToken;
  const { diagnosticTimeoutMs } = externalServiceParameters();
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}.json`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${authUser}:${authPass}`).toString("base64")}`,
        },
        signal: AbortSignal.timeout(diagnosticTimeoutMs),
      },
    );
    return { configured: true, ok: response.ok, status: response.status };
  } catch {
    return { configured: true, ok: false };
  }
}
