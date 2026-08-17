import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";
import { normalizeLeadPhone } from "@/lib/lead-operations.server";

const testLeadSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(30).optional(),
});

type LeadRow = {
  id: string;
  user_id: string;
  client_name: string;
  client_phone: string | null;
  created_at: string | null;
  status: string | null;
  ai_qualification_notes: string | null;
};

type ConversationRow = { id: string; phone_e164: string | null };
type MessageRow = { conversation_id: string; sent_at: string | null };

function secondsLabel(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

function sourceFromNotes(notes: string | null) {
  const match = notes?.match(/(?:^|\n)Origem:\s*([^\n]+)/i);
  return match?.[1]?.trim() || "manual";
}

function responseSecondsForLead(
  lead: LeadRow,
  phoneMessages: Map<string, number[]>,
): number | null {
  if (!lead.created_at || !lead.client_phone) return null;
  const phone = normalizeLeadPhone(lead.client_phone);
  if (!phone) return null;
  const created = Date.parse(lead.created_at);
  if (!Number.isFinite(created)) return null;
  const messages = phoneMessages.get(phone) ?? [];
  const first = messages.find((timestamp) => timestamp >= created);
  return first === undefined ? null : Math.max(0, (first - created) / 1000);
}

export const getSpeedToLeadSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const now = Date.now();
    const since30 = new Date(now - 30 * 24 * 60 * 60_000).toISOString();
    const since7 = now - 7 * 24 * 60 * 60_000;

    const [leadsResult, conversationsResult, messagesResult] = await Promise.all([
      db
        .from("leads")
        .select("id,user_id,client_name,client_phone,created_at,status,ai_qualification_notes")
        .eq("tenant_id", tenantId)
        .gte("created_at", since30)
        .order("created_at", { ascending: false })
        .limit(5000),
      db
        .from("whatsapp_conversations")
        .select("id,phone_e164")
        .eq("tenant_id", tenantId)
        .limit(3000),
      db
        .from("whatsapp_messages")
        .select("conversation_id,sent_at")
        .eq("tenant_id", tenantId)
        .eq("direction", "outbound")
        .gte("sent_at", since30)
        .order("sent_at", { ascending: true })
        .limit(10000),
    ]);

    if (leadsResult.error) throw new Error(leadsResult.error.message);
    if (conversationsResult.error) throw new Error(conversationsResult.error.message);
    if (messagesResult.error) throw new Error(messagesResult.error.message);

    const leads = (leadsResult.data ?? []) as LeadRow[];
    const conversations = (conversationsResult.data ?? []) as ConversationRow[];
    const messages = (messagesResult.data ?? []) as MessageRow[];
    const conversationPhone = new Map<string, string>();
    for (const conversation of conversations) {
      const phone = normalizeLeadPhone(conversation.phone_e164);
      if (phone) conversationPhone.set(conversation.id, phone);
    }

    const phoneMessages = new Map<string, number[]>();
    for (const message of messages) {
      const phone = conversationPhone.get(message.conversation_id);
      const timestamp = Date.parse(message.sent_at || "");
      if (!phone || !Number.isFinite(timestamp)) continue;
      const current = phoneMessages.get(phone) ?? [];
      current.push(timestamp);
      phoneMessages.set(phone, current);
    }

    const measured = leads.map((lead) => ({
      lead,
      responseSeconds: responseSecondsForLead(lead, phoneMessages),
    }));
    const recent7 = measured.filter(({ lead }) => {
      const created = Date.parse(lead.created_at || "");
      return Number.isFinite(created) && created >= since7;
    });
    const answered7 = recent7.filter((item) => item.responseSeconds !== null);
    const values = answered7
      .map((item) => item.responseSeconds as number)
      .sort((a, b) => a - b);
    const averageSeconds = values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
    const medianSeconds = values.length
      ? values.length % 2
        ? values[Math.floor(values.length / 2)]!
        : (values[values.length / 2 - 1]! + values[values.length / 2]!) / 2
      : null;
    const withinSla = answered7.filter((item) => (item.responseSeconds as number) <= 300).length;

    const sourceMap = new Map<string, number>();
    for (const item of recent7) {
      const source = sourceFromNotes(item.lead.ai_qualification_notes);
      sourceMap.set(source, (sourceMap.get(source) ?? 0) + 1);
    }

    const userIds = [...new Set(leads.map((lead) => lead.user_id).filter(Boolean))];
    const profileMap = new Map<string, string>();
    if (userIds.length) {
      const profiles = await db.from("profiles").select("id,full_name").in("id", userIds);
      if (!profiles.error) {
        for (const profile of profiles.data ?? []) {
          profileMap.set(String(profile.id), String(profile.full_name || "Corretor"));
        }
      }
    }

    const team = userIds
      .map((userId) => {
        const userLeads = recent7.filter((item) => item.lead.user_id === userId);
        const answered = userLeads.filter((item) => item.responseSeconds !== null);
        const seconds = answered.map((item) => item.responseSeconds as number);
        const avg = seconds.length ? seconds.reduce((sum, value) => sum + value, 0) / seconds.length : null;
        const within = answered.filter((item) => (item.responseSeconds as number) <= 300).length;
        return {
          userId,
          name: profileMap.get(userId) || "Corretor",
          assigned: userLeads.length,
          answered: answered.length,
          unanswered: userLeads.length - answered.length,
          averageSeconds: avg,
          averageLabel: secondsLabel(avg),
          withinSlaPct: answered.length ? Math.round((within / answered.length) * 100) : null,
        };
      })
      .sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name));

    return {
      checkedAt: new Date().toISOString(),
      targetSeconds: 300,
      leads7d: recent7.length,
      leads30d: leads.length,
      answered7d: answered7.length,
      unanswered7d: recent7.length - answered7.length,
      averageSeconds,
      averageLabel: secondsLabel(averageSeconds),
      medianSeconds,
      medianLabel: secondsLabel(medianSeconds),
      withinSlaPct: answered7.length ? Math.round((withinSla / answered7.length) * 100) : null,
      sources: [...sourceMap.entries()]
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count),
      team,
    };
  });

export const getLeadWebhookSetup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const { createLeadWebhookUrl } = await import("@/lib/lead-operations.server");
    try {
      return {
        configured: true,
        meta: createLeadWebhookUrl(tenantId, "meta"),
        google: createLeadWebhookUrl(tenantId, "google"),
        landingPage: createLeadWebhookUrl(tenantId, "landing-page"),
        generic: createLeadWebhookUrl(tenantId, "generic"),
      };
    } catch {
      return {
        configured: false,
        meta: null,
        google: null,
        landingPage: null,
        generic: null,
      };
    }
  });

export const createSpeedToLeadTestLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => testLeadSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const { ingestLeadForTenant, normalizeLeadPayload } = await import("@/lib/lead-operations.server");
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const lead = normalizeLeadPayload(
      {
        source: "teste",
        external_id: `mercadoimobi-${unique}`,
        name: data.name || "Lead Teste MercadoImobi",
        phone: data.phone || null,
        campaign_name: "Simulação Speed to Lead",
        notes: "Lead técnico gerado pelo painel para validar distribuição e SLA.",
      },
      "teste",
    );
    return ingestLeadForTenant({ tenantId, lead });
  });
