import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type CheckStatus = "ok" | "error" | "not_configured";
interface CheckResult {
  status: CheckStatus;
  detail?: string;
  latency_ms?: number;
}

async function checkDatabase(): Promise<CheckResult> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return { status: "not_configured", detail: "Supabase runtime env ausente" };

  const started = Date.now();
  try {
    const client = createClient<Database>(url, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.from("subscription_plans").select("id", { head: true }).limit(1);
    if (error) return { status: "error", detail: error.message, latency_ms: Date.now() - started };
    return { status: "ok", latency_ms: Date.now() - started };
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : "Falha desconhecida",
      latency_ms: Date.now() - started,
    };
  }
}

function configured(env: string): CheckResult {
  return process.env[env]
    ? { status: "ok", detail: `${env} presente` }
    : { status: "not_configured", detail: `${env} ausente` };
}

export const Route = createFileRoute("/api/public/status")({
  server: {
    handlers: {
      GET: async () => {
        const database = await checkDatabase();
        const body = {
          status: database.status === "ok" ? "operational" : "degraded",
          timestamp: new Date().toISOString(),
          checks: {
            http: { status: "ok" } satisfies CheckResult,
            database,
            n8n: configured("N8N_WEBHOOK_SECRET"),
            olx: configured("OLX_API_KEY"),
            google_ads: configured("GOOGLE_ADS_API_KEY"),
            ai_agent: configured("LOVABLE_API_KEY"),
            slack_alerts: configured("SLACK_WEBHOOK_URL"),
          },
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
