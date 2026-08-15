import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";

/**
 * Exporta os leads do tenant do usuário autenticado.
 * O filtro por `tenant_id` é explícito (defesa em profundidade sobre a RLS) e o
 * usuário nunca é aceito por parâmetro — vem do token verificado.
 */
export const exportLeadsCsv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const tenantId = await requireTenantId(supabase, userId);

    const { data: leads, error } = await supabase
      .from("leads")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    if (!leads || leads.length === 0) return "Nenhum lead encontrado.";

    const firstLead = leads[0];
    if (!firstLead) return "Nenhum lead encontrado.";

    const columns = Object.keys(firstLead);
    const escape = (value: unknown): string => {
      if (value === null || value === undefined) return "";
      const raw = String(value);
      return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
    };

    const headers = columns.join(",");
    const rows = leads
      .map((lead) => columns.map((key) => escape((lead as Record<string, unknown>)[key])).join(","))
      .join("\n");

    return `${headers}\n${rows}`;
  });

export const getSystemStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: events, error } = await context.supabase
      .from("system_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    return {
      events: events ?? [],
      error: error ? { message: error.message, details: error.details, code: error.code } : null,
    };
  });
