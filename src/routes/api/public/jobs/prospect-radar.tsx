import { createFileRoute } from "@tanstack/react-router";
import {
  ensureProspectRadarLoop,
  getProspectRadarPublicStatus,
  runScheduledProspectRadar,
} from "@/lib/prospect-radar.server";

// A rota é carregada pelo servidor no boot. O scheduler usa somente memória do processo
// e não cria tabela, migration ou escrita no Supabase.
ensureProspectRadarLoop();

function authorized(request: Request) {
  const expected =
    process.env["CRM_AUTOMATION_JOB_SECRET"]?.trim() ||
    process.env["PROPERTY_FEED_SYNC_SECRET"]?.trim() ||
    "";
  const received = request.headers.get("x-mercadoimobi-job-key")?.trim() || "";
  return Boolean(expected && received && expected === received);
}

async function handlePost(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const snapshot = await runScheduledProspectRadar();
  return Response.json({
    ok: true,
    searchedAt: snapshot.searchedAt,
    nextRunAt: snapshot.nextRunAt,
    leads: snapshot.result.leads.length,
    hot: snapshot.result.leads.filter((lead) => lead.intentStage === "quente").length,
    providers: snapshot.providers,
  });
}

function handleGet() {
  // Status público contém apenas saúde e contagens agregadas; nenhum perfil, contato ou lead.
  return Response.json({ ok: true, ...getProspectRadarPublicStatus() });
}

export const Route = createFileRoute("/api/public/jobs/prospect-radar")({
  server: {
    handlers: {
      GET: () => handleGet(),
      POST: ({ request }) => handlePost(request),
    },
  },
});
