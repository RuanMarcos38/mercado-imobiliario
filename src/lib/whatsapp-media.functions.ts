import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  evolutionGatewayConfig,
  getTenantEvolutionInstance,
} from "@/lib/evolution-instance.server";
import { sendEvolutionMediaMessage, type EvolutionMediaType } from "@/lib/evolution-media.server";
import { requireTenantId } from "@/lib/tenant.server";
import { normalizeWhatsAppPhone, whatsappPhoneErrorMessage } from "@/lib/whatsapp-phone";
import { whatsappParameters } from "@/lib/platform-parameters.server";

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

export const sendWhatsAppAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => mediaSchema.parse(data))
  .handler(async ({ data, context }) => {
    const parameters = whatsappParameters();
    const maxBytes = parameters.maxAttachmentMb * 1024 * 1024;
    const estimatedBytes = Math.floor((data.base64.length * 3) / 4);
    if (estimatedBytes > maxBytes) {
      throw new Error(`O arquivo deve ter no máximo ${parameters.maxAttachmentMb} MB.`);
    }

    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const instanceName = await getTenantEvolutionInstance(db, tenantId);
    if (!instanceName || !evolutionGatewayConfig()) throw new Error("WHATSAPP_NOT_CONFIGURED");

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

    const mediaType = mediaTypeFromMime(data.mimeType);
    const payload = await sendEvolutionMediaMessage({
      phone,
      mediaType,
      mimeType: data.mimeType,
      fileName: data.fileName,
      base64: data.base64,
      caption: data.caption,
      instanceName,
    });

    const key = payload["key"] as Record<string, unknown> | undefined;
    const externalMessageId =
      (typeof key?.["id"] === "string" && key["id"]) ||
      (typeof payload["id"] === "string" && payload["id"]) ||
      null;
    const now = new Date().toISOString();
    const label = data.caption?.trim() || `📎 ${data.fileName}`;

    const { error: insertError } = await db.from("whatsapp_messages").insert({
      tenant_id: tenantId,
      conversation_id: conversation.id,
      external_message_id: externalMessageId,
      direction: "outbound",
      message_type: mediaType,
      body: label,
      status: "sent",
      sent_at: now,
      raw_payload: {
        ...payload,
        mercadoimobi_file_name: data.fileName,
        mercadoimobi_mime_type: data.mimeType,
      },
    });
    if (insertError && insertError.code !== "23505") throw new Error(insertError.message);

    const { error: updateError } = await db
      .from("whatsapp_conversations")
      .update({ last_message: label, last_message_at: now, updated_at: now })
      .eq("id", conversation.id)
      .eq("tenant_id", tenantId);
    if (updateError) throw new Error(updateError.message);

    return { success: true, externalMessageId, mediaType, fileName: data.fileName };
  });
