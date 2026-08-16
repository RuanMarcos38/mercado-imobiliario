import { createFileRoute } from "@tanstack/react-router";
import {
  PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  PUBLIC_SUPABASE_URL,
} from "@/integrations/supabase/public-config";

type SearchHealth = {
  count?: number;
  states?: number;
  latest_update?: string | null;
};

async function checkSearchAvailability() {
  try {
    const response = await fetch(`${PUBLIC_SUPABASE_URL}/rest/v1/rpc/search_index_health`, {
      method: "POST",
      headers: {
        apikey: PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        "content-type": "application/json",
      },
      body: "{}",
    });

    if (!response.ok) {
      return { available: false, count: 0, states: 0, latestUpdate: null };
    }

    const data = (await response.json()) as SearchHealth;
    return {
      available: (data.count ?? 0) > 0,
      count: data.count ?? 0,
      states: data.states ?? 0,
      latestUpdate: data.latest_update ?? null,
    };
  } catch {
    return { available: false, count: 0, states: 0, latestUpdate: null };
  }
}

function runtimeHealth() {
  const aiConfigured = Boolean(process.env["OPENAI_API_KEY"]);
  const whatsappConfigured = Boolean(
    process.env["EVOLUTION_API_URL"] &&
      process.env["EVOLUTION_API_KEY"] &&
      process.env["EVOLUTION_INSTANCE"],
  );
  const whatsappWebhookProtected = Boolean(process.env["WHATSAPP_WEBHOOK_SECRET"]);
  const propertyImportConfigured = Boolean(process.env["PROPERTY_IMPORT_WEBHOOK_SECRET"]);

  return {
    ai: aiConfigured ? "configured" : "not_configured",
    whatsapp: whatsappConfigured ? "configured" : "not_configured",
    whatsappWebhook: whatsappWebhookProtected ? "protected" : "not_configured",
    propertyImport: propertyImportConfigured ? "configured" : "not_configured",
  } as const;
}

export const Route = createFileRoute("/api/public/status")({
  server: {
    handlers: {
      GET: async () => {
        const search = await checkSearchAvailability();
        const body = {
          status: search.available ? "operational" : "degraded",
          timestamp: new Date().toISOString(),
          search: search.available ? "available" : "unavailable",
          indexedProperties: search.count,
          coveredStates: search.states,
          latestUpdate: search.latestUpdate,
          runtime: runtimeHealth(),
        };

        return new Response(JSON.stringify(body), {
          status: search.available ? 200 : 503,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
