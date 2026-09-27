import {
  connectionProvider,
  getTenantWhatsAppConnection,
  type TenantWhatsAppConnection,
} from "@/lib/whatsapp-provider.server";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function phoneDigits(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

export function expectedMetaPhoneE164(connection: TenantWhatsAppConnection | null) {
  const metadata = object(connection?.provider_metadata);
  const raw =
    typeof metadata["expectedPhoneE164"] === "string" ? metadata["expectedPhoneE164"] : "";
  return phoneDigits(raw);
}

export function metaConnectionMatchesExpectedPhone(connection: TenantWhatsAppConnection | null) {
  if (!connection || connectionProvider(connection) !== "meta") return true;
  const expected = expectedMetaPhoneE164(connection);
  if (!expected) return true;
  return phoneDigits(connection.phone_number) === expected;
}

export function blockedMetaReferralSourceIds(connection: TenantWhatsAppConnection | null) {
  const metadata = object(connection?.provider_metadata);
  const raw = metadata["blockedReferralSourceIds"];
  if (!Array.isArray(raw)) return new Set<string>();
  return new Set(
    raw
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function metaMessagePhoneNumberId(rawPayload: unknown) {
  const payload = object(rawPayload);
  return typeof payload["phone_number_id"] === "string"
    ? String(payload["phone_number_id"]).trim()
    : "";
}

export function metaMessageReferralSourceId(rawPayload: unknown) {
  const payload = object(rawPayload);
  const referral = object(payload["referral"]);
  return typeof referral["source_id"] === "string" ? String(referral["source_id"]).trim() : "";
}

export function isBlockedMetaReferralMessage(
  connection: TenantWhatsAppConnection | null,
  rawPayload: unknown,
) {
  const sourceId = metaMessageReferralSourceId(rawPayload);
  return Boolean(sourceId && blockedMetaReferralSourceIds(connection).has(sourceId));
}

export async function scopedMetaConversationIds(db: any, tenantId: string) {
  const connection = await getTenantWhatsAppConnection(db, tenantId);
  if (!connection || connectionProvider(connection) !== "meta") return null;

  if (!metaConnectionMatchesExpectedPhone(connection)) return new Set<string>();

  const phoneNumberId = connection.provider_phone_number_id?.trim() || "";
  if (!phoneNumberId) return new Set<string>();

  const [messagesResult, emptyConversationsResult] = await Promise.all([
    db
      .from("whatsapp_messages")
      .select("conversation_id,raw_payload")
      .eq("tenant_id", tenantId)
      .limit(10000),
    db
      .from("whatsapp_conversations")
      .select("id")
      .eq("tenant_id", tenantId)
      .is("last_message_at", null)
      .limit(500),
  ]);
  if (messagesResult.error) throw new Error(messagesResult.error.message);
  if (emptyConversationsResult.error) throw new Error(emptyConversationsResult.error.message);

  const currentPhoneConversations = new Set<string>(
    (emptyConversationsResult.data ?? []).map((row: Record<string, unknown>) => String(row.id)),
  );
  const blockedConversations = new Set<string>();

  for (const row of messagesResult.data ?? []) {
    const conversationId = String(row.conversation_id ?? "").trim();
    if (!conversationId) continue;
    if (metaMessagePhoneNumberId(row.raw_payload) !== phoneNumberId) continue;

    currentPhoneConversations.add(conversationId);
    if (isBlockedMetaReferralMessage(connection, row.raw_payload)) {
      blockedConversations.add(conversationId);
    }
  }

  return new Set(
    [...currentPhoneConversations].filter(
      (conversationId) => !blockedConversations.has(conversationId),
    ),
  );
}

export async function conversationBelongsToCurrentWhatsApp(
  db: any,
  tenantId: string,
  conversationId: string,
) {
  const connection = await getTenantWhatsAppConnection(db, tenantId);
  if (!connection || connectionProvider(connection) !== "meta") return true;

  if (!metaConnectionMatchesExpectedPhone(connection)) return false;

  const phoneNumberId = connection.provider_phone_number_id?.trim() || "";
  if (!phoneNumberId) return false;

  const { data, error } = await db
    .from("whatsapp_messages")
    .select("raw_payload")
    .eq("tenant_id", tenantId)
    .eq("conversation_id", conversationId)
    .limit(1000);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  if (rows.length === 0) return true;

  let belongsToCurrentPhone = false;
  for (const row of rows) {
    if (metaMessagePhoneNumberId(row.raw_payload) !== phoneNumberId) continue;
    belongsToCurrentPhone = true;
    if (isBlockedMetaReferralMessage(connection, row.raw_payload)) return false;
  }

  return belongsToCurrentPhone;
}

export async function assertConversationBelongsToCurrentWhatsApp(
  db: any,
  tenantId: string,
  conversationId: string,
) {
  if (!(await conversationBelongsToCurrentWhatsApp(db, tenantId, conversationId))) {
    throw new Error("Conversa não disponível para este WhatsApp.");
  }
}
