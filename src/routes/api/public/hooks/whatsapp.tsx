import { createFileRoute } from "@tanstack/react-router";
import { evolutionGatewayConfig } from "@/lib/evolution-instance.server";

type JsonObject = Record<string, unknown>;

type AutoReplyCandidate = {
  tenantId: string;
  conversationId: string;
  phone: string;
  inboundText: string;
  inboundSentAt: string;
  inboundExternalMessageId: string | null;
};

function object(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function textFromMessage(message: JsonObject): string | null {
  if (typeof message["conversation"] === "string") return message["conversation"] as string;
  const extended = object(message["extendedTextMessage"]);
  if (typeof extended["text"] === "string") return extended["text"] as string;
  for (const key of ["imageMessage", "videoMessage", "documentMessage"]) {
    const media = object(message[key]);
    if (typeof media["caption"] === "string") return media["caption"] as string;
  }
  const button = object(message["buttonsResponseMessage"]);
  if (typeof button["selectedDisplayText"] === "string")
    return button["selectedDisplayText"] as string;
  const list = object(message["listResponseMessage"]);
  const single = object(list["singleSelectReply"]);
  if (typeof single["selectedRowId"] === "string") return single["selectedRowId"] as string;
  return null;
}

function messageType(message: JsonObject): string {
  if (message["imageMessage"]) return "image";
  if (message["videoMessage"]) return "video";
  if (message["audioMessage"]) return "audio";
  if (message["documentMessage"]) return "document";
  if (message["stickerMessage"]) return "sticker";
  return "text";
}

function mediaUrlFromMessage(message: JsonObject): string | null {
  for (const key of ["imageMessage", "videoMessage", "audioMessage", "documentMessage"]) {
    const media = object(message[key]);
    for (const urlKey of ["url", "directPath", "mediaUrl"]) {
      if (typeof media[urlKey] === "string") return media[urlKey] as string;
    }
  }
  return null;
}

function normalizeEvent(value: unknown): string {
  return String(value ?? "")
    .replace(/[.-]/g, "_")
    .toUpperCase();
}

function phoneFromJid(remoteJid: string): string | null {
  if (!remoteJid || remoteJid.endsWith("@g.us") || remoteJid.endsWith("@broadcast")) return null;
  const phone = remoteJid.split("@")[0]?.replace(/\D/g, "") ?? "";
  return phone.length >= 8 && phone.length <= 15 ? phone : null;
}

function bestRemoteJid(data: JsonObject, key: JsonObject): string {
  const primary = String(key["remoteJid"] ?? data["remoteJid"] ?? "");
  const alternate = String(key["remoteJidAlt"] ?? data["remoteJidAlt"] ?? "");

  // Newer Baileys/Evolution versions may identify a contact with @lid and expose
  // the real WhatsApp JID in remoteJidAlt. Prefer the phone JID when available.
  if (primary.endsWith("@lid") && alternate) return alternate;
  if (primary) return primary;
  return alternate;
}

function unixToIso(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return new Date().toISOString();
  const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  return new Date(milliseconds).toISOString();
}

function instanceNameFromPayload(payload: JsonObject): string {
  const rawInstance = payload["instance"];
  if (typeof rawInstance === "string") return rawInstance;
  const instanceObject = object(rawInstance);
  const instanceData = object(payload["instanceData"]);
  const data = object(payload["data"]);
  return String(
    instanceObject["instanceName"] ??
      instanceObject["name"] ??
      instanceData["instanceName"] ??
      data["instance"] ??
      data["instanceName"] ??
      "",
  );
}

function webhookAuthorized(request: Request, payload: JsonObject): boolean {
  const configuredSecret = process.env["WHATSAPP_WEBHOOK_SECRET"]?.trim();
  const evolutionApiKey = evolutionGatewayConfig()?.apiKey;

  // No webhook secret configured: preserve backward compatibility. The endpoint is
  // still tied to a configured Evolution instance before any database write occurs.
  if (!configuredSecret) return true;

  const url = new URL(request.url);
  const suppliedSecret =
    request.headers.get("x-webhook-secret") ??
    request.headers.get("x-api-key") ??
    url.searchParams.get("secret");
  if (suppliedSecret === configuredSecret) return true;

  // Evolution includes its API key in the webhook envelope in current deployments.
  // This fallback fixes instances whose existing webhook was created before custom
  // headers were configured, without opening the endpoint to unauthenticated writes.
  const payloadApiKey = typeof payload["apikey"] === "string" ? payload["apikey"].trim() : "";
  if (evolutionApiKey && payloadApiKey === evolutionApiKey) return true;

  const authorization = request.headers.get("authorization") ?? "";
  if (evolutionApiKey && authorization === `Bearer ${evolutionApiKey}`) return true;

  return false;
}

async function handleWebhook(request: Request) {
  const payload = object(await request.json().catch(() => ({})));
  if (!webhookAuthorized(request, payload)) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized_webhook" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const event = normalizeEvent(payload["event"] ?? payload["type"]);
  const receivedInstance = instanceNameFromPayload(payload);
  const configuredInstance = process.env["EVOLUTION_INSTANCE"]?.trim() ?? "";
  const instance = receivedInstance || configuredInstance;
  if (!instance) return Response.json({ ok: true, ignored: true, reason: "instance_missing" });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;

  let { data: connection } = await db
    .from("whatsapp_connections")
    .select("tenant_id,id,instance_name")
    .eq("instance_name", instance)
    .maybeSingle();

  // Some Evolution releases/webhook providers may send the instance ID instead of
  // its configured name. After webhook authentication succeeds, fall back to the
  // server's configured instance so the event is not silently discarded.
  if (!connection?.tenant_id && configuredInstance && configuredInstance !== instance) {
    const fallback = await db
      .from("whatsapp_connections")
      .select("tenant_id,id,instance_name")
      .eq("instance_name", configuredInstance)
      .maybeSingle();
    connection = fallback.data;
  }

  if (!connection?.tenant_id) {
    // Production can temporarily receive an Evolution-generated instance name while the
    // tenant still has one legacy instance saved. Only fall back when the project has
    // exactly one eligible WhatsApp connection, avoiding cross-tenant ambiguity.
    const connectedCandidates = await db
      .from("whatsapp_connections")
      .select("tenant_id,id,instance_name")
      .eq("status", "connected")
      .limit(2);
    if ((connectedCandidates.data ?? []).length === 1) {
      connection = connectedCandidates.data[0];
    }
  }

  if (!connection?.tenant_id) {
    const allCandidates = await db
      .from("whatsapp_connections")
      .select("tenant_id,id,instance_name")
      .limit(2);
    if ((allCandidates.data ?? []).length === 1) {
      connection = allCandidates.data[0];
    }
  }

  if (!connection?.tenant_id) {
    return Response.json({ ok: true, ignored: true, reason: "connection_not_found" });
  }

  if (event.includes("CONNECTION_UPDATE")) {
    const data = object(payload["data"]);
    const rawState = String(data["state"] ?? data["status"] ?? "").toLowerCase();
    const status = ["open", "connected", "online"].includes(rawState)
      ? "connected"
      : ["connecting", "qrcode", "qr", "pairing"].includes(rawState)
        ? "connecting"
        : ["close", "closed", "disconnected", "offline"].includes(rawState)
          ? "disconnected"
          : "error";
    await db
      .from("whatsapp_connections")
      .update({
        status,
        last_connected_at: status === "connected" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection.id);
    return Response.json({ ok: true });
  }

  if (!event.includes("MESSAGES_UPSERT") && !event.includes("MESSAGE_UPSERT")) {
    return Response.json({ ok: true, ignored: true, reason: "event_not_supported", event });
  }

  const rawData = payload["data"];
  const entries = Array.isArray(rawData) ? rawData : [rawData];
  const autoReplyCandidates = new Map<string, AutoReplyCandidate>();
  let processed = 0;
  let autoReplies = 0;

  for (const entry of entries) {
    const data = object(entry);
    const key = object(data["key"]);
    const remoteJid = bestRemoteJid(data, key);
    const phone = phoneFromJid(remoteJid);
    if (!phone) continue;

    const fromMe = Boolean(key["fromMe"] ?? data["fromMe"]);
    const externalMessageId = String(key["id"] ?? data["id"] ?? "") || null;
    const message = object(data["message"]);
    const body = textFromMessage(message);
    const type = messageType(message);
    const mediaUrl = mediaUrlFromMessage(message);
    const sentAt = unixToIso(data["messageTimestamp"] ?? data["timestamp"]);
    const contactName =
      typeof data["pushName"] === "string" && data["pushName"]
        ? (data["pushName"] as string)
        : null;

    let { data: conversation } = await db
      .from("whatsapp_conversations")
      .select("id,unread_count,phone_e164")
      .eq("tenant_id", connection.tenant_id)
      .eq("phone_e164", phone)
      .maybeSingle();

    if (!conversation) {
      const inserted = await db
        .from("whatsapp_conversations")
        .insert({
          tenant_id: connection.tenant_id,
          phone_e164: phone,
          contact_name: contactName,
          last_message: body ?? (mediaUrl ? "Mídia recebida" : "Nova mensagem"),
          last_message_at: sentAt,
          unread_count: fromMe ? 0 : 1,
        })
        .select("id,unread_count,phone_e164")
        .single();
      conversation = inserted.data;
    }
    if (!conversation) continue;

    const messageInsert = await db.from("whatsapp_messages").insert({
      tenant_id: connection.tenant_id,
      conversation_id: conversation.id,
      external_message_id: externalMessageId,
      direction: fromMe ? "outbound" : "inbound",
      message_type: type,
      body,
      media_url: mediaUrl,
      status: fromMe ? "sent" : "received",
      sender_name: contactName,
      sent_at: sentAt,
      raw_payload: data,
    });

    if (messageInsert.error?.code === "23505") continue;
    if (messageInsert.error) throw new Error(messageInsert.error.message);

    const nextUnread = fromMe
      ? Number(conversation.unread_count ?? 0)
      : Number(conversation.unread_count ?? 0) + 1;
    await db
      .from("whatsapp_conversations")
      .update({
        contact_name: contactName ?? undefined,
        last_message: body ?? (mediaUrl ? "Mídia" : type),
        last_message_at: sentAt,
        unread_count: nextUnread,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversation.id);
    processed += 1;

    // Satisfaction replies are consumed before AI. When the text is not a pending
    // rating, a new inbound message after closure reopens the conversation lifecycle.
    if (!fromMe && body) {
      let satisfactionCaptured = false;
      try {
        const { captureAttendanceSatisfactionResponse, reopenClosedAttendanceAfterInbound } =
          await import("@/lib/attendance-satisfaction.server");
        const satisfaction = await captureAttendanceSatisfactionResponse({
          tenantId: connection.tenant_id,
          conversationId: conversation.id,
          inboundText: body,
          inboundSentAt: sentAt,
          inboundExternalMessageId: externalMessageId,
        });
        satisfactionCaptured = satisfaction.captured;
        if (!satisfactionCaptured) {
          await reopenClosedAttendanceAfterInbound({
            tenantId: connection.tenant_id,
            conversationId: conversation.id,
            inboundSentAt: sentAt,
          });
        }
      } catch {
        // This layer is additive and must never block normal WhatsApp ingestion.
      }

      if (satisfactionCaptured) continue;

      // A burst received in the same webhook must generate at most one AI turn per conversation.
      // The latest inbound entry replaces earlier candidates from the same customer.
      autoReplyCandidates.set(conversation.id, {
        tenantId: connection.tenant_id,
        conversationId: conversation.id,
        phone,
        inboundText: body,
        inboundSentAt: sentAt,
        inboundExternalMessageId: externalMessageId,
      });
    }
  }

  if (autoReplyCandidates.size > 0) {
    try {
      const { maybeAutoReply } = await import("@/lib/whatsapp-auto-reply.server");
      const results = await Promise.all(
        [...autoReplyCandidates.values()].map((candidate) =>
          maybeAutoReply(candidate).catch(() => ({ sent: false, reason: "auto_reply_failed" })),
        ),
      );
      autoReplies = results.filter((reply) => reply.sent).length;
    } catch {
      // Falha da IA nunca impede o recebimento da mensagem do cliente.
    }
  }

  return Response.json({ ok: true, processed, autoReplies });
}

export const Route = createFileRoute("/api/public/hooks/whatsapp")({
  server: {
    handlers: {
      POST: ({ request }) => handleWebhook(request),
    },
  },
});
