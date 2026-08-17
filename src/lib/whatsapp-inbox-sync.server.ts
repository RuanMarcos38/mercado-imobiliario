import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";

type JsonObject = Record<string, unknown>;
type DbClient = any;

type EvolutionConfig = {
  baseUrl: string;
  apiKey: string;
  instance: string;
};

type NormalizedEvolutionMessage = {
  externalId: string;
  fromMe: boolean;
  phone: string;
  contactName: string | null;
  body: string | null;
  messageType: string;
  mediaUrl: string | null;
  sentAt: string;
  raw: JsonObject;
};

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function evolutionConfig(): EvolutionConfig | null {
  const baseUrl = process.env["EVOLUTION_API_URL"]?.trim().replace(/\/$/, "");
  const apiKey = process.env["EVOLUTION_API_KEY"]?.trim();
  const instance = process.env["EVOLUTION_INSTANCE"]?.trim();
  if (!baseUrl || !apiKey || !instance) return null;
  return { baseUrl, apiKey, instance };
}

function booleanValue(value: unknown): boolean {
  if (value === true || value === 1 || value === "1") return true;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
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

function messageType(message: JsonObject, rawType: unknown): string {
  const type = String(rawType ?? "").toLowerCase();
  if (type.includes("image") || message["imageMessage"]) return "image";
  if (type.includes("video") || message["videoMessage"]) return "video";
  if (type.includes("audio") || message["audioMessage"]) return "audio";
  if (type.includes("document") || message["documentMessage"]) return "document";
  if (type.includes("sticker") || message["stickerMessage"]) return "sticker";
  return "text";
}

function mediaUrlFromMessage(message: JsonObject): string | null {
  for (const key of ["imageMessage", "videoMessage", "audioMessage", "documentMessage"]) {
    const media = object(message[key]);
    for (const urlKey of ["url", "directPath", "mediaUrl"]) {
      if (typeof media[urlKey] === "string" && media[urlKey]) return media[urlKey] as string;
    }
  }
  return null;
}

function toIso(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return new Date().toISOString();
  const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  return new Date(milliseconds).toISOString();
}

function jidCandidates(record: JsonObject, key: JsonObject): string[] {
  const contextInfo = object(record["contextInfo"]);
  return [
    key["remoteJidAlt"],
    record["remoteJidAlt"],
    key["participantAlt"],
    record["participantAlt"],
    contextInfo["participantAlt"],
    key["remoteJid"],
    record["remoteJid"],
    key["participant"],
    record["participant"],
    contextInfo["participant"],
  ]
    .filter((value): value is string => typeof value === "string" && Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index);
}

function phoneFromRecord(record: JsonObject, key: JsonObject): string | null {
  const candidates = jidCandidates(record, key).filter(
    (jid) => !jid.endsWith("@g.us") && !jid.includes("broadcast") && !jid.endsWith("@lid"),
  );

  // Never treat a WhatsApp LID as a phone number. On v2.3.7 inbound records can use
  // remoteJid=@lid while remoteJidAlt/participantAlt carries the real phone JID.
  for (const jid of candidates) {
    const digits = jid.split("@")[0]?.replace(/\D/g, "") ?? "";
    const normalized = normalizeWhatsAppPhone(digits);
    if (normalized) return normalized;
  }
  return null;
}

function brazilianPhoneVariants(phone: string): string[] {
  const variants = new Set<string>([phone]);
  if (!phone.startsWith("55")) return [...variants];

  // Brazil may appear in WhatsApp/Evolution with or without the mobile ninth digit.
  if (phone.length === 12) variants.add(`${phone.slice(0, 4)}9${phone.slice(4)}`);
  if (phone.length === 13 && phone[4] === "9") variants.add(`${phone.slice(0, 4)}${phone.slice(5)}`);
  return [...variants];
}

function recordsFromPayload(payload: unknown): JsonObject[] {
  if (Array.isArray(payload)) return payload.filter((item) => item && typeof item === "object") as JsonObject[];
  const root = object(payload);
  const messages = object(root["messages"]);
  if (Array.isArray(messages["records"])) return messages["records"] as JsonObject[];
  if (Array.isArray(root["records"])) return root["records"] as JsonObject[];
  if (Array.isArray(root["data"])) return root["data"] as JsonObject[];
  return [];
}

export function normalizeEvolutionMessage(record: JsonObject): NormalizedEvolutionMessage | null {
  const key = object(record["key"]);
  const externalId = String(key["id"] ?? record["id"] ?? "").trim();
  if (!externalId) return null;

  const phone = phoneFromRecord(record, key);
  if (!phone) return null;

  const message = object(record["message"]);
  const body = textFromMessage(message);
  return {
    externalId,
    fromMe: booleanValue(key["fromMe"] ?? record["fromMe"]),
    phone,
    contactName:
      typeof record["pushName"] === "string" && record["pushName"]
        ? (record["pushName"] as string)
        : null,
    body,
    messageType: messageType(message, record["messageType"]),
    mediaUrl: mediaUrlFromMessage(message),
    sentAt: toIso(record["messageTimestamp"] ?? record["timestamp"] ?? record["createdAt"]),
    raw: record,
  };
}

async function fetchLatestEvolutionMessages(config: EvolutionConfig): Promise<JsonObject[]> {
  const response = await fetch(
    `${config.baseUrl}/chat/findMessages/${encodeURIComponent(config.instance)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: config.apiKey,
      },
      // This is the contract confirmed on Evolution API v2.3.7. Its repository
      // returns the newest page first and defaults to a bounded page of records.
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) throw new Error(`EVOLUTION_FIND_MESSAGES_HTTP_${response.status}`);
  return recordsFromPayload(await response.json().catch(() => ({})));
}

export async function syncEvolutionInboxForTenant(db: DbClient, tenantId: string) {
  const config = evolutionConfig();
  if (!config) return { configured: false, fetched: 0, inserted: 0, inbound: 0, skipped: 0 };

  const records = await fetchLatestEvolutionMessages(config);
  const normalized = records
    .map((record) => normalizeEvolutionMessage(record))
    .filter((message): message is NormalizedEvolutionMessage => Boolean(message))
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));

  let inserted = 0;
  let inbound = 0;
  let skipped = 0;

  for (const item of normalized) {
    const { data: existingMessage } = await db
      .from("whatsapp_messages")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("external_message_id", item.externalId)
      .maybeSingle();
    if (existingMessage) {
      skipped += 1;
      continue;
    }

    const phoneVariants = brazilianPhoneVariants(item.phone);
    let { data: conversation } = await db
      .from("whatsapp_conversations")
      .select("id,phone_e164,unread_count,contact_name,last_message_at")
      .eq("tenant_id", tenantId)
      .in("phone_e164", phoneVariants)
      .limit(1)
      .maybeSingle();

    if (!conversation) {
      const created = await db
        .from("whatsapp_conversations")
        .insert({
          tenant_id: tenantId,
          phone_e164: item.phone,
          contact_name: item.contactName,
          last_message: item.body ?? (item.mediaUrl ? "Mídia recebida" : item.messageType),
          last_message_at: item.sentAt,
          unread_count: item.fromMe ? 0 : 1,
        })
        .select("id,phone_e164,unread_count,contact_name,last_message_at")
        .single();
      if (created.error) {
        // A webhook or another sync may have created the conversation concurrently.
        const retry = await db
          .from("whatsapp_conversations")
          .select("id,phone_e164,unread_count,contact_name,last_message_at")
          .eq("tenant_id", tenantId)
          .in("phone_e164", phoneVariants)
          .limit(1)
          .maybeSingle();
        conversation = retry.data;
      } else {
        conversation = created.data;
      }
    }
    if (!conversation) {
      skipped += 1;
      continue;
    }

    const messageInsert = await db.from("whatsapp_messages").insert({
      tenant_id: tenantId,
      conversation_id: conversation.id,
      external_message_id: item.externalId,
      direction: item.fromMe ? "outbound" : "inbound",
      message_type: item.messageType,
      body: item.body,
      media_url: item.mediaUrl,
      status: item.fromMe ? "sent" : "received",
      sender_name: item.contactName,
      sent_at: item.sentAt,
      raw_payload: item.raw,
    });

    if (messageInsert.error?.code === "23505") {
      skipped += 1;
      continue;
    }
    if (messageInsert.error) throw new Error(messageInsert.error.message);

    const currentUnread = Number(conversation.unread_count ?? 0);
    const nextUnread = item.fromMe ? currentUnread : currentUnread + 1;
    const previousLastAt = conversation.last_message_at ? String(conversation.last_message_at) : "";
    const isNewest = !previousLastAt || item.sentAt >= previousLastAt;

    const update: Record<string, unknown> = {
      unread_count: nextUnread,
      updated_at: new Date().toISOString(),
    };
    if (item.contactName && !conversation.contact_name) update.contact_name = item.contactName;
    if (isNewest) {
      update.last_message = item.body ?? (item.mediaUrl ? "Mídia" : item.messageType);
      update.last_message_at = item.sentAt;
    }

    await db.from("whatsapp_conversations").update(update).eq("id", conversation.id).eq("tenant_id", tenantId);
    inserted += 1;
    if (!item.fromMe) inbound += 1;

    if (!item.fromMe && item.body) {
      try {
        const { maybeAutoReply } = await import("@/lib/whatsapp-auto-reply.server");
        await maybeAutoReply({
          tenantId,
          conversationId: conversation.id,
          phone: String(conversation.phone_e164 ?? item.phone),
          inboundText: item.body,
        });
      } catch {
        // Recovery sync must never fail because the optional AI auto-reply failed.
      }
    }
  }

  return { configured: true, fetched: records.length, inserted, inbound, skipped };
}
