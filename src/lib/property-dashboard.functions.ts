import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface PropertyDashboardStats {
  total_properties: number;
  market_properties: number;
  caixa_properties: number;
  auction_properties: number;
  new_last_24h: number;
  opportunities: number;
  active_sources: number;
  latest_scan: string | null;
}

const EMPTY_STATS: PropertyDashboardStats = {
  total_properties: 0,
  market_properties: 0,
  caixa_properties: 0,
  auction_properties: 0,
  new_last_24h: 0,
  opportunities: 0,
  active_sources: 0,
  latest_scan: null,
};

export const getPropertyDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PropertyDashboardStats> => {
    const client = context.supabase as any;
    const { data, error } = await client.rpc("property_dashboard_stats");
    if (error) throw new Error(error.message);
    if (!data || typeof data !== "object") return EMPTY_STATS;

    const row = data as Record<string, unknown>;
    const number = (value: unknown) => {
      const parsed = typeof value === "number" ? value : Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    return {
      total_properties: number(row.total_properties),
      market_properties: number(row.market_properties),
      caixa_properties: number(row.caixa_properties),
      auction_properties: number(row.auction_properties),
      new_last_24h: number(row.new_last_24h),
      opportunities: number(row.opportunities),
      active_sources: number(row.active_sources),
      latest_scan: typeof row.latest_scan === "string" ? row.latest_scan : null,
    };
  });
