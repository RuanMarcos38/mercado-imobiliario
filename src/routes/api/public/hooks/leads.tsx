import { createFileRoute } from "@tanstack/react-router";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requestPayload(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return request.json().catch(() => ({}));
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return {};
    return Object.fromEntries([...form.entries()].map(([key, value]) => [key, typeof value === "string" ? value : value.name]));
  }
  const text = await request.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function handleLeadWebhook(request: Request) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenant")?.trim() || "";
  const source = (url.searchParams.get("source")?.trim().toLowerCase() || "generic").slice(0, 60);
  const signature = url.searchParams.get("sig")?.trim() || "";

  if (!UUID_RE.test(tenantId) || !signature) {
    return Response.json({ ok: false, error: "invalid_webhook_url" }, { status: 401 });
  }

  const {
    ingestLeadForTenant,
    normalizeLeadPayload,
    verifyLeadWebhookSignature,
  } = await import("@/lib/lead-operations.server");

  let authorized = false;
  try {
    authorized = verifyLeadWebhookSignature(tenantId, source, signature);
  } catch {
    return Response.json({ ok: false, error: "lead_webhook_not_configured" }, { status: 503 });
  }
  if (!authorized) return Response.json({ ok: false, error: "invalid_signature" }, { status: 401 });

  const payload = await requestPayload(request);
  const lead = normalizeLeadPayload(payload, source);
  if (!lead.phone && !lead.email) {
    return Response.json(
      { ok: false, error: "lead_contact_missing", message: "Informe telefone/WhatsApp ou e-mail do lead." },
      { status: 422 },
    );
  }

  try {
    const result = await ingestLeadForTenant({ tenantId, lead });
    return Response.json({
      ok: true,
      duplicate: result.duplicate,
      leadId: result.leadId,
      assignedUserId: result.assignedUserId,
      assignedUserName: "assignedUserName" in result ? result.assignedUserName : null,
      conversationReady: Boolean(result.conversationId),
      source: lead.source,
    });
  } catch (error) {
    console.error("Lead webhook processing failed", error);
    return Response.json({ ok: false, error: "lead_processing_failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/leads")({
  server: {
    handlers: {
      GET: () => Response.json({ ok: true, service: "MercadoImobi Speed to Lead" }),
      POST: ({ request }) => handleLeadWebhook(request),
    },
  },
});
