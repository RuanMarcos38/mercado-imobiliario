import { createFileRoute } from "@tanstack/react-router";
import { platformBaseUrl } from "@/lib/platform-parameters.server";

async function handleGoogleOAuth(request: Request) {
  const current = new URL(request.url);
  const target = new URL("/central-integracoes", platformBaseUrl());
  const code = current.searchParams.get("code") ?? "";
  const state = current.searchParams.get("state") ?? "";
  const error = current.searchParams.get("error") ?? "";

  if (error) {
    target.searchParams.set("google", "error");
    target.searchParams.set("reason", error.slice(0, 160));
    return Response.redirect(target.toString(), 302);
  }
  if (!code || !state) {
    target.searchParams.set("google", "error");
    target.searchParams.set("reason", "Retorno do Google incompleto.");
    return Response.redirect(target.toString(), 302);
  }

  try {
    const { completeGoogleOAuth } = await import("@/lib/google-workspace.server");
    const result = await completeGoogleOAuth({ code, state });
    target.searchParams.set("google", "connected");
    if (result.email) target.searchParams.set("account", result.email);
  } catch (oauthError) {
    target.searchParams.set("google", "error");
    target.searchParams.set(
      "reason",
      oauthError instanceof Error ? oauthError.message.slice(0, 180) : "GOOGLE_OAUTH_FAILED",
    );
  }
  return Response.redirect(target.toString(), 302);
}

export const Route = createFileRoute("/api/public/oauth/google")({
  server: {
    handlers: {
      GET: ({ request }) => handleGoogleOAuth(request),
    },
  },
});
