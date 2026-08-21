import { createFileRoute } from "@tanstack/react-router";
import {
  PUBLIC_SUPABASE_PROJECT_ID,
  PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  PUBLIC_SUPABASE_URL,
} from "@/integrations/supabase/public-config";

type SearchHealth = {
  count?: number;
  states?: number;
  latest_update?: string | null;
};

type SearchAvailability = {
  available: boolean;
  database: "ok" | "unavailable" | "not_configured";
  count: number;
  states: number;
  latestUpdate: string | null;
};

const RELEASE = process.env["APP_RELEASE"] || "2026.08.21-login-rm-r3";

async function checkSearchAvailability(): Promise<SearchAvailability> {
  if (!PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return {
      available: false,
      database: "not_configured",
      count: 0,
      states: 0,
      latestUpdate: null,
    };
  }

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
      return {
        available: false,
        database: "unavailable",
        count: 0,
        states: 0,
        latestUpdate: null,
      };
    }

    const data = (await response.json()) as SearchHealth;
    const count = data.count ?? 0;
    const states = data.states ?? 0;
    return {
      available: count > 0,
      database: "ok",
      count,
      states,
      latestUpdate: data.latest_update ?? null,
    };
  } catch {
    return {
      available: false,
      database: "unavailable",
      count: 0,
      states: 0,
      latestUpdate: null,
    };
  }
}

function runtimeHealth() {
  const supabaseAdminConfigured = Boolean(process.env["SUPABASE_SERVICE_ROLE_KEY"]);
  const aiConfigured = Boolean(process.env["OPENAI_API_KEY"]);
  const whatsappConfigured = Boolean(
    process.env["EVOLUTION_API_URL"] && process.env["EVOLUTION_API_KEY"],
  );
  const whatsappWebhookProtected = Boolean(process.env["WHATSAPP_WEBHOOK_SECRET"]);
  const googleMapsConfigured = Boolean(process.env["GOOGLE_MAPS_API_KEY"]);
  const propertyImportConfigured = Boolean(process.env["PROPERTY_IMPORT_WEBHOOK_SECRET"]);
  const propertyFeedSyncConfigured = Boolean(process.env["PROPERTY_FEED_SYNC_SECRET"]);
  const oruloConfigured = Boolean(
    process.env["ORULO_CLIENT_ID"] && process.env["ORULO_CLIENT_SECRET"],
  );

  return {
    supabaseAdmin: supabaseAdminConfigured ? "configured" : "not_configured",
    ai: aiConfigured ? "configured" : "not_configured",
    whatsapp: whatsappConfigured ? "configured" : "not_configured",
    whatsappWebhook: whatsappWebhookProtected ? "protected" : "not_configured",
    googleMaps: googleMapsConfigured ? "configured" : "not_configured",
    propertyImport: propertyImportConfigured ? "configured" : "not_configured",
    authorizedSourceSync: propertyFeedSyncConfigured ? "configured" : "not_configured",
    orulo: oruloConfigured ? "configured" : "not_configured",
  } as const;
}

function synchronizationHealth(latestUpdate: string | null) {
  if (!latestUpdate) return { state: "unknown", ageMinutes: null } as const;
  const ageMs = Date.now() - new Date(latestUpdate).getTime();
  const ageMinutes = Math.max(0, Math.round(ageMs / 60_000));
  return {
    state: ageMinutes <= 90 ? "fresh" : ageMinutes <= 180 ? "delayed" : "stale",
    ageMinutes,
  } as const;
}

export const Route = createFileRoute("/api/public/status")({
  server: {
    handlers: {
      GET: async () => {
        const search = await checkSearchAvailability();
        const runtime = runtimeHealth();
        const operational =
          search.count >= 1000 && search.states >= 27 && runtime.supabaseAdmin === "configured";
        const body = {
          status: operational ? "operational" : "degraded",
          release: RELEASE,
          timestamp: new Date().toISOString(),
          supabaseProjectId: PUBLIC_SUPABASE_PROJECT_ID,
          database: search.database,
          search: search.available ? "available" : "unavailable",
          indexedProperties: search.count,
          coveredStates: search.states,
          latestUpdate: search.latestUpdate,
          synchronization: synchronizationHealth(search.latestUpdate),
          runtime,
        };

        return new Response(JSON.stringify(body), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
