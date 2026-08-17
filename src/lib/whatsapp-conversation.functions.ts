import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";
import { normalizeWhatsAppPhone, whatsappPhoneErrorMessage } from "@/lib/whatsapp-phone";

const startConversationSchema = z.object({
  phone: z.string().trim().min(8).max(24),
  contactName: z.string().trim().max(120).optional(),
});

export const startWhatsAppConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => startConversationSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const phone = normalizeWhatsAppPhone(data.phone);
    if (!phone) throw new Error(whatsappPhoneErrorMessage(data.phone));

    const { data: existing, error: findError } = await db
      .from("whatsapp_conversations")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("phone_e164", phone)
      .maybeSingle();
    if (findError) throw new Error(findError.message);
    if (existing?.id) return { id: existing.id as string, created: false };

    const { data: created, error } = await db
      .from("whatsapp_conversations")
      .insert({
        tenant_id: tenantId,
        assigned_user_id: context.userId,
        phone_e164: phone,
        contact_name: data.contactName || null,
        unread_count: 0,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id as string, created: true, phone };
  });
