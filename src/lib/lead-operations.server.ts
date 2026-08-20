import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp-phone";
import { platformBaseUrl, speedToLeadParameters } from "@/lib/platform-parameters.server";

export type NormalizedInboundLead = {
  source: string;
  externalId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  propertyReference: string | null;
  campaign: string | null;
  notes: string | null;
};

type FieldMap = Record<string, string>;

function baseUrl() {
  return platformBaseUrl();
}

function leadWebhookSecret() {
  return (
    process.env["LEAD_WEBHOOK_SECRET"]?.trim() ||
    process.env["INTEGRATIONS_ENCRYPTION_KEY"]?.trim() ||
    process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim() ||
    ""
  );
}

export function createLeadWebhookSignature(tenantId: string, source = "generic") {
  const secret = leadWebhookSecret();
  if (!secret) throw new Error("LEAD_WEBHOOK_SECRET_MISSING");
  return createHmac("sha256", secret).update(`${tenantId}:${source}`).digest("base64url");
}

export function verifyLeadWebhookSignature(tenantId: string, source: string, signature: string) {
  const expected = createLeadWebhookSignature(tenantId, source);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createLeadWebhookUrl(tenantId: string, source: string) {
  const url = new URL("/api/public/hooks/leads", baseUrl());
  url.searchParams.set("tenant", tenantId);
  url.searchParams.set("source", source);
  url.searchParams.set("sig", createLeadWebhookSignature(tenantId, source));
  return url.toString();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function fieldDataMap(payload: Record<string, unknown>) {
  const map: FieldMap = {};
  const candidates = [payload["field_data"], object(payload["data"])["field_data"]];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const item of candidate) {
      const row = object(item);
      const key = firstString(row["name"], row["key"]);
      if (!key) continue;
      const values = Array.isArray(row["values"]) ? row["values"] : [row["value"]];
      const value = firstString(...values);
      if (value) map[key.toLowerCase()] = value;
    }
  }
  return map;
}

function fieldValue(fields: FieldMap, ...keys: string[]) {
  for (const key of keys) {
    const value = fields[key.toLowerCase()];
    if (value) return value;
  }
  return null;
}

export function normalizeLeadPhone(value: string | null | undefined) {
  if (!value) return null;
  const direct = normalizeWhatsAppPhone(value);
  if (direct) return direct;
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

export function normalizeLeadPayload(
  payload: unknown,
  sourceHint = "generic",
): NormalizedInboundLead {
  const root = object(payload);
  const data = object(root["data"]);
  const lead = object(root["lead"]);
  const customer = object(root["customer"]);
  const merged = { ...root, ...data, ...lead, ...customer };
  const fields = fieldDataMap({ ...root, ...data, ...lead });

  const source =
    firstString(
      merged["source"],
      merged["platform"],
      merged["origem"],
      sourceHint,
    )?.toLowerCase() || "generic";
  const externalId = firstString(
    merged["external_id"],
    merged["externalId"],
    merged["lead_id"],
    merged["leadId"],
    merged["leadgen_id"],
    merged["id"],
  );
  const name =
    firstString(
      merged["full_name"],
      merged["name"],
      merged["nome"],
      merged["client_name"],
      fieldValue(fields, "full_name", "name", "nome_completo", "nome"),
    ) || "Novo lead";
  const email = firstString(
    merged["email"],
    merged["client_email"],
    fieldValue(fields, "email", "email_address", "e-mail"),
  );
  const rawPhone = firstString(
    merged["phone"],
    merged["phone_number"],
    merged["telefone"],
    merged["whatsapp"],
    merged["client_phone"],
    fieldValue(fields, "phone_number", "phone", "telefone", "whatsapp", "celular"),
  );
  const propertyReference = firstString(
    merged["property"],
    merged["property_reference"],
    merged["propertyReference"],
    merged["imovel"],
    merged["empreendimento"],
    fieldValue(fields, "property", "imovel", "empreendimento", "interesse"),
  );
  const campaign = firstString(
    merged["campaign_name"],
    merged["campaign"],
    merged["ad_name"],
    merged["form_name"],
    merged["utm_campaign"],
  );
  const notes = firstString(
    merged["notes"],
    merged["observacoes"],
    merged["message"],
    merged["mensagem"],
  );

  return {
    source,
    externalId,
    name,
    email,
    phone: normalizeLeadPhone(rawPhone),
    propertyReference,
    campaign,
    notes,
  };
}

function fingerprint(tenantId: string, lead: NormalizedInboundLead) {
  const identity =
    lead.externalId || lead.phone || lead.email || `${lead.name}:${lead.campaign || ""}`;
  return createHash("sha256")
    .update(`${tenantId}|${lead.source}|${identity}`)
    .digest("hex")
    .slice(0, 32);
}

function buildLeadNotes(lead: NormalizedInboundLead, marker: string) {
  return [
    `Origem: ${lead.source}`,
    lead.campaign ? `Campanha: ${lead.campaign}` : "",
    lead.propertyReference ? `Imóvel/oportunidade: ${lead.propertyReference}` : "",
    lead.notes ? `Observações: ${lead.notes}` : "",
    `Recebido automaticamente: ${new Date().toISOString()}`,
    `[mi-lead:${marker}]`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function eligibleTenantUsers(tenantId: string) {
  const db = supabaseAdmin as any;
  const membersResult = await db
    .from("tenant_members")
    .select("user_id,member_role")
    .eq("tenant_id", tenantId);
  if (membersResult.error) throw new Error(membersResult.error.message);
  const members = (membersResult.data ?? []) as Array<{
    user_id: string;
    member_role: string | null;
  }>;
  const ids = members.map((item) => item.user_id).filter(Boolean);
  if (!ids.length) return [];

  const profilesResult = await db
    .from("profiles")
    .select("id,full_name,user_type,is_active")
    .in("id", ids);
  if (profilesResult.error) throw new Error(profilesResult.error.message);
  const profiles = (profilesResult.data ?? []) as Array<{
    id: string;
    full_name: string | null;
    user_type: string | null;
    is_active: boolean | null;
  }>;

  return profiles.filter((profile) => {
    if (profile.is_active === false) return false;
    const type = String(profile.user_type ?? "").toLowerCase();
    return !["cliente", "proprietario"].includes(type);
  });
}

async function chooseAssignee(tenantId: string, preferredUserId?: string | null) {
  const db = supabaseAdmin as any;
  const users = await eligibleTenantUsers(tenantId);
  if (!users.length) throw new Error("Nenhum usuário ativo disponível para receber o lead.");
  const preferred = preferredUserId ? users.find((user) => user.id === preferredUserId) : null;
  if (preferred) return preferred;

  const parameters = speedToLeadParameters();
  const since = new Date(
    Date.now() - parameters.distributionLookbackHours * 60 * 60_000,
  ).toISOString();
  const recentResult = await db
    .from("leads")
    .select("user_id,created_at")
    .eq("tenant_id", tenantId)
    .gte("created_at", since)
    .limit(parameters.maxDistributionSample);
  if (recentResult.error) throw new Error(recentResult.error.message);

  const load = new Map<string, number>();
  const lastAssigned = new Map<string, number>();
  for (const row of recentResult.data ?? []) {
    const userId = String(row.user_id ?? "");
    if (!userId) continue;
    load.set(userId, (load.get(userId) ?? 0) + 1);
    const time = Date.parse(String(row.created_at ?? ""));
    if (Number.isFinite(time))
      lastAssigned.set(userId, Math.max(lastAssigned.get(userId) ?? 0, time));
  }

  return [...users].sort((a, b) => {
    const loadDiff = (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0);
    if (loadDiff !== 0) return loadDiff;
    const lastDiff = (lastAssigned.get(a.id) ?? 0) - (lastAssigned.get(b.id) ?? 0);
    if (lastDiff !== 0) return lastDiff;
    return a.id.localeCompare(b.id);
  })[0]!;
}

async function ensureConversation(tenantId: string, phone: string | null, name: string) {
  if (!phone) return null;
  const db = supabaseAdmin as any;
  try {
    const existing = await db
      .from("whatsapp_conversations")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("phone_e164", phone)
      .maybeSingle();
    if (existing.data?.id) return String(existing.data.id);
    const inserted = await db
      .from("whatsapp_conversations")
      .insert({
        tenant_id: tenantId,
        phone_e164: phone,
        contact_name: name,
        last_message: "Novo lead aguardando atendimento",
        last_message_at: new Date().toISOString(),
        unread_count: 0,
      })
      .select("id")
      .single();
    return inserted.data?.id ? String(inserted.data.id) : null;
  } catch {
    return null;
  }
}

export async function ingestLeadForTenant(input: {
  tenantId: string;
  lead: NormalizedInboundLead;
  preferredUserId?: string | null;
}) {
  const db = supabaseAdmin as any;
  const marker = fingerprint(input.tenantId, input.lead);
  const duplicate = await db
    .from("leads")
    .select("id,user_id")
    .eq("tenant_id", input.tenantId)
    .ilike("ai_qualification_notes", `%[mi-lead:${marker}]%`)
    .limit(1)
    .maybeSingle();
  if (duplicate.error) throw new Error(duplicate.error.message);
  if (duplicate.data?.id) {
    return {
      success: true,
      duplicate: true,
      leadId: String(duplicate.data.id),
      assignedUserId: String(duplicate.data.user_id),
      conversationId: null as string | null,
    };
  }

  const assignee = await chooseAssignee(input.tenantId, input.preferredUserId);
  const notes = buildLeadNotes(input.lead, marker);
  const inserted = await db
    .from("leads")
    .insert({
      tenant_id: input.tenantId,
      user_id: assignee.id,
      client_name: input.lead.name,
      client_email: input.lead.email,
      client_phone: input.lead.phone,
      status: "novo",
      ai_qualification_notes: notes,
    })
    .select("id")
    .single();
  if (inserted.error) throw new Error(inserted.error.message);

  const conversationId = await ensureConversation(
    input.tenantId,
    input.lead.phone,
    input.lead.name,
  );
  return {
    success: true,
    duplicate: false,
    leadId: String(inserted.data.id),
    assignedUserId: assignee.id,
    assignedUserName: assignee.full_name || "Corretor",
    conversationId,
  };
}
