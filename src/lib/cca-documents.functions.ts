import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";

const BUCKET = "cca-documents";
export const CCA_DOCUMENT_CATEGORIES = [
  "identificacao_comprador",
  "renda_comprador",
  "residencia_comprador",
  "estado_civil_comprador",
  "identificacao_vendedor",
  "estado_civil_vendedor",
  "matricula_imovel",
  "outros",
] as const;

export const CCA_DOCUMENT_LABELS: Record<(typeof CCA_DOCUMENT_CATEGORIES)[number], string> = {
  identificacao_comprador: "Identificação do comprador",
  renda_comprador: "Comprovação de renda",
  residencia_comprador: "Comprovante de residência",
  estado_civil_comprador: "Estado civil do comprador",
  identificacao_vendedor: "Identificação do vendedor",
  estado_civil_vendedor: "Estado civil do vendedor",
  matricula_imovel: "Matrícula/certidão do imóvel",
  outros: "Outros documentos",
};

const leadSchema = z.object({ leadId: z.string().uuid() });
const uploadSchema = leadSchema.extend({
  category: z.enum(CCA_DOCUMENT_CATEGORIES),
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().min(1).max(100),
  size: z.number().int().positive().max(12 * 1024 * 1024),
});
const removeSchema = leadSchema.extend({ path: z.string().min(1).max(1000) });

export interface CcaDocument {
  path: string;
  name: string;
  category: string;
  size: number | null;
  createdAt: string | null;
  signedUrl: string | null;
}

async function assertLeadOwnership(context: { supabase: any; userId: string }, leadId: string) {
  const tenantId = await requireTenantId(context.supabase, context.userId);
  const { data, error } = await context.supabase
    .from("leads")
    .select("id,client_name,client_email,client_phone,ai_qualification_notes,status")
    .eq("id", leadId)
    .eq("tenant_id", tenantId)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Oportunidade não encontrada.");
  return { tenantId, lead: data };
}

async function ensureBucket(admin: any) {
  const { data } = await admin.storage.getBucket(BUCKET);
  if (data) return;
  const created = await admin.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 12 * 1024 * 1024,
    allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
  });
  if (created.error && !String(created.error.message).toLowerCase().includes("already")) {
    throw new Error(created.error.message);
  }
}

function safeFileName(value: string) {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const cleaned = normalized.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  return cleaned.replace(/^[-.]+|[-.]+$/g, "").slice(0, 120) || "documento";
}

function prefix(tenantId: string, userId: string, leadId: string) {
  return `${tenantId}/${userId}/${leadId}`;
}

async function listFiles(admin: any, basePrefix: string): Promise<CcaDocument[]> {
  const documents: CcaDocument[] = [];
  for (const category of CCA_DOCUMENT_CATEGORIES) {
    const folder = `${basePrefix}/${category}`;
    const listed = await admin.storage.from(BUCKET).list(folder, {
      limit: 100,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (listed.error) continue;
    for (const file of listed.data ?? []) {
      if (!file.name || !file.id) continue;
      const path = `${folder}/${file.name}`;
      const signed = await admin.storage.from(BUCKET).createSignedUrl(path, 15 * 60);
      documents.push({
        path,
        name: file.name.replace(/^[0-9a-f-]{36}-/, ""),
        category,
        size:
          typeof file.metadata?.size === "number"
            ? file.metadata.size
            : Number.isFinite(Number(file.metadata?.size))
              ? Number(file.metadata?.size)
              : null,
        createdAt: file.created_at ?? null,
        signedUrl: signed.data?.signedUrl ?? null,
      });
    }
  }
  return documents;
}

export const createCcaUploadTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => uploadSchema.parse(data))
  .handler(async ({ data, context }) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(data.mimeType)) throw new Error("Tipo de arquivo não permitido.");
    const { tenantId } = await assertLeadOwnership(context, data.leadId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await ensureBucket(supabaseAdmin);

    const path = `${prefix(tenantId, context.userId, data.leadId)}/${data.category}/${crypto.randomUUID()}-${safeFileName(data.fileName)}`;
    const result = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (result.error || !result.data?.token) {
      throw new Error(result.error?.message ?? "Não foi possível preparar o envio do documento.");
    }
    return { bucket: BUCKET, path, token: result.data.token };
  });

export const listCcaDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => leadSchema.parse(data))
  .handler(async ({ data, context }): Promise<CcaDocument[]> => {
    const { tenantId } = await assertLeadOwnership(context, data.leadId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await ensureBucket(supabaseAdmin);
    return listFiles(supabaseAdmin, prefix(tenantId, context.userId, data.leadId));
  });

export const removeCcaDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => removeSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { tenantId } = await assertLeadOwnership(context, data.leadId);
    const base = `${prefix(tenantId, context.userId, data.leadId)}/`;
    if (!data.path.startsWith(base) || data.path.includes("..")) throw new Error("Documento inválido.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await supabaseAdmin.storage.from(BUCKET).remove([data.path]);
    if (result.error) throw new Error(result.error.message);
    return { success: true };
  });

export const submitLeadToCca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => leadSchema.parse(data))
  .handler(async ({ data, context }) => {
    const endpoint = process.env["CCA_INTEGRATION_URL"]?.trim();
    const token = process.env["CCA_INTEGRATION_TOKEN"]?.trim();
    const { tenantId, lead } = await assertLeadOwnership(context, data.leadId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await ensureBucket(supabaseAdmin);
    const documents = await listFiles(
      supabaseAdmin,
      prefix(tenantId, context.userId, data.leadId),
    );

    if (!endpoint) {
      return {
        configured: false,
        submitted: false,
        documentCount: documents.length,
        message:
          "Dossiê pronto. Configure o endpoint oficial/contratado do CCA para habilitar o envio direto.",
      };
    }
    if (!documents.length) throw new Error("Anexe ao menos um documento antes do envio ao CCA.");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        source: "MercadoImobi",
        submittedAt: new Date().toISOString(),
        tenantId,
        lead: {
          id: data.leadId,
          name: lead.client_name,
          email: lead.client_email,
          phone: lead.client_phone,
          status: lead.status,
          notes: lead.ai_qualification_notes,
        },
        documents: documents.map((document) => ({
          category: document.category,
          fileName: document.name,
          url: document.signedUrl,
        })),
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`CCA_SEND_FAILED:${response.status}:${body.slice(0, 300)}`);
    }
    return {
      configured: true,
      submitted: true,
      documentCount: documents.length,
      message: "Dossiê enviado ao conector CCA configurado.",
    };
  });
