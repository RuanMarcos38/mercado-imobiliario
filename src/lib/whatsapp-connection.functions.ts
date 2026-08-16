import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";

export const prepareWhatsAppConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const instance = process.env["EVOLUTION_INSTANCE"];
    const baseUrl = process.env["EVOLUTION_API_URL"];
    const apiKey = process.env["EVOLUTION_API_KEY"];

    if (!instance || !baseUrl || !apiKey) {
      return { configured: false, ready: false };
    }

    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const now = new Date().toISOString();
    const { error } = await db.from("whatsapp_connections").upsert(
      {
        tenant_id: tenantId,
        owner_user_id: context.userId,
        instance_name: instance,
        display_name: "WhatsApp MercadoImobi",
        status: "connecting",
        updated_at: now,
      },
      { onConflict: "tenant_id" },
    );

    if (error) throw new Error(error.message);
    return { configured: true, ready: true };
  });
