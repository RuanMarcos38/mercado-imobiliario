import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";
import { documentParameters } from "@/lib/platform-parameters.server";
import { emailRuntimeStatus, sendEmail } from "@/lib/smtp-email.server";

const CATEGORIES = [
  "identificacao_comprador",
  "renda_comprador",
  "residencia_comprador",
  "estado_civil_comprador",
  "identificacao_vendedor",
  "estado_civil_vendedor",
  "matricula_imovel",
  "outros",
] as const;

const sendSchema = z.object({
  leadId: z.string().uuid(),
  to: z.string().trim().email(),
  subject: z.string().trim().min(3).max(180),
  message: z.string().trim().min(3).max(6000),
});

export const getEmailCcaStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const runtime = emailRuntimeStatus();
    return {
      configured: runtime.configured,
      provider: runtime.provider,
      defaultRecipient: process.env["CCA_EMAIL_TO"]?.trim() || null,
      from: runtime.from,
      maxAttachmentMb: documentParameters().emailAttachmentMaxMb,
    };
  });

export const listEmailCcaLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { data, error } = await db
      .from("leads")
      .select("id,client_name,client_email,client_phone,status,ai_qualification_notes,created_at")
      .eq("tenant_id", tenantId)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const sendCcaDocumentsByEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => sendSchema.parse(data))
  .handler(async ({ data, context }) => {
    const runtime = emailRuntimeStatus();
    if (!runtime.configured) throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");

    const parameters = documentParameters();
    const bucket = parameters.ccaBucket;
    const maxRawAttachmentBytes = parameters.emailAttachmentMaxMb * 1024 * 1024;
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const { data: lead, error: leadError } = await db
      .from("leads")
      .select("id,client_name,client_email,client_phone,status,ai_qualification_notes")
      .eq("id", data.leadId)
      .eq("tenant_id", tenantId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (leadError) throw new Error(leadError.message);
    if (!lead) throw new Error("Oportunidade não encontrada.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const prefix = `${tenantId}/${context.userId}/${data.leadId}`;
    const files: Array<{ path: string; filename: string; size: number }> = [];
    let rawSize = 0;

    for (const category of CATEGORIES) {
      const listed = await supabaseAdmin.storage.from(bucket).list(`${prefix}/${category}`, {
        limit: 100,
        sortBy: { column: "created_at", order: "asc" },
      });
      if (listed.error) continue;
      for (const file of listed.data ?? []) {
        if (!file.name || !file.id) continue;
        const size = Number(file.metadata?.size ?? 0);
        rawSize += Number.isFinite(size) ? size : 0;
        files.push({
          path: `${prefix}/${category}/${file.name}`,
          filename: file.name.replace(/^[0-9a-f-]{36}-/, ""),
          size: Number.isFinite(size) ? size : 0,
        });
      }
    }

    if (!files.length) throw new Error("Anexe os documentos do cliente no CRM antes de enviar ao CCA.");
    if (rawSize > maxRawAttachmentBytes) {
      throw new Error(
        `O dossiê ultrapassa ${parameters.emailAttachmentMaxMb} MB. Divida os documentos em mais de um envio.`,
      );
    }

    const attachments: Array<{ filename: string; content: string }> = [];
    for (const file of files) {
      const downloaded = await supabaseAdmin.storage.from(bucket).download(file.path);
      if (downloaded.error) throw new Error(`Falha ao carregar ${file.filename}.`);
      const buffer = Buffer.from(await downloaded.data.arrayBuffer());
      attachments.push({ filename: file.filename, content: buffer.toString("base64") });
    }

    const details = [
      `Cliente: ${lead.client_name}`,
      lead.client_email ? `E-mail: ${lead.client_email}` : "",
      lead.client_phone ? `Telefone: ${lead.client_phone}` : "",
      lead.status ? `Etapa CRM: ${lead.status}` : "",
      lead.ai_qualification_notes ? `Observações: ${lead.ai_qualification_notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const result = await sendEmail({
      to: data.to,
      subject: data.subject,
      text: `${data.message}\n\n${details}\n\nDocumentos anexados: ${files.length}.`,
      attachments,
    });

    return {
      success: true,
      emailId: result.id,
      provider: result.provider,
      attachmentCount: files.length,
      recipient: data.to,
    };
  });
