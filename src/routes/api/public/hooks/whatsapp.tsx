import { createFileRoute } from "@tanstack/react-router";

type JsonObject = Record<string, unknown>;

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
  if (typeof button["selectedDisplayText"] === "string") return button["selectedDisplayText"] as string;
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
  if (!remoteJid || remoteJid.endsWith("@g.us")) return null;
  const phone = remoteJid.split("@")[0]?.replace(/\D/g, "") ?? "";
  return phone.length >= 8 ? phone : null;
}

function unixToIso(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return new Date().toISOString();
  const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  return new Date(milliseconds).toISOString();
}

async function handleWebhook(request: Request) {
  const configuredSecret = process.env["WHATSAPP_WEBHOOK_SECRET"];
  if (configuredSecret) {
    const url = new URL(request.url);
    const supplied =
      request.headers.get("x-webhook-secret") ??
      request.headers.get("x-api-key") ??
      url.searchParams.get("secret");
    if (supplied !== configuredSecret) {
      return new Response(JSON.stringify({ ok: false }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const payload = object(await request.json().catch(() => ({})));
  const event = normalizeEvent(payload["event"] ?? payload["type"]);
  const instance = String(payload["instance"] ?? object(payload["instanceData"])["instanceName"] ?? "");
  if (!instance) {
    return Response.json({ ok: true, ignored: true });
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: connection } = await db
    .from("whatsapp_connections")
    .select("tenant_id,id")
    .eq("instance_name", instance)
    .maybeSingle();

  if (!connection?.tenant_id) {
    return Response.json({ ok: true, ignored: true });
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
    return Response.json({ ok: true, ignored: true });
  }

  const rawData = payload["data"];
  const entries = Array.isArray(rawData) ? rawData : [rawData];
  let processed = 0;

  for (const entry of entries) {
    const data = object(entry);
    const key = object(data["key"]);
    const remoteJid = String(key["remoteJid"] ?? data["remoteJid"] ?? "");
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
      .select("id,unread_count")
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
        .select("id,unread_count")
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

    const nextUnread = fromMe ? Number(conversation.unread_count ?? 0) : Number(conversation.unread_count ?? 0) + 1;
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
  }

  return Response.json({ ok: true, processed });
}

export const Route = createFileRoute("/api/public/hooks/whatsapp")({
  server: {
    handlers: {
      POST: ({ request }) => handleWebhook(request),
    },
  },
});
