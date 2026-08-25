import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ApiPrincipal = {
  tokenId: string;
  tenantId: string;
  userId: string;
};

export async function authenticateApiRequest(request: Request): Promise<ApiPrincipal | null> {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return null;
  const token = match[1].trim();
  if (!token.startsWith("mi_live_") || token.length < 32) return null;
  const hash = createHash("sha256").update(token).digest("hex");
  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("user_api_tokens")
    .select("id,tenant_id,user_id,revoked_at,expires_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;
  if (data.expires_at && new Date(String(data.expires_at)).getTime() <= Date.now()) return null;
  await db
    .from("user_api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => undefined);
  return {
    tokenId: String(data.id),
    tenantId: String(data.tenant_id),
    userId: String(data.user_id),
  };
}

export function apiJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-MercadoImobi-API-Version": "v1",
    },
  });
}
