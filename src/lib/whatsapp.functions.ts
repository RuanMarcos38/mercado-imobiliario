import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendEvolutionTextMessage } from "@/lib/evolution-text.server";
import { requireTenantId } from "@/lib/tenant.server";
import { syncEvolutionInboxForTenant } from "@/lib/whatsapp-inbox-sync.server";
import { normalizeWhatsAppPhone, whatsappPhoneErrorMessage } from "@/lib/whatsapp-phone";

const conversationSchema = z.object({ conversationId: z.string().uuid() });
const sendTextSchema = z.object({
  conversationId: z.string().uuid(),
  text: z.string().trim().min(1).max(4096),
});

export interface WhatsAppConnectionStatus {
  configured: boolean;
  connected: boolean;
  state: "connected" | "connecting" | "disconnected" | "error";
  displayName: string | null;
  phoneNumber: string | null;
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
  status: string;
  sender_name: string | null;
  sent_at: string;
}

function evolutionConfig() {
  const baseUrl = process.env["EVOLUTION_API_URL"]?.replace(/\/$/, "");
  const apiKey = process.env["EVOLUTION_API_KEY"];
  const instance = process.env["EVOLUTION_INSTANCE"];
  if (!baseUrl || !apiKey || !instance) return null;
  return { baseUrl, apiKey, instance };
}

async function evolutionRequest(path: string, init?: RequestInit) {
  const config = evolutionConfig();
  if (!config) throw new Error("WHATSAPP_NOT_CONFIGURED");

  return fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: config.apiKey,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
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

export const getWhatsAppConnectionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WhatsAppConnectionStatus> => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { data: savedConnection } = await db
      .from("whatsapp_connections")
      .select("display_name,phone_number,status")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const config = evolutionConfig();
    if (!config) {
      return {
        configured: false,
        connected: false,
        state: "disconnected",
        displayName: savedConnection?.display_name ?? null,
        phoneNumber: savedConnection?.phone_number ?? null,
      };
    }

    try {
      const response = await evolutionRequest(
        `/instance/connectionState/${encodeURIComponent(config.instance)}`,
        { method: "GET" },
      );
      const payload = await response.json().catch(() => ({}));
      const state = response.ok ? normalizeConnectionState(payload) : "error";
      return {
        configured: true,
        connected: state === "connected",
        state,
        displayName: savedConnection?.display_name ?? config.instance,
        phoneNumber: savedConnection?.phone_number ?? null,
      };
    } catch {
      return {
        configured: true,
        connected: false,
        state: "error",
        displayName: savedConnection?.display_name ?? config.instance,
        phoneNumber: savedConnection?.phone_number ?? null,
      };
    }
  });

export const getWhatsAppQrCode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const config = evolutionConfig();
    if (!config)
      return { configured: false, code: null as string | null, base64: null as string | null };

    const response = await evolutionRequest(
      `/instance/connect/${encodeURIComponent(config.instance)}`,
      {
        method: "GET",
      },
    );
    if (!response.ok) throw new Error("Não foi possível iniciar a conexão do WhatsApp.");
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const base64 =
      typeof payload["base64"] === "string"
        ? payload["base64"]
        : typeof payload["qrcode"] === "object" && payload["qrcode"]
          ? String((payload["qrcode"] as Record<string, unknown>)["base64"] ?? "") || null
          : null;
    const code =
      typeof payload["code"] === "string"
        ? payload["code"]
        : typeof payload["qrcode"] === "object" && payload["qrcode"]
          ? String((payload["qrcode"] as Record<string, unknown>)["code"] ?? "") || null
          : null;
    return { configured: true, code, base64 };
  });

export const listWhatsAppConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WhatsAppConversation[]> => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;

    // Evolution API v2.3.7 can persist incoming @lid messages even when a webhook/UI
    // consumer misses them. Reconcile the latest Evolution records before rendering.
    try {
      await syncEvolutionInboxForTenant(db, tenantId);
    } catch {
      // Webhook/realtime remains the primary path. A recovery-sync failure must not
      // prevent the Atendimento screen from loading already stored conversations.
    }

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
    const db = context.supabase as any;

    const { data: conversation, error: conversationError } = await db
      .from("whatsapp_conversations")
      .select("id")
      .eq("id", data.conversationId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (conversationError) throw new Error(conversationError.message);
    if (!conversation) throw new Error("Conversa não encontrada.");

    // The selected conversation polls this function, so this also acts as a bounded
    // fallback for inbound delivery when Evolution's webhook path is interrupted.
    try {
      await syncEvolutionInboxForTenant(db, tenantId);
    } catch {
      // Keep showing local history if Evolution is temporarily unavailable.
    }

    const { data: messages, error } = await db
      .from("whatsapp_messages")
      .select("id,direction,message_type,body,media_url,status,sender_name,sent_at")
      .eq("tenant_id", tenantId)
      .eq("conversation_id", data.conversationId)
      .order("sent_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return (messages ?? []) as WhatsAppMessage[];
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
    if (!evolutionConfig()) throw new Error("WHATSAPP_NOT_CONFIGURED");

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

    // Repair old conversations that were stored without Brazil's DDI.
    if (phone !== conversation.phone_e164) {
      const { error: phoneUpdateError } = await db
        .from("whatsapp_conversations")
        .update({ phone_e164: phone, updated_at: new Date().toISOString() })
        .eq("id", conversation.id)
        .eq("tenant_id", tenantId);
      if (phoneUpdateError) throw new Error(phoneUpdateError.message);
    }

    const payload = await sendEvolutionTextMessage({ phone, text: data.text, delay: 800 });
    const key = payload["key"] as Record<string, unknown> | undefined;
    const externalMessageId =
      (typeof key?.["id"] === "string" && key["id"]) ||
      (typeof payload["id"] === "string" && payload["id"]) ||
      null;
    const now = new Date().toISOString();

    const { error: insertError } = await db.from("whatsapp_messages").insert({
      tenant_id: tenantId,
      conversation_id: conversation.id,
      external_message_id: externalMessageId,
      direction: "outbound",
      message_type: "text",
      body: data.text,
      status: "sent",
      sent_at: now,
      raw_payload: payload,
    });
    if (insertError && insertError.code !== "23505") throw new Error(insertError.message);

    await db
      .from("whatsapp_conversations")
      .update({ last_message: data.text, last_message_at: now, updated_at: now })
      .eq("id", conversation.id)
      .eq("tenant_id", tenantId);

    return { success: true, externalMessageId };
  });
