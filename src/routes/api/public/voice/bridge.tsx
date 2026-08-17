import { createFileRoute } from "@tanstack/react-router";

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function handleVoiceBridge(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  try {
    const { verifyVoiceBridgeToken } = await import("@/lib/dialer.functions");
    const { to } = verifyVoiceBridgeToken(token);
    const callerId = process.env["TWILIO_PHONE_NUMBER"]?.trim() || "";
    if (!callerId) throw new Error("TWILIO_PHONE_NUMBER_MISSING");
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${escapeXml(callerId)}" timeout="30"><Number>${escapeXml(to)}</Number></Dial></Response>`;
    return new Response(twiml, { status: 200, headers: { "Content-Type": "application/xml; charset=utf-8" } });
  } catch {
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>', {
      status: 403,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
  }
}

export const Route = createFileRoute("/api/public/voice/bridge")({
  server: {
    handlers: {
      GET: ({ request }) => handleVoiceBridge(request),
      POST: ({ request }) => handleVoiceBridge(request),
    },
  },
});
