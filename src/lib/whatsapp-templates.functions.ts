import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";
import {
  getTenantWhatsAppConnection,
  tenantMetaWhatsAppConfig,
} from "@/lib/whatsapp-provider.server";
import { createMetaWhatsAppTemplate, listMetaWhatsAppTemplates } from "@/lib/meta-whatsapp.server";
import { templateInputSchema, templateSubmission } from "@/lib/whatsapp-templates.core";

async function templateConfig(db: any, userId: string) {
  const tenantId = await requireTenantId(db, userId);
  const { data: member, error } = await db
    .from("tenant_members")
    .select("member_role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (
    error ||
    !["owner", "admin", "administrator"].includes(String(member?.member_role).toLowerCase())
  )
    throw new Error("Somente administradores desta organização podem gerenciar modelos.");
  const connection = await getTenantWhatsAppConnection(db, tenantId);
  if (connection?.provider !== "meta")
    throw new Error("Conecte o WhatsApp oficial desta organização primeiro.");
  const config = await tenantMetaWhatsAppConfig({ tenantId, userId, connection });
  if (
    !config?.businessAccountId ||
    config.businessAccountId !== connection.provider_business_account_id
  )
    throw new Error("Valide a conta WhatsApp Business desta organização nas conexões.");
  return config;
}

export const listWhatsAppTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const config = await templateConfig(context.supabase, context.userId);
    try {
      const rows = await listMetaWhatsAppTemplates(config);
      return rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        status: String(row.status),
        language: String(row.language),
        category: String(row.category),
        body: Array.isArray(row.components)
          ? String(row.components.find((c: any) => c.type === "BODY")?.text ?? "")
          : "",
        rejectedReason: typeof row.rejected_reason === "string" ? row.rejected_reason : null,
      }));
    } catch {
      throw new Error(
        "Não foi possível consultar os modelos na Meta. Verifique a conexão e as permissões de gerenciamento do WhatsApp.",
      );
    }
  });

export const submitWhatsAppTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => templateInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const config = await templateConfig(context.supabase, context.userId);
    try {
      // The WABA enforces unique template names. On timeout, refresh status rather than creating another name.
      const existing = await listMetaWhatsAppTemplates(config, data.name);
      if (existing.some((row) => row.name === data.name && row.language === "pt_BR"))
        throw new Error("ALREADY_EXISTS");
      return await createMetaWhatsAppTemplate(config, templateSubmission(data));
    } catch (error) {
      if (error instanceof Error && error.message === "ALREADY_EXISTS")
        throw new Error(
          "Já existe um modelo com esse nome. Atualize a lista para consultar o status.",
        );
      throw new Error(
        "A submissão não foi confirmada. Atualize a lista antes de tentar novamente e confira as permissões de gerenciamento na Meta.",
      );
    }
  });
