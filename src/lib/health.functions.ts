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
    return {
      status: (health.count ?? 0) > 0 ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      search: {
        indexed_properties: health.count ?? 0,
        covered_states: health.states ?? 0,
        latest_update: health.latest_update ?? null,
      },
    };
  } catch {
    return {
      status: "degraded",
      timestamp: new Date().toISOString(),
      search: {
        indexed_properties: 0,
        covered_states: 0,
        latest_update: null,
      },
    };
  }
});
