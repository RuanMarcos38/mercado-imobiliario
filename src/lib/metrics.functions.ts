import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";

export type IntegrationState = "configurada" | "não configurada";
export interface IntegrationStatus {
  key: string;
  label: string;
  state: IntegrationState;
}
export interface DailyPoint {
  name: string;
  leads: number;
  imoveis: number;
}
export interface ActivityEntry {
  id: string;
  title: string;
  desc: string;
  createdAt: string;
  severity: string;
}
export interface DashboardMetrics {
  totals: {
    leads: number;
    properties: number;
    verifiedProperties: number;
    suspiciousProperties: number;
    companies: number;
  };
  series: DailyPoint[];
  activity: ActivityEntry[];
  integrations: IntegrationStatus[];
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;
const integrationDefs = [
  { key: "n8n", label: "Importação n8n", env: "N8N_WEBHOOK_SECRET" },
  { key: "olx", label: "OLX Scanner", env: "OLX_API_KEY" },
  { key: "google_ads", label: "Google Ads API", env: "GOOGLE_ADS_API_KEY" },
  { key: "ai_agent", label: "Agente de Leads (IA)", env: "LOVABLE_API_KEY" },
  { key: "slack", label: "Alertas Slack", env: "SLACK_WEBHOOK_URL" },
] as const;

function integrationStatus(): IntegrationStatus[] {
  return integrationDefs.map((item) => ({
    key: item.key,
    label: item.label,
    state: process.env[item.env] ? "configurada" : "não configurada",
  }));
}

export const getDashboardMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardMetrics> => {
    const { supabase, userId } = context;
    const tenantId = await requireTenantId(supabase, userId);
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 6);
    since.setUTCHours(0, 0, 0, 0);
    const sinceIso = since.toISOString();

    const [leads, props, verified, suspicious, companies, recentLeads, recentProps, events] =
      await Promise.all([
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId),
        supabase
          .from("properties")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId),
        supabase
          .from("properties")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("is_verified", true),
        supabase
          .from("properties")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .lt("anti_fraud_score", 0.5),
        supabase.from("real_estate_companies").select("id", { count: "exact", head: true }),
        supabase
          .from("leads")
          .select("created_at")
          .eq("tenant_id", tenantId)
          .gte("created_at", sinceIso),
        supabase
          .from("properties")
          .select("created_at")
          .eq("tenant_id", tenantId)
          .gte("created_at", sinceIso),
        supabase
          .from("system_events")
          .select("id,event_type,message,severity,created_at")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

    const errors = [leads, props, verified, suspicious, companies, recentLeads, recentProps, events]
      .map((result) => result.error)
      .filter(Boolean);
    if (errors.length) throw new Error(errors.map((e) => e?.message).join(" | "));

    const buckets = new Map<string, { leads: number; imoveis: number }>();
    for (let offset = 6; offset >= 0; offset -= 1) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - offset);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, { leads: 0, imoveis: 0 });
    }
    for (const row of recentLeads.data ?? []) {
      if (!row.created_at) continue;
      const bucket = buckets.get(row.created_at.slice(0, 10));
      if (bucket) bucket.leads += 1;
    }
    for (const row of recentProps.data ?? []) {
      if (!row.created_at) continue;
      const bucket = buckets.get(row.created_at.slice(0, 10));
      if (bucket) bucket.imoveis += 1;
    }

    const series = Array.from(buckets.entries()).map(([date, values]) => ({
      name: WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? date,
      ...values,
    }));

    return {
      totals: {
        leads: leads.count ?? 0,
        properties: props.count ?? 0,
        verifiedProperties: verified.count ?? 0,
        suspiciousProperties: suspicious.count ?? 0,
        companies: companies.count ?? 0,
      },
      series,
      activity: (events.data ?? []).map((event) => ({
        id: event.id,
        title: event.event_type,
        desc: event.message ?? "Sem detalhes registrados.",
        createdAt: event.created_at ?? new Date().toISOString(),
        severity: event.severity ?? "info",
      })),
      integrations: integrationStatus(),
    };
  });
