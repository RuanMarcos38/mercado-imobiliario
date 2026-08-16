import { createFileRoute } from "@tanstack/react-router";

async function handler(request: Request) {
  const secret = process.env["PROPERTY_DISCOVERY_SECRET"];
  if (!secret) {
    return Response.json({ ok: false, message: "Descoberta automática ainda não ativada." }, { status: 503 });
  }
  const supplied = request.headers.get("x-discovery-key") ?? request.headers.get("x-api-key");
  if (supplied !== secret) return Response.json({ ok: false }, { status: 401 });
  if (!process.env["OPENAI_API_KEY"]) {
    return Response.json({ ok: false, message: "Inteligência de descoberta não configurada." }, { status: 503 });
  }

  const [{ supabaseAdmin }, { discoverPublicPropertySources }] = await Promise.all([
    import("@/integrations/supabase/client.server"),
    import("@/lib/property-discovery.server"),
  ]);
  const db = supabaseAdmin as any;
  const { data: rules, error } = await db
    .from("property_alert_rules")
    .select("criteria")
    .eq("active", true)
    .limit(100);
  if (error) return Response.json({ ok: false, message: "Não foi possível carregar as regiões monitoradas." }, { status: 500 });

  const targets = new Map<string, { city?: string; state?: string }>();
  for (const row of rules ?? []) {
    const criteria = (row.criteria ?? {}) as Record<string, unknown>;
    const city = typeof criteria.city === "string" ? criteria.city.trim() : "";
    const state = typeof criteria.state === "string" ? criteria.state.trim().toUpperCase() : "";
    if (!city && !state) continue;
    targets.set(`${city.toLowerCase()}|${state}`, { city: city || undefined, state: state || undefined });
  }

  if (targets.size === 0) targets.set("brasil|", { state: undefined });

  let discovered = 0;
  let processedTargets = 0;
  const now = new Date().toISOString();
  for (const target of Array.from(targets.values()).slice(0, 8)) {
    try {
      const result = await discoverPublicPropertySources({ ...target, query: "novos anúncios de imóveis e sites de imobiliárias" });
      processedTargets += 1;
      for (const candidate of result.candidates) {
        const upsert = await db.from("property_discovered_domains").upsert(
          {
            domain: candidate.domain,
            business_name: candidate.title,
            city: target.city || null,
            state: target.state || null,
            discovery_source: "scheduled_ai_web_search",
            status: "candidate",
            last_checked_at: now,
            metadata: { discovered_url: candidate.url },
            updated_at: now,
          },
          { onConflict: "domain" },
        );
        if (!upsert.error) discovered += 1;
      }
    } catch {
      // Um alvo pode falhar sem bloquear as demais regiões.
    }
  }

  return Response.json({ ok: true, processedTargets, discoveredCandidates: discovered });
}

export const Route = createFileRoute("/api/public/jobs/property-discovery")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
    },
  },
});
