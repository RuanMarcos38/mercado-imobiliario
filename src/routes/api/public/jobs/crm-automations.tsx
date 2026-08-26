import { createFileRoute } from "@tanstack/react-router";
import { resolvePlatformSecret } from "@/lib/platform-secret.server";

async function authorized(request: Request) {
  const expected =
    process.env["CRM_AUTOMATION_JOB_SECRET"]?.trim() ||
    (await resolvePlatformSecret(
      "PROPERTY_FEED_SYNC_SECRET",
      "mercadoimobi_property_feed_sync_secret",
    ));
  const received = request.headers.get("x-mercadoimobi-job-key")?.trim() || "";
  return Boolean(expected && received && expected === received);
}

async function handle(request: Request) {
  if (!(await authorized(request)))
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { runCrmAutomationMaintenance } = await import("@/lib/crm-appointments.functions");
  const result = await runCrmAutomationMaintenance();
  return Response.json({ ok: true, ...result, ranAt: new Date().toISOString() });
}

export const Route = createFileRoute("/api/public/jobs/crm-automations")({
  server: { handlers: { POST: ({ request }) => handle(request) } },
});
