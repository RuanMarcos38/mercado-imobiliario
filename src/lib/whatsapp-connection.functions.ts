import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  evolutionGatewayConfig,
  evolutionRequest,
  generatedEvolutionInstanceName,
  getTenantEvolutionInstance,
  type EvolutionGatewayConfig,
} from "@/lib/evolution-instance.server";
import {
  getMetaWhatsAppBusinessProfile,
  getMetaWhatsAppCommerceSettings,
  metaWhatsAppConfigFromStored,
  metaWhatsAppInstanceName,
  metaWhatsAppWebhookCallbackUrl,
  testMetaWhatsAppConfig,
  updateMetaWhatsAppBusinessProfile,
  updateMetaWhatsAppCommerceSettings,
  writeStoredMetaWhatsAppConfig,
  type MetaWhatsAppConfig,
} from "@/lib/meta-whatsapp.server";
import { requireTenantId } from "@/lib/tenant.server";
import {
  ensureMetaWhatsAppConnection,
  getTenantWhatsAppConnection,
  shouldUseMetaWhatsApp,
  tenantMetaWhatsAppConfig,
  testTenantWhatsAppRuntime,
} from "@/lib/whatsapp-provider.server";

type EvolutionState = "connected" | "connecting" | "disconnected" | "error";

type QrPayload = {
  base64: string | null;
  code: string | null;
  pairingCode: string | null;
  count: number;
};

const DEFAULT_MERCADOIMOBI_URL = "https://r2rmarketingdigital-mercadomobi.ke4n49.easypanel.host";

const metaOfficialSettingsSchema = z.object({
  accessToken: z.string().max(12000).optional(),
  phoneNumberId: z.string().trim().min(4).max(80),
  businessAccountId: z.string().trim().max(80).optional(),
  displayPhoneNumber: z.string().trim().max(40).optional(),
  graphVersion: z.string().trim().max(12).optional(),
});

const metaBusinessProfileSchema = z
  .object({
    about: z.string().max(139).optional(),
    address: z.string().max(256).optional(),
    description: z.string().max(256).optional(),
    email: z.string().max(128).optional(),
    websites: z.array(z.string().max(256)).max(2).optional(),
    vertical: z
      .enum([
        "UNDEFINED",
        "OTHER",
        "AUTO",
        "BEAUTY",
        "APPAREL",
        "EDU",
        "ENTERTAIN",
        "EVENT_PLAN",
        "FINANCE",
        "GROCERY",
        "GOVT",
        "HOTEL",
        "HEALTH",
        "NONPROFIT",
        "PROF_SERVICES",
        "RETAIL",
        "TRAVEL",
        "RESTAURANT",
        "NOT_A_BIZ",
      ])
      .optional(),
    profilePictureBase64: z.string().max(8_000_000).optional(),
    profilePictureMimeType: z.enum(["image/jpeg", "image/png"]).optional(),
    profilePictureFileName: z.string().max(180).optional(),
    isCatalogVisible: z.boolean().optional(),
    isCartEnabled: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.profilePictureBase64 &&
      (!data.profilePictureMimeType || !data.profilePictureFileName)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "A foto de perfil precisa incluir nome e tipo do arquivo.",
        path: ["profilePictureBase64"],
      });
    }
  });

type MetaWhatsAppSettingsSource = "platform" | "server_env" | "not_configured";

function optionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function graphVersionValue(value: string | null | undefined, fallback?: string) {
  const raw = value?.trim() || fallback || "v26.0";
  const normalized = raw.startsWith("v") ? raw : `v${raw}`;
  return /^v\d+\.\d+$/.test(normalized) ? normalized : "v26.0";
}

async function canManageTenantIntegrations(db: any, tenantId: string, userId: string) {
  const [{ data: platformRole }, { data: member }] = await Promise.all([
    db.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
    db
      .from("tenant_members")
      .select("member_role")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  const memberRole = String(member?.member_role ?? "").toLowerCase();
  return Boolean(
    platformRole ||
    memberRole === "owner" ||
    memberRole === "admin" ||
    memberRole === "administrator",
  );
}

async function requireTenantIntegrationManager(db: any, tenantId: string, userId: string) {
  if (!(await canManageTenantIntegrations(db, tenantId, userId))) {
    throw new Error("Somente administradores podem configurar integrações oficiais.");
  }
}

function publicMetaSettings(input: {
  configured: boolean;
  connected: boolean;
  source: MetaWhatsAppSettingsSource;
  config: MetaWhatsAppConfig | null;
  hasToken: boolean;
  detail: string;
  metadataValidated?: boolean;
  verifiedName?: string | null;
  qualityRating?: string | null;
  businessAccountMatched?: boolean | null;
}) {
  return {
    configured: input.configured,
    connected: input.connected,
    source: input.source,
    hasToken: input.hasToken,
    phoneNumberId: input.config?.phoneNumberId ?? null,
    businessAccountId: input.config?.businessAccountId ?? null,
    displayPhoneNumber: input.config?.displayPhoneNumber ?? null,
    graphVersion: input.config?.graphVersion ?? "v26.0",
    callbackUrl: input.config?.callbackUrl ?? metaWhatsAppWebhookCallbackUrl(),
    detail: input.detail,
    metadataValidated: Boolean(input.metadataValidated),
    verifiedName: input.verifiedName ?? null,
    qualityRating: input.qualityRating ?? null,
    businessAccountMatched: input.businessAccountMatched ?? null,
  };
}

function normalizeState(payload: unknown): EvolutionState {
  if (!payload || typeof payload !== "object") return "error";
  const object = payload as Record<string, unknown>;
  const instance =
    object["instance"] && typeof object["instance"] === "object"
      ? (object["instance"] as Record<string, unknown>)
      : object;
  const raw = String(instance["state"] ?? instance["status"] ?? "").toLowerCase();
  if (["open", "connected", "online"].includes(raw)) return "connected";
  if (["connecting", "qrcode", "qr", "pairing"].includes(raw)) return "connecting";
  if (["close", "closed", "disconnected", "offline"].includes(raw)) return "disconnected";
  return "error";
}

function extractQr(payload: unknown): QrPayload {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const nested =
    root["qrcode"] && typeof root["qrcode"] === "object"
      ? (root["qrcode"] as Record<string, unknown>)
      : root;
  const base64 = typeof nested["base64"] === "string" && nested["base64"] ? nested["base64"] : null;
  const code = typeof nested["code"] === "string" && nested["code"] ? nested["code"] : null;
  const pairingCode =
    typeof nested["pairingCode"] === "string" && nested["pairingCode"]
      ? nested["pairingCode"]
      : null;
  const count = Number(nested["count"] ?? 0);
  return { base64, code, pairingCode, count: Number.isFinite(count) ? count : 0 };
}

function webhookUrl(): string {
  const explicit = process.env["WHATSAPP_WEBHOOK_URL"]?.trim();
  if (explicit) return explicit;
  const appBaseUrl =
    process.env["MERCADOIMOBI_BASE_URL"]?.trim().replace(/\/$/, "") ||
    process.env["EASYPANEL_PUBLIC_URL"]?.trim().replace(/\/$/, "") ||
    process.env["APP_URL"]?.trim().replace(/\/$/, "") ||
    DEFAULT_MERCADOIMOBI_URL;
  return `${appBaseUrl}/api/public/hooks/whatsapp`;
}

async function configureWebhook(config: EvolutionGatewayConfig, instance: string) {
  const url = webhookUrl();
  const secret = process.env["WHATSAPP_WEBHOOK_SECRET"]?.trim();
  const response = await evolutionRequest(config, `/webhook/set/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url,
        headers: secret ? { "x-webhook-secret": secret } : {},
        byEvents: false,
        base64: false,
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
      },
    }),
  });

  if (!response.ok) {
    return {
      configured: false,
      url,
      warning: `EVOLUTION_WEBHOOK_HTTP_${response.status}` as string | null,
    };
  }
  return { configured: true, url, warning: null as string | null };
}

async function isPlatformAdmin(db: any, userId: string) {
  const { data } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return Boolean(data);
}

async function ensureTenantInstance(input: {
  db: any;
  tenantId: string;
  userId: string;
  config: EvolutionGatewayConfig;
}) {
  const saved = await getTenantEvolutionInstance(input.db, input.tenantId);
  if (saved) return { instance: saved, created: false, qr: null as QrPayload | null };

  // Preserve the original administrator's already-connected legacy instance when present,
  // while all subscriber tenants receive their own dedicated Evolution instance.
  const legacyInstance = process.env["EVOLUTION_INSTANCE"]?.trim();
  const instance =
    legacyInstance && (await isPlatformAdmin(input.db, input.userId))
      ? legacyInstance
      : generatedEvolutionInstanceName(input.tenantId);

  let created = false;
  let qr: QrPayload | null = null;
  const stateResponse = await evolutionRequest(
    input.config,
    `/instance/connectionState/${encodeURIComponent(instance)}`,
    { method: "GET" },
  );

  if (stateResponse.status === 401 || stateResponse.status === 403) {
    throw new Error("EVOLUTION_API_AUTH_FAILED");
  }

  if (stateResponse.status === 404) {
    const response = await evolutionRequest(input.config, "/instance/create", {
      method: "POST",
      body: JSON.stringify({
        instanceName: instance,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
      }),
    });
    if (response.status === 401 || response.status === 403)
      throw new Error("EVOLUTION_API_AUTH_FAILED");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        payload && typeof payload === "object"
          ? String((payload as Record<string, unknown>)["message"] ?? "")
          : "";
      throw new Error(
        `EVOLUTION_INSTANCE_CREATE_FAILED:${response.status}:${message.slice(0, 180)}`,
      );
    }
    created = true;
    qr = extractQr(payload);
  } else if (!stateResponse.ok) {
    throw new Error(`EVOLUTION_API_HTTP_${stateResponse.status}`);
  }

  const now = new Date().toISOString();
  const { error } = await input.db.from("whatsapp_connections").upsert(
    {
      tenant_id: input.tenantId,
      owner_user_id: input.userId,
      instance_name: instance,
      display_name: "Meu WhatsApp",
      status: "connecting",
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );
  if (error) throw new Error(error.message);

  return { instance, created, qr };
}

export const getMetaWhatsAppOfficialSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const savedConnection = await getTenantWhatsAppConnection(db, tenantId);
    const config = await tenantMetaWhatsAppConfig({
      tenantId,
      userId: context.userId,
      connection: savedConnection,
    });

    if (!config) {
      return publicMetaSettings({
        configured: false,
        connected: false,
        source: "not_configured",
        config: null,
        hasToken: false,
        detail: "WhatsApp API Oficial da Meta ainda não configurada nesta organização.",
      });
    }

    const source =
      savedConnection?.provider === "meta" && savedConnection.owner_user_id
        ? ("platform" as const)
        : ("server_env" as const);
    const result = await testMetaWhatsAppConfig(config);
    const liveDisplayPhone =
      result.ok && result.displayPhoneNumber
        ? result.displayPhoneNumber
        : config.displayPhoneNumber;
    const businessAccountMatched =
      "businessAccountMatched" in result ? result.businessAccountMatched : null;
    return publicMetaSettings({
      configured: true,
      connected: result.ok,
      source,
      config: { ...config, displayPhoneNumber: liveDisplayPhone },
      hasToken: true,
      detail: result.ok
        ? businessAccountMatched === true && config.businessAccountId
          ? `Phone Number ID ${config.phoneNumberId} validado na conta WhatsApp Business ${config.businessAccountId}.`
          : `Phone Number ID ${config.phoneNumberId} validado na Meta Cloud API.`
        : "error" in result
          ? String(result.error)
          : "A conexão oficial ainda não foi validada.",
      metadataValidated: result.metadataValidated,
      verifiedName: result.ok ? result.verifiedName : null,
      qualityRating: result.ok ? result.qualityRating : null,
      businessAccountMatched,
    });
  });

export const saveMetaWhatsAppOfficialSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => metaOfficialSettingsSchema.parse(data))
  .handler(async ({ context, data }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    await requireTenantIntegrationManager(db, tenantId, context.userId);

    const savedConnection = await getTenantWhatsAppConnection(db, tenantId);
    const previous = await tenantMetaWhatsAppConfig({
      tenantId,
      userId: context.userId,
      connection: savedConnection,
    });
    const accessToken = data.accessToken?.trim() || previous?.accessToken || "";
    if (!accessToken) {
      throw new Error("Informe o token permanente da WhatsApp Cloud API.");
    }

    const config = metaWhatsAppConfigFromStored({
      graphVersion: graphVersionValue(data.graphVersion, previous?.graphVersion),
      phoneNumberId: data.phoneNumberId,
      businessAccountId: optionalText(data.businessAccountId) ?? previous?.businessAccountId,
      accessToken,
      displayPhoneNumber: optionalText(data.displayPhoneNumber) ?? previous?.displayPhoneNumber,
    });
    if (!config) throw new Error("Configuração oficial da Meta incompleta.");

    const result = await testMetaWhatsAppConfig(config);
    if (!result.ok) {
      throw new Error(
        "error" in result
          ? `A Meta recusou a validação: ${String(result.error).slice(0, 220)}`
          : "A Meta recusou a validação da WhatsApp Cloud API.",
      );
    }

    const displayPhoneNumber = result.displayPhoneNumber || config.displayPhoneNumber;
    const savedConfig = { ...config, displayPhoneNumber };
    const businessAccountMatched =
      "businessAccountMatched" in result ? result.businessAccountMatched : null;
    await writeStoredMetaWhatsAppConfig(tenantId, context.userId, savedConfig);

    const now = new Date().toISOString();
    const { error } = await db.from("whatsapp_connections").upsert(
      {
        tenant_id: tenantId,
        owner_user_id: context.userId,
        instance_name: metaWhatsAppInstanceName(config.phoneNumberId),
        display_name: "WhatsApp Oficial Meta",
        phone_number: displayPhoneNumber,
        status: "connected",
        last_connected_at: now,
        provider: "meta",
        provider_phone_number_id: config.phoneNumberId,
        provider_business_account_id: config.businessAccountId,
        provider_metadata: {
          graphVersion: config.graphVersion,
          callbackUrl: config.callbackUrl,
          configuredBy: "platform-ui",
          metadataValidated: result.metadataValidated,
          verifiedName: result.verifiedName,
          qualityRating: result.qualityRating,
          businessAccountMatched,
          codeVerificationStatus:
            "codeVerificationStatus" in result ? result.codeVerificationStatus : null,
          platformType: "platformType" in result ? result.platformType : null,
          nameStatus: "nameStatus" in result ? result.nameStatus : null,
          phoneStatus: "phoneStatus" in result ? result.phoneStatus : null,
        },
        updated_at: now,
      },
      { onConflict: "tenant_id" },
    );
    if (error) throw new Error(error.message);

    return publicMetaSettings({
      configured: true,
      connected: true,
      source: "platform",
      config: savedConfig,
      hasToken: true,
      detail:
        businessAccountMatched === true && config.businessAccountId
          ? `Phone Number ID ${config.phoneNumberId} validado na conta WhatsApp Business ${config.businessAccountId}.`
          : `Phone Number ID ${config.phoneNumberId} validado na Meta Cloud API.`,
      metadataValidated: result.metadataValidated,
      verifiedName: result.verifiedName,
      qualityRating: result.qualityRating,
      businessAccountMatched,
    });
  });

export const getMetaWhatsAppBusinessProfileSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const savedConnection = await getTenantWhatsAppConnection(db, tenantId);
    const config = await tenantMetaWhatsAppConfig({
      tenantId,
      userId: context.userId,
      connection: savedConnection,
    });

    if (!config) {
      return {
        configured: false,
        profile: null,
        commerce: null,
        commerceAvailable: false,
        warning: null as string | null,
      };
    }

    const [profileResult, commerceResult] = await Promise.allSettled([
      getMetaWhatsAppBusinessProfile(config),
      getMetaWhatsAppCommerceSettings(config),
    ]);
    if (profileResult.status === "rejected") {
      throw new Error(
        profileResult.reason instanceof Error
          ? profileResult.reason.message
          : "Não foi possível carregar o perfil comercial do WhatsApp.",
      );
    }

    return {
      configured: true,
      profile: profileResult.value,
      commerce: commerceResult.status === "fulfilled" ? commerceResult.value : null,
      commerceAvailable: commerceResult.status === "fulfilled",
      warning:
        commerceResult.status === "rejected"
          ? commerceResult.reason instanceof Error
            ? commerceResult.reason.message
            : "Os controles de catálogo não estão disponíveis para este número."
          : null,
    };
  });

export const saveMetaWhatsAppBusinessProfileSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => metaBusinessProfileSchema.parse(data))
  .handler(async ({ context, data }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    await requireTenantIntegrationManager(db, tenantId, context.userId);

    const savedConnection = await getTenantWhatsAppConnection(db, tenantId);
    const config = await tenantMetaWhatsAppConfig({
      tenantId,
      userId: context.userId,
      connection: savedConnection,
    });
    if (!config) {
      throw new Error("Configure e valide a WhatsApp Cloud API antes de editar o perfil.");
    }

    const websites = data.websites
      ?.map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 2);
    const hasProfileUpdate =
      data.about !== undefined ||
      data.address !== undefined ||
      data.description !== undefined ||
      data.email !== undefined ||
      data.websites !== undefined ||
      data.vertical !== undefined ||
      Boolean(data.profilePictureBase64);

    let profile = await getMetaWhatsAppBusinessProfile(config);
    if (hasProfileUpdate) {
      profile = await updateMetaWhatsAppBusinessProfile({
        config,
        ...(data.about !== undefined ? { about: data.about.trim() } : {}),
        ...(data.address !== undefined ? { address: data.address.trim() } : {}),
        ...(data.description !== undefined ? { description: data.description.trim() } : {}),
        ...(data.email !== undefined ? { email: data.email.trim() } : {}),
        ...(websites !== undefined ? { websites } : {}),
        ...(data.vertical !== undefined ? { vertical: data.vertical } : {}),
        ...(data.profilePictureBase64 &&
        data.profilePictureMimeType &&
        data.profilePictureFileName
          ? {
              profilePicture: {
                base64: data.profilePictureBase64,
                mimeType: data.profilePictureMimeType,
                fileName: data.profilePictureFileName,
              },
            }
          : {}),
      });
    }

    let commerce = null;
    let warning: string | null = null;
    if (data.isCatalogVisible !== undefined && data.isCartEnabled !== undefined) {
      try {
        commerce = await updateMetaWhatsAppCommerceSettings({
          config,
          isCatalogVisible: data.isCatalogVisible,
          isCartEnabled: data.isCartEnabled,
        });
      } catch (error) {
        warning =
          error instanceof Error
            ? error.message
            : "A Meta não disponibilizou os controles de catálogo para este número.";
      }
    } else {
      try {
        commerce = await getMetaWhatsAppCommerceSettings(config);
      } catch (error) {
        warning =
          error instanceof Error
            ? error.message
            : "A Meta não disponibilizou os controles de catálogo para este número.";
      }
    }

    return {
      configured: true,
      profile,
      commerce,
      commerceAvailable: Boolean(commerce),
      warning,
    };
  });

export const prepareWhatsAppConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const savedConnection = await getTenantWhatsAppConnection(db, tenantId);

    if (shouldUseMetaWhatsApp(savedConnection)) {
      const officialConfig = await tenantMetaWhatsAppConfig({
        tenantId,
        userId: context.userId,
        connection: savedConnection,
      });
      if (!officialConfig) {
        return {
          configured: false,
          ready: false,
          connected: false,
          state: "disconnected" as EvolutionState,
          webhookConfigured: false,
          webhookUrl: null as string | null,
          warning: "META_WHATSAPP_ENV_MISSING" as string | null,
          provider: "meta" as const,
          instanceName: null as string | null,
          qrBase64: null as string | null,
          qrCode: null as string | null,
          pairingCode: null as string | null,
        };
      }

      await ensureMetaWhatsAppConnection({ db, tenantId, userId: context.userId });
      const runtime = await testTenantWhatsAppRuntime(db, tenantId);
      const refreshedConnection = await getTenantWhatsAppConnection(db, tenantId);
      const config =
        (await tenantMetaWhatsAppConfig({
          tenantId,
          userId: context.userId,
          connection: refreshedConnection ?? savedConnection,
        })) ?? officialConfig;
      return {
        configured: runtime.configured,
        ready: runtime.configured,
        connected: runtime.ok,
        state: runtime.state,
        webhookConfigured: Boolean(config?.callbackUrl),
        webhookUrl: config?.callbackUrl ?? null,
        warning: runtime.ok ? null : "META_WHATSAPP_CONNECTION_FAILED",
        provider: "meta" as const,
        instanceName: runtime.instanceName,
        qrBase64: null as string | null,
        qrCode: null as string | null,
        pairingCode: null as string | null,
      };
    }

    const config = evolutionGatewayConfig();
    if (!config) {
      return {
        configured: false,
        ready: false,
        connected: false,
        state: "disconnected" as EvolutionState,
        webhookConfigured: false,
        webhookUrl: null as string | null,
        warning: "EVOLUTION_ENV_MISSING" as string | null,
        provider: "evolution" as const,
        instanceName: null as string | null,
        qrBase64: null as string | null,
        qrCode: null as string | null,
        pairingCode: null as string | null,
      };
    }

    const ensured = await ensureTenantInstance({ db, tenantId, userId: context.userId, config });
    const webhook = await configureWebhook(config, ensured.instance);

    const stateResponse = await evolutionRequest(
      config,
      `/instance/connectionState/${encodeURIComponent(ensured.instance)}`,
      { method: "GET" },
    );
    if (stateResponse.status === 401 || stateResponse.status === 403) {
      throw new Error("EVOLUTION_API_AUTH_FAILED");
    }
    if (!stateResponse.ok && stateResponse.status !== 404) {
      throw new Error(`EVOLUTION_API_HTTP_${stateResponse.status}`);
    }

    const statePayload = await stateResponse.json().catch(() => ({}));
    const state = stateResponse.ok ? normalizeState(statePayload) : "disconnected";
    const now = new Date().toISOString();
    const status =
      state === "connected"
        ? "connected"
        : state === "connecting"
          ? "connecting"
          : state === "disconnected"
            ? "disconnected"
            : "error";

    const { error } = await db
      .from("whatsapp_connections")
      .update({
        status,
        last_connected_at: state === "connected" ? now : null,
        updated_at: now,
      })
      .eq("tenant_id", tenantId)
      .eq("instance_name", ensured.instance);
    if (error) throw new Error(error.message);

    return {
      configured: true,
      ready: true,
      connected: state === "connected",
      state,
      webhookConfigured: webhook.configured,
      webhookUrl: webhook.url,
      warning: webhook.warning,
      provider: "evolution" as const,
      instanceName: ensured.instance,
      qrBase64: ensured.qr?.base64 ?? null,
      qrCode: ensured.qr?.code ?? null,
      pairingCode: ensured.qr?.pairingCode ?? null,
    };
  });

export const disconnectWhatsAppConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const savedConnection = await getTenantWhatsAppConnection(db, tenantId);
    if (shouldUseMetaWhatsApp(savedConnection)) {
      if (savedConnection?.id) {
        const { error } = await db
          .from("whatsapp_connections")
          .update({
            status: "disconnected",
            last_connected_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", savedConnection.id)
          .eq("tenant_id", tenantId);
        if (error) throw new Error(error.message);
      }
      return { success: true, connected: false, state: "disconnected" as EvolutionState };
    }

    const config = evolutionGatewayConfig();
    if (!config) throw new Error("EVOLUTION_ENV_MISSING");

    const instance = await getTenantEvolutionInstance(db, tenantId);
    if (!instance) {
      return { success: true, connected: false, state: "disconnected" as EvolutionState };
    }

    let response = await evolutionRequest(
      config,
      `/instance/logout/${encodeURIComponent(instance)}`,
      { method: "DELETE" },
    );
    if (response.status === 405) {
      response = await evolutionRequest(
        config,
        `/instance/logout/${encodeURIComponent(instance)}`,
        { method: "POST" },
      );
    }
    if (!response.ok && response.status !== 404) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("EVOLUTION_API_AUTH_FAILED");
      }
      throw new Error(`EVOLUTION_LOGOUT_HTTP_${response.status}`);
    }

    const now = new Date().toISOString();
    const { error } = await db
      .from("whatsapp_connections")
      .update({ status: "disconnected", last_connected_at: null, updated_at: now })
      .eq("tenant_id", tenantId)
      .eq("instance_name", instance);
    if (error) throw new Error(error.message);

    return { success: true, connected: false, state: "disconnected" as EvolutionState };
  });
