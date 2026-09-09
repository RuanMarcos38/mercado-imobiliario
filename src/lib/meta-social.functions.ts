import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";

const channelSchema = z.enum(["facebook", "instagram", "all"]);
const conversationSchema = z.object({
  pageId: z.string().min(1).max(100),
  conversationId: z.string().min(1).max(300),
  channel: z.enum(["facebook", "instagram"]),
});
const sendSchema = z.object({
  pageId: z.string().min(1).max(100),
  channel: z.enum(["facebook", "instagram"]),
  recipientId: z.string().min(1).max(180),
  text: z.string().trim().min(1).max(2000),
});

const META_AUTOMATION_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_manage_engagement",
  "pages_manage_metadata",
  "pages_messaging",
  "instagram_basic",
  "instagram_manage_messages",
  "instagram_manage_comments",
];

function connectUrlWithAutomationScopes(connectUrl: string | null) {
  if (!connectUrl) return null;
  try {
    const url = new URL(connectUrl);
    const scopes = new Set(
      String(url.searchParams.get("scope") ?? "")
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean),
    );
    for (const scope of META_AUTOMATION_SCOPES) scopes.add(scope);
    url.searchParams.set("scope", [...scopes].join(","));
    return url.toString();
  } catch {
    return connectUrl;
  }
}

export const getMetaSocialStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const { getMetaOAuthUrl, getMetaSocialConfig } = await import("@/lib/meta-social.server");
    const { metaSocialWebhookCallbackUrl } = await import("@/lib/meta-social-automation.server");
    const config = await getMetaSocialConfig(tenantId, context.userId);
    const connectUrl = connectUrlWithAutomationScopes(
      getMetaOAuthUrl({ tenantId, userId: context.userId }),
    );
    return {
      configured: Boolean(connectUrl),
      connected: Boolean(config?.pages.length),
      connectUrl,
      webhookCallbackUrl: metaSocialWebhookCallbackUrl(),
      connectedAt: config?.connectedAt ?? null,
      pages:
        config?.pages.map((page) => ({
          pageId: page.pageId,
          pageName: page.pageName,
          instagramUserId: page.instagramUserId,
          instagramUsername: page.instagramUsername,
        })) ?? [],
    };
  });

export const disconnectMetaSocialAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const { unregisterMetaSocialConnections } = await import(
      "@/lib/meta-social-automation.server"
    );
    const { disconnectMetaSocial } = await import("@/lib/meta-social.server");
    await unregisterMetaSocialConnections({ tenantId, userId: context.userId });
    await disconnectMetaSocial(tenantId, context.userId);
    return { success: true };
  });

export const listSocialConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ channel: channelSchema.default("all") }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const { listMetaSocialConversations } = await import("@/lib/meta-social.server");
    return listMetaSocialConversations({ tenantId, userId: context.userId, channel: data.channel });
  });

export const listSocialMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => conversationSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const { listMetaSocialMessages } = await import("@/lib/meta-social.server");
    return listMetaSocialMessages({ tenantId, userId: context.userId, ...data });
  });

export const sendSocialText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => sendSchema.parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const { sendMetaSocialText } = await import("@/lib/meta-social.server");
    const result = await sendMetaSocialText({ tenantId, userId: context.userId, ...data });
    return { success: true, result };
  });
