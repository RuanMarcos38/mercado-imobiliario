import { createFileRoute } from "@tanstack/react-router";
import { resolvePlatformSecret } from "@/lib/platform-secret.server";

async function handler(request: Request) {
  const secret = await resolvePlatformSecret(
    "PROPERTY_FEED_SYNC_SECRET",
    "mercadoimobi_property_feed_sync_secret",
  );
  if (!secret) {
    return Response.json(
      { ok: false, message: "Atualização automática ainda não ativada." },
      { status: 503 },
    );
  }

  const supplied =
    request.headers.get("x-property-feed-sync-key") ??
    request.headers.get("x-api-key") ??
    new URL(request.url).searchParams.get("key");
  if (supplied !== secret) return Response.json({ ok: false }, { status: 401 });

  const { syncAllAuthorizedFeeds } = await import("@/lib/property-feed.server");
  const results = await syncAllAuthorizedFeeds(30);
  const success = results.filter((result) => result.success).length;
  const failed = results.length - success;

  return Response.json({
    ok: failed === 0,
    processed: results.length,
    success,
    failed,
    results,
    synchronizedAt: new Date().toISOString(),
  });
}

export const Route = createFileRoute("/api/public/jobs/property-feeds")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
    },
  },
});
