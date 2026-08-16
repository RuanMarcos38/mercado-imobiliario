import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  PUBLIC_SUPABASE_URL,
} from "@/integrations/supabase/public-config";

type Availability = "available" | "unavailable";

async function checkSearchAvailability(): Promise<Availability> {
  const url = process.env["SUPABASE_URL"] || PUBLIC_SUPABASE_URL;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"] || PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  try {
    const client = createClient<Database>(url, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client
      .from("property_search_index")
      .select("id", { head: true })
      .limit(1);
    return error ? "unavailable" : "available";
  } catch {
    return "unavailable";
  }
}

export const Route = createFileRoute("/api/public/status")({
  server: {
    handlers: {
      GET: async () => {
        const search = await checkSearchAvailability();
        const body = {
          status: search === "available" ? "operational" : "degraded",
          timestamp: new Date().toISOString(),
          search,
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
