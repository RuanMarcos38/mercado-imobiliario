import { createFileRoute } from "@tanstack/react-router";

function appBaseUrl() {
  return (
    process.env["MERCADOIMOBI_BASE_URL"]?.trim().replace(/\/$/, "") ||
    "https://mercadoimobi.rdmconsultoriaimobiliaria.com.br"
  );
}

async function handleMetaOAuth(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const error = url.searchParams.get("error") ?? "";
  const errorDescription = url.searchParams.get("error_description") ?? "";
  const target = new URL("/midias-sociais", appBaseUrl());

  if (error) {
    target.searchParams.set("meta", "error");
    target.searchParams.set("reason", errorDescription || error);
    return Response.redirect(target.toString(), 302);
  }
  if (!code || !state) {
    target.searchParams.set("meta", "error");
    target.searchParams.set("reason", "Retorno do Meta incompleto.");
    return Response.redirect(target.toString(), 302);
  }

  try {
    const { completeMetaOAuth } = await import("@/lib/meta-social.server");
    const result = await completeMetaOAuth({ code, state });
    target.searchParams.set("meta", "connected");
    target.searchParams.set("pages", String(result.pageCount));
    target.searchParams.set("instagram", String(result.instagramCount));
  } catch (oauthError) {
    target.searchParams.set("meta", "error");
    target.searchParams.set(
      "reason",
      oauthError instanceof Error ? oauthError.message.slice(0, 180) : "META_OAUTH_FAILED",
    );
  }
  return Response.redirect(target.toString(), 302);
}

export const Route = createFileRoute("/api/public/oauth/meta")({
  server: {
    handlers: {
      GET: ({ request }) => handleMetaOAuth(request),
    },
  },
});
