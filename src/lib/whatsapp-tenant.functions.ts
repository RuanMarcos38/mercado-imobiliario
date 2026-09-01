import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  evolutionGatewayConfig,
  evolutionRequest,
  getTenantEvolutionInstance,
} from "@/lib/evolution-instance.server";
import { metaWhatsAppConfig } from "@/lib/meta-whatsapp.server";
import { requireTenantId } from "@/lib/tenant.server";
import { normalizeWhatsAppPhone, whatsappPhoneErrorMessage } from "@/lib/whatsapp-phone";
import { whatsappParameters } from "@/lib/platform-parameters.server";
import {
  getTenantWhatsAppConnection,
  sendTenantWhatsAppText,
  shouldUseMetaWhatsApp,
  testTenantWhatsAppRuntime,
  type WhatsAppProvider,
} from "@/lib/whatsapp-provider.server";

const conversationSchema = z.object({ conversationId: z.string().uuid() });
const sendTextSchema = z.object({
  conversationId: z.string().uuid(),
  text: z.string().trim().min(1).max(4096),
});

export interface WhatsAppConnectionStatus {
  configured: boolean;
  hasConnection: boolean;
  connected: boolean;
  state: "connected" | "connecting" | "disconnected" | "error";
  provider: WhatsAppProvider | null;
  displayName: string | null;
  phoneNumber: string | null;
  instanceName: string | null;
  phoneNumberId: string | null;
  maxAttachmentMb: number;
}

export interface WhatsAppConversation {
  id: string;
  phone_e164: string;
  contact_name: string | null;
  avatar_url: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
}

export interface WhatsAppMessage {
  id: string;
  direction: "inbound" | "outbound";
  message_type: string;
  body: string | null;
  media_url: string | null;
  media_file_name: string | null;
  media_mime_type: string | null;
  status: string;
  sender_name: string | null;
  sent_at: string;
}

function normalizeConnectionState(payload: unknown): WhatsAppConnectionStatus["state"] {
  if (!payload || typeof payload !== "object") return "error";
  const object = payload as Record<string, unknown>;
  const instance =
    object["instance"] && typeof object["instance"] === "object"
      ? (object["instance"] as Record<string, unknown>)
      : object;
  const raw = String(instance["state"] ?? instance["status"] ?? "").toLowerCase();
  if (["open", "connected", "online"].includes(raw)) return "connected";
  if (["connecting", "qrcode", "qr", "pairing"].includes(raw)) return "connecting";
  if (["close", "closed", "disconnected", "offline"].includes(raw)) return "disconnected";
  return "error";
}

function qrValues(payload: unknown) {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const nested =
    root["qrcode"] && typeof root["qrcode"] === "object"
      ? (root["qrcode"] as Record<string, unknown>)
      : root;
  return {
    base64: typeof nested["base64"] === "string" && nested["base64"] ? nested["base64"] : null,
    code: typeof nested["code"] === "string" && nested["code"] ? nested["code"] : null,
    pairingCode:
      typeof nested["pairingCode"] === "string" && nested["pairingCode"]
        ? nested["pairingCode"]
        : null,
    count: Number.isFinite(Number(nested["count"])) ? Number(nested["count"]) : 0,
  };
}

export const getWhatsAppConnectionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WhatsAppConnectionStatus> => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const maxAttachmentMb = whatsappParameters().maxAttachmentMb;
    const savedConnection = await getTenantWhatsAppConnection(db, tenantId);

    if (shouldUseMetaWhatsApp(savedConnection)) {
      const runtime = await testTenantWhatsAppRuntime(db, tenantId);
      const now = new Date().toISOString();
      if (savedConnection?.id) {
        await db
          .from("whatsapp_connections")
          .update({
            status: runtime.ok ? "connected" : runtime.configured ? "error" : "disconnected",
            last_connected_at: runtime.ok ? now : savedConnection.last_connected_at,
            phone_number: runtime.phoneNumber ?? savedConnection.phone_number,
            updated_at: now,
          })
          .eq("id", savedConnection.id);
      }
      return {
        configured: runtime.configured,
        hasConnection: Boolean(savedConnection?.instance_name || runtime.phoneNumberId),
        connected: runtime.ok,
        state: runtime.state,
        provider: "meta",
        displayName: runtime.displayName,
        phoneNumber: runtime.phoneNumber,
        instanceName: runtime.instanceName,
        phoneNumberId: runtime.phoneNumberId || null,
        maxAttachmentMb,
      };
    }

    const gateway = evolutionGatewayConfig();
    const instanceName = savedConnection?.instance_name
      ? String(savedConnection.instance_name)
      : null;
    if (!gateway || !instanceName) {
      return {
        configured: Boolean(gateway),
        hasConnection: Boolean(instanceName),
        connected: false,
        state: "disconnected",
        provider: "evolution",
        displayName: savedConnection?.display_name ?? null,
        phoneNumber: savedConnection?.phone_number ?? null,
        instanceName,
        phoneNumberId: null,
        maxAttachmentMb,
      };
    }

    try {
      const response = await evolutionRequest(
        gateway,
        `/instance/connectionState/${encodeURIComponent(instanceName)}`,
        { method: "GET" },
      );
      const payload = await response.json().catch(() => ({}));
      const state = response.ok ? normalizeConnectionState(payload) : "error";
      const now = new Date().toISOString();
      await db
        .from("whatsapp_connections")
        .update({
          status: state,
          last_connected_at: state === "connected" ? now : savedConnection?.last_connected_at,
          updated_at: now,
        })
        .eq("tenant_id", tenantId);
      return {
        configured: true,
        hasConnection: true,
        connected: state === "connected",
        state,
        provider: "evolution",
        displayName: savedConnection?.display_name ?? "Meu WhatsApp",
        phoneNumber: savedConnection?.phone_number ?? null,
        instanceName,
        phoneNumberId: null,
        maxAttachmentMb,
      };
    } catch {
      return {
        configured: true,
        hasConnection: true,
        connected: false,
        state: "error",
        provider: "evolution",
        displayName: savedConnection?.display_name ?? "Meu WhatsApp",
        phoneNumber: savedConnection?.phone_number ?? null,
        instanceName,
        phoneNumberId: null,
        maxAttachmentMb,
      };
    }
  });

export const getWhatsAppQrCode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const savedConnection = await getTenantWhatsAppConnection(db, tenantId);
    if (shouldUseMetaWhatsApp(savedConnection)) {
      return {
        configured: Boolean(
          metaWhatsAppConfig(savedConnection?.provider_phone_number_id ?? undefined),
        ),
        base64: null as string | null,
        code: null as string | null,
        pairingCode: null as string | null,
        count: 0,
      };
    }
    const gateway = evolutionGatewayConfig();
    if (!gateway) {
      return {
        configured: false,
        base64: null as string | null,
        code: null as string | null,
        pairingCode: null as string | null,
        count: 0,
      };
    }
    const instance = await getTenantEvolutionInstance(db, tenantId);
    if (!instance) {
      return {
        configured: true,
        base64: null as string | null,
        code: null as string | null,
        pairingCode: null as string | null,
        count: 0,
      };
    }

    const response = await evolutionRequest(
      gateway,
      `/instance/connect/${encodeURIComponent(instance)}`,
      { method: "GET" },
    );
    if (!response.ok) throw new Error("Não foi possível gerar o QR Code do WhatsApp.");
    return { configured: true, ...qrValues(await response.json().catch(() => ({}))) };
  });

export const listWhatsAppConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WhatsAppConversation[]> => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { data, error } = await db
      .from("whatsapp_conversations")
      .select("id,phone_e164,contact_name,avatar_url,last_message,last_message_at,unread_count")
      .eq("tenant_id", tenantId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as WhatsAppConversation[];
  });

export const listWhatsAppMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => conversationSchema.parse(data))
  .handler(async ({ data, context }): Promise<WhatsAppMessage[]> => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = supabaseAdmin as any;
    const { data: conversation, error: conversationError } = await db
      .from("whatsapp_conversations")
      .select("id")
      .eq("id", data.conversationId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (conversationError) throw new Error(conversationError.message);
    if (!conversation) throw new Error("Conversa não encontrada.");

    const { data: messages, error } = await db
      .from("whatsapp_messages")
      .select("id,direction,message_type,body,media_url,status,sender_name,sent_at,raw_payload")
      .eq("tenant_id", tenantId)
      .eq("conversation_id", data.conversationId)
      .order("sent_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);

    const storagePrefix = "storage://whatsapp-media/";
    return Promise.all(
      (messages ?? []).map(async (row: Record<string, any>): Promise<WhatsAppMessage> => {
        const rawPayload =
          row.raw_payload && typeof row.raw_payload === "object"
            ? (row.raw_payload as Record<string, unknown>)
            : {};
        let mediaUrl = typeof row.media_url === "string" ? row.media_url : null;
        if (mediaUrl?.startsWith(storagePrefix)) {
          const storagePath = mediaUrl.slice(storagePrefix.length);
          const { data: signed } = await supabaseAdmin.storage
            .from("whatsapp-media")
            .createSignedUrl(storagePath, 60 * 60);
          mediaUrl = signed?.signedUrl ?? null;
        }
        return {
          id: String(row.id),
          direction: row.direction === "outbound" ? "outbound" : "inbound",
          message_type: String(row.message_type ?? "text"),
          body: typeof row.body === "string" ? row.body : null,
          media_url: mediaUrl,
          media_file_name:
            typeof rawPayload["mercadoimobi_file_name"] === "string"
              ? String(rawPayload["mercadoimobi_file_name"])
              : null,
          media_mime_type:
            typeof rawPayload["mercadoimobi_mime_type"] === "string"
              ? String(rawPayload["mercadoimobi_mime_type"])
              : null,
          status: String(row.status ?? "received"),
          sender_name: typeof row.sender_name === "string" ? row.sender_name : null,
          sent_at: String(row.sent_at),
        };
      }),
    );
  });

export const markWhatsAppConversationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => conversationSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { error } = await db
      .from("whatsapp_conversations")
      .update({ unread_count: 0, updated_at: new Date().toISOString() })
      .eq("id", data.conversationId)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const sendWhatsAppText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => sendTextSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;

    const { data: conversation, error: conversationError } = await db
      .from("whatsapp_conversations")
      .select("id,phone_e164")
      .eq("id", data.conversationId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (conversationError) throw new Error(conversationError.message);
    if (!conversation) throw new Error("Conversa não encontrada.");

    const phone = normalizeWhatsAppPhone(String(conversation.phone_e164 ?? ""));
    if (!phone) throw new Error(whatsappPhoneErrorMessage(String(conversation.phone_e164 ?? "")));
    if (phone !== conversation.phone_e164) {
      const { error: phoneUpdateError } = await db
        .from("whatsapp_conversations")
        .update({ phone_e164: phone, updated_at: new Date().toISOString() })
        .eq("id", conversation.id)
        .eq("tenant_id", tenantId);
      if (phoneUpdateError) throw new Error(phoneUpdateError.message);
    }

    const sent = await sendTenantWhatsAppText({
      db,
      tenantId,
      userId: context.userId,
      phone,
      text: data.text,
      delay: whatsappParameters().sendDelayMs,
    });
    const now = new Date().toISOString();

    const { error: insertError } = await db.from("whatsapp_messages").insert({
      tenant_id: tenantId,
      conversation_id: conversation.id,
      direction: "outbound",
      message_type: "text",
      body: data.text,
      status: "sent",
      sent_at: now,
      external_message_id: sent.externalMessageId,
      raw_payload: { ...sent.payload, mercadoimobi_provider: sent.provider },
    });
    if (insertError && insertError.code !== "23505") throw new Error(insertError.message);

    const { error: conversationUpdateError } = await db
      .from("whatsapp_conversations")
      .update({ last_message: data.text, last_message_at: now, updated_at: now })
      .eq("id", conversation.id)
      .eq("tenant_id", tenantId);
    if (conversationUpdateError) throw new Error(conversationUpdateError.message);
    return { success: true, externalMessageId: sent.externalMessageId, provider: sent.provider };
  });
