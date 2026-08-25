import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTenantId } from "@/lib/tenant.server";
import { emailRuntimeStatus, sendEmail } from "@/lib/smtp-email.server";

const uuid = z.string().uuid();
const opportunitySchema = z.object({ opportunityId: uuid });
const proposalSchema = z.object({
  opportunityId: uuid,
  title: z.string().trim().min(2).max(180),
  amount: z.number().nonnegative().nullable().optional(),
  validUntil: z.string().trim().max(20).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});
const proposalStatusSchema = z.object({
  proposalId: uuid,
  status: z.enum(["draft", "sent", "accepted", "rejected", "expired"]),
});
const emailSchema = z.object({
  opportunityId: uuid,
  recipient: z.string().trim().email(),
  subject: z.string().trim().min(3).max(180),
  body: z.string().trim().min(3).max(8000),
});
const uploadSchema = z.object({
  opportunityId: uuid,
  category: z.string().trim().min(1).max(60),
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().min(1).max(120),
  size: z
    .number()
    .int()
    .positive()
    .max(15 * 1024 * 1024),
});
const registerDocumentSchema = uploadSchema.extend({
  storagePath: z.string().trim().min(1).max(1000),
});
const documentSchema = z.object({ documentId: uuid });
const signatureSchema = z.object({
  opportunityId: uuid,
  title: z.string().trim().min(2).max(180),
  provider: z.string().trim().min(2).max(80),
  signingUrl: z.string().trim().url().nullable().optional(),
  signerName: z.string().trim().max(180).nullable().optional(),
  signerEmail: z.string().trim().email().nullable().optional(),
});
const signatureStatusSchema = z.object({
  signatureId: uuid,
  status: z.enum(["pending", "sent", "viewed", "signed", "canceled", "expired"]),
});
const contactSchema = z.object({
  opportunityId: uuid,
  name: z.string().trim().min(1).max(180),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  neighborhood: z.string().trim().max(120).nullable().optional(),
  propertyType: z.string().trim().max(120).nullable().optional(),
  interest: z.string().trim().max(500).nullable().optional(),
  income: z.number().nonnegative().nullable().optional(),
  downPayment: z.number().nonnegative().nullable().optional(),
  hasFgts: z.boolean().nullable().optional(),
  creditStatus: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

export interface CrmOpportunitySummary {
  id: string;
  protocol_code: string;
  contact_name: string;
  contact_phone: string | null;
  contact_email: string | null;
  property_reference: string | null;
  source: string;
  value: number | null;
  status: "open" | "won" | "lost";
  stage_id: string;
  pipeline_id: string;
  probability: number;
  created_at: string;
  updated_at: string;
  won_at: string | null;
  lost_at: string | null;
  expected_close_date: string | null;
  next_action_at: string | null;
}

export interface CrmProposalRow {
  id: string;
  opportunity_id: string;
  title: string;
  amount: number | null;
  status: "draft" | "sent" | "accepted" | "rejected" | "expired";
  valid_until: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmEmailRow {
  id: string;
  opportunity_id: string;
  recipient: string;
  subject: string;
  body: string;
  status: "draft" | "sent" | "failed";
  provider: string | null;
  provider_message_id: string | null;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface CrmDocumentRow {
  id: string;
  opportunity_id: string;
  category: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
  signed_url: string | null;
}

export interface CrmSignatureRow {
  id: string;
  opportunity_id: string;
  title: string;
  provider: string;
  signing_url: string | null;
  signer_name: string | null;
  signer_email: string | null;
  status: "pending" | "sent" | "viewed" | "signed" | "canceled" | "expired";
  signed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmContactProfile {
  opportunityId: string;
  contactId: string | null;
  protocolCode: string;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  neighborhood: string | null;
  propertyType: string | null;
  interest: string | null;
  income: number | null;
  downPayment: number | null;
  hasFgts: boolean | null;
  creditStatus: string | null;
  notes: string | null;
  source: string;
  lastWhatsappAt: string | null;
}

export interface CrmOperationsWorkspace {
  opportunities: CrmOpportunitySummary[];
  proposals: CrmProposalRow[];
  emails: CrmEmailRow[];
  documents: CrmDocumentRow[];
  signatures: CrmSignatureRow[];
  stages: Array<{
    id: string;
    pipeline_id: string;
    name: string;
    position: number;
    status_type: string;
  }>;
}

function db() {
  return supabaseAdmin as any;
}

async function tenant(context: { supabase: any; userId: string }) {
  return requireTenantId(context.supabase, context.userId);
}

async function assertOpportunity(tenantId: string, opportunityId: string) {
  const result = await db()
    .from("crm_opportunities")
    .select("id,contact_id,conversation_id,protocol_code,contact_name,contact_phone,contact_email")
    .eq("tenant_id", tenantId)
    .eq("id", opportunityId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("Oportunidade não encontrada.");
  return result.data as any;
}

function safeFileName(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 120) || "documento"
  );
}

async function ensureDocumentBucket() {
  const admin = db();
  const bucket = "crm-documents";
  const existing = await admin.storage.getBucket(bucket);
  if (!existing.data) {
    const created = await admin.storage.createBucket(bucket, {
      public: false,
      fileSizeLimit: 15 * 1024 * 1024,
      allowedMimeTypes: [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
    });
    if (created.error && !String(created.error.message).toLowerCase().includes("already")) {
      throw new Error(created.error.message);
    }
  }
  return bucket;
}

export const getCrmOperationsWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CrmOperationsWorkspace> => {
    const tenantId = await tenant(context);
    const admin = db();
    const [opportunities, proposals, emails, documents, signatures, stages] = await Promise.all([
      admin
        .from("crm_opportunities")
        .select(
          "id,protocol_code,contact_name,contact_phone,contact_email,property_reference,source,value,status,stage_id,pipeline_id,probability,created_at,updated_at,won_at,lost_at,expected_close_date,next_action_at",
        )
        .eq("tenant_id", tenantId)
        .order("updated_at", { ascending: false })
        .limit(1500),
      admin
        .from("crm_proposals")
        .select("id,opportunity_id,title,amount,status,valid_until,notes,created_at,updated_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1000),
      admin
        .from("crm_email_logs")
        .select(
          "id,opportunity_id,recipient,subject,body,status,provider,provider_message_id,error_message,sent_at,created_at",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1000),
      admin
        .from("crm_documents")
        .select("id,opportunity_id,category,file_name,mime_type,size_bytes,storage_path,created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1000),
      admin
        .from("crm_signature_requests")
        .select(
          "id,opportunity_id,title,provider,signing_url,signer_name,signer_email,status,signed_at,created_at,updated_at",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1000),
      admin
        .from("crm_stages")
        .select("id,pipeline_id,name,position,status_type")
        .eq("tenant_id", tenantId)
        .order("position", { ascending: true }),
    ]);
    const failure = [opportunities, proposals, emails, documents, signatures, stages].find(
      (result) => result.error,
    );
    if (failure?.error) throw new Error(failure.error.message);

    const bucket = await ensureDocumentBucket();
    const documentRows: CrmDocumentRow[] = [];
    for (const row of documents.data ?? []) {
      const signed = await admin.storage
        .from(bucket)
        .createSignedUrl(String(row.storage_path), 1800);
      documentRows.push({
        ...(row as any),
        size_bytes: Number(row.size_bytes ?? 0),
        signed_url: signed.data?.signedUrl ?? null,
      });
    }

    return {
      opportunities: (opportunities.data ?? []).map((row: any) => ({
        ...row,
        value: row.value == null ? null : Number(row.value),
        probability: Number(row.probability ?? 0),
      })),
      proposals: (proposals.data ?? []).map((row: any) => ({
        ...row,
        amount: row.amount == null ? null : Number(row.amount),
      })),
      emails: (emails.data ?? []) as CrmEmailRow[],
      documents: documentRows,
      signatures: (signatures.data ?? []) as CrmSignatureRow[],
      stages: (stages.data ?? []).map((row: any) => ({
        ...row,
        position: Number(row.position ?? 0),
      })),
    };
  });

export const createCrmProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => proposalSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    await assertOpportunity(tenantId, data.opportunityId);
    const result = await db()
      .from("crm_proposals")
      .insert({
        tenant_id: tenantId,
        opportunity_id: data.opportunityId,
        title: data.title,
        amount: data.amount ?? null,
        valid_until: data.validUntil || null,
        notes: data.notes || null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (result.error) throw new Error(result.error.message);
    return { success: true, id: result.data.id };
  });

export const updateCrmProposalStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => proposalStatusSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const result = await db()
      .from("crm_proposals")
      .update({ status: data.status })
      .eq("tenant_id", tenantId)
      .eq("id", data.proposalId);
    if (result.error) throw new Error(result.error.message);
    return { success: true };
  });

export const sendCrmOpportunityEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => emailSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    await assertOpportunity(tenantId, data.opportunityId);
    const runtime = emailRuntimeStatus();
    if (!runtime.configured)
      throw new Error("O provedor de e-mail ainda não está configurado no servidor.");
    try {
      const sent = await sendEmail({ to: data.recipient, subject: data.subject, text: data.body });
      const logged = await db().from("crm_email_logs").insert({
        tenant_id: tenantId,
        opportunity_id: data.opportunityId,
        recipient: data.recipient,
        subject: data.subject,
        body: data.body,
        status: "sent",
        provider: sent.provider,
        provider_message_id: sent.id,
        sent_at: new Date().toISOString(),
        created_by: context.userId,
      });
      if (logged.error) throw new Error(logged.error.message);
      return { success: true, provider: sent.provider, id: sent.id };
    } catch (error) {
      await db()
        .from("crm_email_logs")
        .insert({
          tenant_id: tenantId,
          opportunity_id: data.opportunityId,
          recipient: data.recipient,
          subject: data.subject,
          body: data.body,
          status: "failed",
          error_message: error instanceof Error ? error.message : "Falha no envio",
          created_by: context.userId,
        });
      throw error;
    }
  });

export const createCrmDocumentUploadTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => uploadSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    await assertOpportunity(tenantId, data.opportunityId);
    const bucket = await ensureDocumentBucket();
    const path = `${tenantId}/${data.opportunityId}/${data.category}/${crypto.randomUUID()}-${safeFileName(data.fileName)}`;
    const target = await db().storage.from(bucket).createSignedUploadUrl(path);
    if (target.error || !target.data?.token) {
      throw new Error(target.error?.message ?? "Não foi possível preparar o upload.");
    }
    return { bucket, path, token: target.data.token };
  });

export const registerCrmDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => registerDocumentSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    await assertOpportunity(tenantId, data.opportunityId);
    const expectedPrefix = `${tenantId}/${data.opportunityId}/`;
    if (!data.storagePath.startsWith(expectedPrefix) || data.storagePath.includes("..")) {
      throw new Error("Caminho de documento inválido.");
    }
    const result = await db()
      .from("crm_documents")
      .insert({
        tenant_id: tenantId,
        opportunity_id: data.opportunityId,
        category: data.category,
        file_name: data.fileName,
        mime_type: data.mimeType,
        size_bytes: data.size,
        storage_path: data.storagePath,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (result.error) throw new Error(result.error.message);
    return { success: true, id: result.data.id };
  });

export const deleteCrmDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => documentSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const admin = db();
    const found = await admin
      .from("crm_documents")
      .select("id,storage_path")
      .eq("tenant_id", tenantId)
      .eq("id", data.documentId)
      .maybeSingle();
    if (found.error) throw new Error(found.error.message);
    if (!found.data) throw new Error("Documento não encontrado.");
    const bucket = await ensureDocumentBucket();
    const removed = await admin.storage.from(bucket).remove([String(found.data.storage_path)]);
    if (removed.error) throw new Error(removed.error.message);
    const deleted = await admin
      .from("crm_documents")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", data.documentId);
    if (deleted.error) throw new Error(deleted.error.message);
    return { success: true };
  });

export const createCrmSignatureRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => signatureSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    await assertOpportunity(tenantId, data.opportunityId);
    const result = await db()
      .from("crm_signature_requests")
      .insert({
        tenant_id: tenantId,
        opportunity_id: data.opportunityId,
        title: data.title,
        provider: data.provider,
        signing_url: data.signingUrl || null,
        signer_name: data.signerName || null,
        signer_email: data.signerEmail || null,
        status: data.signingUrl ? "sent" : "pending",
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (result.error) throw new Error(result.error.message);
    return { success: true, id: result.data.id };
  });

export const updateCrmSignatureStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => signatureStatusSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const result = await db()
      .from("crm_signature_requests")
      .update({
        status: data.status,
        signed_at: data.status === "signed" ? new Date().toISOString() : null,
      })
      .eq("tenant_id", tenantId)
      .eq("id", data.signatureId);
    if (result.error) throw new Error(result.error.message);
    return { success: true };
  });

export const getCrmContactProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => opportunitySchema.parse(data))
  .handler(async ({ data, context }): Promise<CrmContactProfile> => {
    const tenantId = await tenant(context);
    const opportunity = await assertOpportunity(tenantId, data.opportunityId);
    const admin = db();
    let contact: any = null;
    if (opportunity.contact_id) {
      const result = await admin
        .from("crm_contacts")
        .select(
          "id,phone_e164,name,email,city,neighborhood,property_type,interest,income,down_payment,has_fgts,credit_status,notes,source,last_whatsapp_at",
        )
        .eq("tenant_id", tenantId)
        .eq("id", opportunity.contact_id)
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      contact = result.data;
    }
    return {
      opportunityId: data.opportunityId,
      contactId: contact?.id ?? opportunity.contact_id ?? null,
      protocolCode: String(opportunity.protocol_code),
      name: String(contact?.name || opportunity.contact_name || "Contato"),
      phone: contact?.phone_e164 ?? opportunity.contact_phone ?? null,
      email: contact?.email ?? opportunity.contact_email ?? null,
      city: contact?.city ?? null,
      neighborhood: contact?.neighborhood ?? null,
      propertyType: contact?.property_type ?? null,
      interest: contact?.interest ?? null,
      income: contact?.income == null ? null : Number(contact.income),
      downPayment: contact?.down_payment == null ? null : Number(contact.down_payment),
      hasFgts: typeof contact?.has_fgts === "boolean" ? contact.has_fgts : null,
      creditStatus: contact?.credit_status ?? null,
      notes: contact?.notes ?? null,
      source: String(contact?.source || "crm"),
      lastWhatsappAt: contact?.last_whatsapp_at ?? null,
    };
  });

export const saveCrmContactProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => contactSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenant(context);
    const opportunity = await assertOpportunity(tenantId, data.opportunityId);
    const admin = db();
    const payload = {
      tenant_id: tenantId,
      phone_e164: data.phone || null,
      name: data.name,
      email: data.email || null,
      city: data.city || null,
      neighborhood: data.neighborhood || null,
      property_type: data.propertyType || null,
      interest: data.interest || null,
      income: data.income ?? null,
      down_payment: data.downPayment ?? null,
      has_fgts: data.hasFgts ?? null,
      credit_status: data.creditStatus || null,
      notes: data.notes || null,
      source: opportunity.conversation_id ? "whatsapp+crm" : "crm",
    };
    let contactId = opportunity.contact_id as string | null;
    if (contactId) {
      const updated = await admin
        .from("crm_contacts")
        .update(payload)
        .eq("tenant_id", tenantId)
        .eq("id", contactId);
      if (updated.error) throw new Error(updated.error.message);
    } else if (payload.phone_e164) {
      const existing = await admin
        .from("crm_contacts")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("phone_e164", payload.phone_e164)
        .maybeSingle();
      if (existing.error) throw new Error(existing.error.message);
      if (existing.data) {
        contactId = existing.data.id;
        const updated = await admin
          .from("crm_contacts")
          .update(payload)
          .eq("tenant_id", tenantId)
          .eq("id", contactId);
        if (updated.error) throw new Error(updated.error.message);
      } else {
        const inserted = await admin.from("crm_contacts").insert(payload).select("id").single();
        if (inserted.error) throw new Error(inserted.error.message);
        contactId = inserted.data.id;
      }
    } else {
      const inserted = await admin.from("crm_contacts").insert(payload).select("id").single();
      if (inserted.error) throw new Error(inserted.error.message);
      contactId = inserted.data.id;
    }
    const synced = await admin
      .from("crm_opportunities")
      .update({
        contact_id: contactId,
        contact_name: data.name,
        contact_phone: data.phone || null,
        contact_email: data.email || null,
      })
      .eq("tenant_id", tenantId)
      .eq("id", data.opportunityId);
    if (synced.error) throw new Error(synced.error.message);
    return { success: true, contactId };
  });

export const runCrmPlatformDiagnostic = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await tenant(context);
    const admin = db();
    const [
      conversations,
      opportunities,
      missingOpportunity,
      contacts,
      missingContact,
      distributionLists,
      distributionMembers,
      aiSettings,
      proposals,
      documents,
      signatures,
    ] = await Promise.all([
      admin
        .from("whatsapp_conversations")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId),
      admin
        .from("crm_opportunities")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId),
      admin
        .from("whatsapp_conversations")
        .select("id,crm_opportunities!crm_opportunities_conversation_id_fkey(id)")
        .eq("tenant_id", tenantId),
      admin
        .from("crm_contacts")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId),
      admin
        .from("crm_opportunities")
        .select("id")
        .eq("tenant_id", tenantId)
        .not("conversation_id", "is", null)
        .is("contact_id", null),
      admin
        .from("attendance_distribution_lists")
        .select("id,name,algorithm,is_active,is_default")
        .eq("tenant_id", tenantId),
      admin
        .from("attendance_distribution_members")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("is_active", true),
      admin
        .from("ai_agent_settings")
        .select("enabled,auto_reply,agent_name")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      admin
        .from("crm_proposals")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId),
      admin
        .from("crm_documents")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId),
      admin
        .from("crm_signature_requests")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId),
    ]);
    const missingLinks = (missingOpportunity.data ?? []).filter(
      (row: any) => !Array.isArray(row.crm_opportunities) || row.crm_opportunities.length === 0,
    ).length;
    const email = emailRuntimeStatus();
    const aiKeyConfigured = Boolean(process.env["OPENAI_API_KEY"]);
    const list =
      (distributionLists.data ?? []).find((item: any) => item.is_default) ??
      distributionLists.data?.[0];
    const checks = [
      {
        key: "whatsapp_to_crm",
        label: "WhatsApp → oportunidade automática",
        status: missingLinks === 0 ? "ok" : "error",
        detail: `${Number(conversations.count ?? 0)} conversa(s), ${missingLinks} sem oportunidade vinculada.`,
      },
      {
        key: "contacts",
        label: "Cadastro automático de contatos",
        status: (missingContact.data ?? []).length === 0 ? "ok" : "warn",
        detail: `${Number(contacts.count ?? 0)} contato(s) CRM; ${(missingContact.data ?? []).length} oportunidade(s) WhatsApp sem cadastro vinculado.`,
      },
      {
        key: "distribution",
        label: "Distribuição automática",
        status: list?.is_active && (distributionMembers.data ?? []).length > 0 ? "ok" : "warn",
        detail: list
          ? `${list.name} · ${list.algorithm} · ${(distributionMembers.data ?? []).length} usuário(s) ativo(s).`
          : "Nenhuma lista de distribuição configurada.",
      },
      {
        key: "ai",
        label: "Chatbot / IA",
        status: aiKeyConfigured && aiSettings.data?.enabled ? "ok" : "warn",
        detail: `Chave do provedor: ${aiKeyConfigured ? "configurada" : "não configurada"}; agente: ${aiSettings.data?.enabled ? "ativo" : "inativo"}; resposta automática: ${aiSettings.data?.auto_reply ? "ativa" : "inativa"}.`,
      },
      {
        key: "email",
        label: "E-mail do CRM",
        status: email.configured ? "ok" : "warn",
        detail: email.configured
          ? `Provedor ${email.provider} configurado.`
          : "Provedor de e-mail ainda não configurado.",
      },
      {
        key: "operations",
        label: "Propostas, documentos e assinaturas",
        status: "ok",
        detail: `${Number(proposals.count ?? 0)} proposta(s), ${Number(documents.count ?? 0)} documento(s), ${Number(signatures.count ?? 0)} assinatura(s).`,
      },
    ] as Array<{ key: string; label: string; status: "ok" | "warn" | "error"; detail: string }>;
    return {
      checkedAt: new Date().toISOString(),
      summary: {
        conversations: Number(conversations.count ?? 0),
        opportunities: Number(opportunities.count ?? 0),
        contacts: Number(contacts.count ?? 0),
      },
      checks,
    };
  });
