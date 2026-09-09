import { createFileRoute } from "@tanstack/react-router";
import {
  metaSocialWebhookSignatureValid,
  processMetaSocialWebhook,
  verifyMetaSocialWebhookChallenge,
} from "@/lib/meta-social-automation.server";

type JsonObject = Record<string, unknown>;

function parsePayload(rawBody: string): JsonObject | null {
  try {
    const parsed = JSON.parse(rawBody);
    return parsed && typeof parsed === "object" ? (parsed as JsonObject) : null;
  } catch {
    return null;
  }
}

async function handlePost(request: Request) {
  const rawBody = await request.text();
  if (!metaSocialWebhookSignatureValid(request, rawBody)) {
    return Response.json({ ok: false, error: "unauthorized_meta_webhook" }, { status: 401 });
  }

  const payload = parsePayload(rawBody);
  if (!payload) {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const result = await processMetaSocialWebhook(payload);
  return Response.json({ ok: true, ...result });
}

export const Route = createFileRoute("/api/public/hooks/meta-social")({
  server: {
    handlers: {
      GET: ({ request }) => verifyMetaSocialWebhookChallenge(request),
      POST: ({ request }) => handlePost(request),
    },
  },
});
