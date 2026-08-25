import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";

const tokenCreateSchema = z.object({ name: z.string().trim().min(2).max(80) });
const tokenIdSchema = z.object({ tokenId: z.string().uuid() });

export interface IntegrationHubOverview {
  catalog: Array<{
    key: string;
    categoryKey: string;
    categoryLabel: string;
    name: string;
    description: string;
    status: string;
    sortOrder: number;
  }>;
  accounts: Array<{
    providerKey: string;
    status: string;
    accountLabel: string | null;
    connectedAt: string | null;
    lastSyncAt: string | null;
    lastError: string | null;
  }>;
  google: {
    configured: boolean;
    connected: boolean;
    email: string | null;
    connectedAt: string | null;
  };
  apiTokens: Array<{
    id: string;
    name: string;
    prefix: string;
    lastUsedAt: string | null;
    expiresAt: string | null;
    revokedAt: string | null;
    createdAt: string;
  }>;
  apiBaseUrl: string;
}

export const getIntegrationHubOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<IntegrationHubOverview> => {
    const tenantId = await requireTenantId(context.supabase as any, context.userId);
    const db = context.supabase as any;
    const [{ data: catalog, error: catalogError }, { data: accounts }, { data: tokens }] =
      await Promise.all([
        db
          .from("integration_catalog")
          .select("key,category_key,category_label,name,description,status,sort_order")
          .eq("is_active", true)
          .order("sort_order", { ascending: true }),
        db
          .from("integration_accounts")
          .select("provider_key,status,account_label,connected_at,last_sync_at,last_error")
          .eq("user_id", context.userId),
        db
          .from("user_api_tokens")
          .select("id,name,token_prefix,last_used_at,expires_at,revoked_at,created_at")
          .eq("user_id", context.userId)
          .order("created_at", { ascending: false }),
      ]);
    if (catalogError) throw new Error(catalogError.message);
    const { getGoogleWorkspaceSummary } = await import("@/lib/google-workspace.server");
    const google = await getGoogleWorkspaceSummary(tenantId, context.userId);
    const { platformBaseUrl } = await import("@/lib/platform-parameters.server");

    return {
      catalog: (catalog ?? []).map((item: any) => ({
        key: String(item.key),
        categoryKey: String(item.category_key),
        categoryLabel: String(item.category_label),
        name: String(item.name),
        description: String(item.description || ""),
        status: String(item.status),
        sortOrder: Number(item.sort_order || 0),
      })),
      accounts: (accounts ?? []).map((item: any) => ({
        providerKey: String(item.provider_key),
        status: String(item.status),
        accountLabel: item.account_label ? String(item.account_label) : null,
        connectedAt: item.connected_at ? String(item.connected_at) : null,
        lastSyncAt: item.last_sync_at ? String(item.last_sync_at) : null,
        lastError: item.last_error ? String(item.last_error) : null,
      })),
      google: {
        configured: google.configured,
        connected: google.connected,
        email: google.email,
        connectedAt: google.connectedAt,
      },
      apiTokens: (tokens ?? []).map((item: any) => ({
        id: String(item.id),
        name: String(item.name),
        prefix: String(item.token_prefix),
        lastUsedAt: item.last_used_at ? String(item.last_used_at) : null,
        expiresAt: item.expires_at ? String(item.expires_at) : null,
        revokedAt: item.revoked_at ? String(item.revoked_at) : null,
        createdAt: String(item.created_at),
      })),
      apiBaseUrl: `${platformBaseUrl()}/api/v1`,
    };
  });

export const getGoogleConnectUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase as any, context.userId);
    const { getGoogleOAuthUrl } = await import("@/lib/google-workspace.server");
    const url = getGoogleOAuthUrl({ tenantId, userId: context.userId });
    if (!url) throw new Error("Google OAuth ainda não possui GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor.");
    return { url };
  });

export const disconnectGoogle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase as any, context.userId);
    const { disconnectGoogleWorkspace } = await import("@/lib/google-workspace.server");
    await disconnectGoogleWorkspace(tenantId, context.userId);
    return { success: true };
  });

export const backupToGoogleDriveNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase as any, context.userId);
    const { backupCrmSnapshotToDrive } = await import("@/lib/google-workspace.server");
    const result = await backupCrmSnapshotToDrive(tenantId, context.userId);
    return {
      success: true,
      fileId: String(result["id"] || ""),
      name: String(result["name"] || "Backup MercadoImobi"),
      webViewLink: typeof result["webViewLink"] === "string" ? result["webViewLink"] : null,
    };
  });

export const createMyApiToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => tokenCreateSchema.parse(data))
  .handler(async ({ context, data }) => {
    const tenantId = await requireTenantId(context.supabase as any, context.userId);
    const { createHash, randomBytes } = await import("node:crypto");
    const secretPart = randomBytes(32).toString("base64url");
    const token = `mi_live_${secretPart}`;
    const hash = createHash("sha256").update(token).digest("hex");
    const prefix = token.slice(0, 18);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await (supabaseAdmin as any)
      .from("user_api_tokens")
      .insert({
        tenant_id: tenantId,
        user_id: context.userId,
        name: data.name,
        token_prefix: prefix,
        token_hash: hash,
      })
      .select("id,name,token_prefix,created_at")
      .single();
    if (error) throw new Error(error.message);
    return {
      token,
      id: String(row.id),
      name: String(row.name),
      prefix: String(row.token_prefix),
      createdAt: String(row.created_at),
      warning: "Este token é exibido uma única vez. Guarde-o em local seguro.",
    };
  });

export const revokeMyApiToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => tokenIdSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any)
      .from("user_api_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.tokenId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });
