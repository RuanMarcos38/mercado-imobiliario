import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { type EvolutionMediaType } from "@/lib/evolution-media.server";
import { requireTenantId } from "@/lib/tenant.server";
import { normalizeWhatsAppPhone, whatsappPhoneErrorMessage } from "@/lib/whatsapp-phone";
import { whatsappParameters } from "@/lib/platform-parameters.server";
import { sendTenantWhatsAppMedia } from "@/lib/whatsapp-provider.server";

const WHATSAPP_MEDIA_BUCKET = "whatsapp-media";

const mediaSchema = z.object({
  conversationId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().min(1).max(120),
  base64: z.string().min(1),
  caption: z.string().trim().max(1024).optional(),
});

function mediaTypeFromMime(mimeType: string): EvolutionMediaType {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

function normalizedBase64(value: string) {
  return value
    .replace(/^data:[^;]+;base64,/, "")
    .replace(/\s+/g, "")
    .trim();
}

function base64Bytes(value: string) {
  const clean = normalizedBase64(value);
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function safeFileName(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-120);
  return normalized || "arquivo";
}

export const sendWhatsAppAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => mediaSchema.parse(data))
  .handler(async ({ data, context }) => {
    const parameters = whatsappParameters();
    const bytes = base64Bytes(data.base64);
    const maxBytes = parameters.maxAttachmentMb * 1024 * 1024;
    if (!bytes.byteLength || bytes.byteLength > maxBytes) {
      throw new Error(`O arquivo deve ter no máximo ${parameters.maxAttachmentMb} MB.`);
    }

    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;

    const { data: conversation, error } = await db
      .from("whatsapp_conversations")
      .select("id,phone_e164")
      .eq("id", data.conversationId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!conversation) throw new Error("Conversa não encontrada.");

    const phone = normalizeWhatsAppPhone(String(conversation.phone_e164 ?? ""));
    if (!phone) throw new Error(whatsappPhoneErrorMessage(String(conversation.phone_e164 ?? "")));

    const isAudio = data.mimeType.toLowerCase().startsWith("audio/");
    const mediaType = isAudio ? "audio" : mediaTypeFromMime(data.mimeType);
    const storagePath = `${tenantId}/${conversation.id}/${Date.now()}-${crypto.randomUUID()}-${safeFileName(data.fileName)}`;
    const storage = supabaseAdmin.storage.from(WHATSAPP_MEDIA_BUCKET);
    const { error: storageError } = await storage.upload(storagePath, bytes, {
      contentType: data.mimeType,
      upsert: false,
    });
    if (storageError) throw new Error(`MEDIA_STORAGE_FAILED:${storageError.message}`);

    let sent: Awaited<ReturnType<typeof sendTenantWhatsAppMedia>>;
    try {
      sent = await sendTenantWhatsAppMedia({
        db,
        tenantId,
        userId: context.userId,
        phone,
        mediaType,
        mimeType: data.mimeType,
        fileName: data.fileName,
        base64: data.base64,
        caption: data.caption,
      });
    } catch (providerError) {
      await storage.remove([storagePath]).catch(() => undefined);
      throw providerError;
    }

    const now = new Date().toISOString();
    const label = isAudio ? "🎤 Mensagem de voz" : data.caption?.trim() || `📎 ${data.fileName}`;
    const mediaUrl = `storage://${WHATSAPP_MEDIA_BUCKET}/${storagePath}`;

    const { error: insertError } = await db.from("whatsapp_messages").insert({
      tenant_id: tenantId,
      conversation_id: conversation.id,
      external_message_id: sent.externalMessageId,
      direction: "outbound",
      message_type: mediaType,
      body: label,
      media_url: mediaUrl,
      status: "sent",
      sent_at: now,
      raw_payload: {
        ...sent.payload,
        mercadoimobi_provider: sent.provider,
        mercadoimobi_file_name: data.fileName,
        mercadoimobi_mime_type: data.mimeType,
        mercadoimobi_storage_path: storagePath,
        mercadoimobi_size_bytes: bytes.byteLength,
      },
    });
    if (insertError && insertError.code !== "23505") throw new Error(insertError.message);

    const { error: updateError } = await db
      .from("whatsapp_conversations")
      .update({ last_message: label, last_message_at: now, updated_at: now })
      .eq("id", conversation.id)
      .eq("tenant_id", tenantId);
    if (updateError) throw new Error(updateError.message);

    return {
      success: true,
      externalMessageId: sent.externalMessageId,
      provider: sent.provider,
      mediaType,
      fileName: data.fileName,
    };
  });
