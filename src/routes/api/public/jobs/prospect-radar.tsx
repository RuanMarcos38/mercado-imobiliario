import { createFileRoute } from "@tanstack/react-router";

function authorized(request: Request) {
  const expected =
    process.env["CRM_AUTOMATION_JOB_SECRET"]?.trim() ||
    process.env["PROPERTY_FEED_SYNC_SECRET"]?.trim() ||
    "";
  const received = request.headers.get("x-mercadoimobi-job-key")?.trim() || "";
  return Boolean(expected && received && expected === received);
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { runScheduledProspectRadar } = await import("@/lib/prospect-radar.server");
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

export const Route = createFileRoute("/api/public/jobs/prospect-radar")({
  server: { handlers: { POST: ({ request }) => handle(request) } },
});
