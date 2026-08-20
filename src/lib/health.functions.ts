import { createServerFn } from "@tanstack/react-start";
import {
  PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  PUBLIC_SUPABASE_URL,
} from "@/integrations/supabase/public-config";

type SearchHealth = {
  count?: number;
  states?: number;
  latest_update?: string | null;
};

async function fetchSearchHealth(): Promise<SearchHealth> {
  if (!PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("SUPABASE_PUBLISHABLE_KEY_NOT_CONFIGURED");
  }

  const response = await fetch(`${PUBLIC_SUPABASE_URL}/rest/v1/rpc/search_index_health`, {
    method: "POST",
    headers: {
      apikey: PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      "content-type": "application/json",
    },
    body: "{}",
  });

  if (!response.ok) {
    throw new Error("SEARCH_HEALTH_UNAVAILABLE");
  }

  return (await response.json()) as SearchHealth;
}

export const getSystemHealth = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const health = await fetchSearchHealth();
    const indexedProperties = health.count ?? 0;
    const coveredStates = health.states ?? 0;
    const operational = indexedProperties >= 1000 && coveredStates >= 27;
    return {
      status: operational ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      database: "ok",
      search: {
        indexed_properties: indexedProperties,
        covered_states: coveredStates,
        latest_update: health.latest_update ?? null,
      },
    };
  } catch {
    return {
      status: "degraded",
      timestamp: new Date().toISOString(),
      database: PUBLIC_SUPABASE_PUBLISHABLE_KEY ? "unavailable" : "not_configured",
      search: {
        indexed_properties: 0,
        covered_states: 0,
        latest_update: null,
      },
    };
  }
});
