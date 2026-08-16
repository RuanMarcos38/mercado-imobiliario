import { createServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

export const getSystemHealth = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await supabase.rpc("search_index_health");

  if (error) {
    throw new Error("Não foi possível verificar a disponibilidade da pesquisa.");
  }

  const health = (data ?? {}) as {
    count?: number;
    states?: number;
    latest_update?: string | null;
  };

  return {
    status: (health.count ?? 0) > 0 ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    search: {
      indexed_properties: health.count ?? 0,
      covered_states: health.states ?? 0,
      latest_update: health.latest_update ?? null,
    },
  };
});
