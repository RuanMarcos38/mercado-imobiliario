import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantId } from "@/lib/tenant.server";
import {
  readIntegrationSecret,
  writeIntegrationSecret,
} from "@/lib/integration-secrets.server";

const N8N_SECRET_NAME = "n8n-workflow-api";
const N8N_REQUEST_TIMEOUT_MS = 20_000;
const MAX_JSON_CHARS = 1_500_000;

const stepTypeSchema = z.enum(["message", "wait", "ai", "handoff", "webhook", "tag"]);
const triggerTypeSchema = z.enum([
  "manual",
  "new_conversation",
  "keyword",
  "new_property_alert",
  "webhook",
]);

const mercadoFlowSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  triggerType: triggerTypeSchema,
  triggerValue: z.string().trim().max(200).optional(),
  enabled: z.boolean().optional().default(false),
  steps: z
    .array(
      z.object({
        type: stepTypeSchema,
        config: z.record(z.string(), z.unknown()).optional().default({}),
      }),
    )
    .min(1)
    .max(100),
});

const n8nWorkflowSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    nodes: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
    connections: z.record(z.string(), z.unknown()).default({}),
    settings: z.record(z.string(), z.unknown()).optional().default({}),
    staticData: z.unknown().optional(),
  })
  .passthrough();

const packageSchema = z.object({
  schemaVersion: z.number().int().min(1).max(1).optional().default(1),
  flow: mercadoFlowSchema.optional(),
  n8nWorkflow: n8nWorkflowSchema.optional(),
});

const connectionSchema = z.object({
  baseUrl: z.string().trim().min(1).max(500),
  apiKey: z.string().max(12000).optional(),
});

const importSchema = z.object({
  json: z.string().min(2).max(MAX_JSON_CHARS),
  publishToN8n: z.boolean().default(false),
  activateN8n: z.boolean().default(false),
});

type N8nSecret = {
  baseUrl: string;
  apiKey: string;
};

type ParsedImport = {
  kind: "mercadoimobi" | "n8n" | "package";
  flow: z.infer<typeof mercadoFlowSchema> | null;
  n8nWorkflow: z.infer<typeof n8nWorkflowSchema> | null;
};

function stripJsonWrapper(value: string) {
  let text = value.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  return text.trim();
}

export function parseWhatsAppFlowImport(value: string): ParsedImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonWrapper(value));
  } catch {
    throw new Error("JSON inválido. Gere novamente no ChatGPT ou revise vírgulas, aspas e chaves.");
  }

  const packageResult = packageSchema.safeParse(parsed);
  if (packageResult.success && (packageResult.data.flow || packageResult.data.n8nWorkflow)) {
    return {
      kind:
        packageResult.data.flow && packageResult.data.n8nWorkflow
          ? "package"
          : packageResult.data.flow
            ? "mercadoimobi"
            : "n8n",
      flow: packageResult.data.flow ?? null,
      n8nWorkflow: packageResult.data.n8nWorkflow ?? null,
    };
  }

  const flowResult = mercadoFlowSchema.safeParse(parsed);
  if (flowResult.success) {
    return { kind: "mercadoimobi", flow: flowResult.data, n8nWorkflow: null };
  }

  const n8nResult = n8nWorkflowSchema.safeParse(parsed);
  if (n8nResult.success) {
    return { kind: "n8n", flow: null, n8nWorkflow: n8nResult.data };
  }

  throw new Error(
    "Formato JSON não reconhecido. Use o modelo MercadoImobi/ChatGPT ou um workflow JSON exportado pelo n8n.",
  );
}

function normalizeN8nBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Informe uma URL válida da instância n8n.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("A URL do n8n deve usar HTTP ou HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Não inclua usuário ou senha dentro da URL do n8n.");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.startsWith("169.254.")
  ) {
    throw new Error("Use uma URL acessível pelo servidor MercadoImobi.");
  }
  url.pathname = url.pathname.replace(/\/api\/v1\/?$/i, "").replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function envN8nConfig(): N8nSecret | null {
  const baseUrl = process.env["N8N_API_URL"]?.trim();
  const apiKey = process.env["N8N_API_KEY"]?.trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl: normalizeN8nBaseUrl(baseUrl), apiKey };
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

async function requireIntegrationManager(db: any, tenantId: string, userId: string) {
  if (!(await canManageTenantIntegrations(db, tenantId, userId))) {
    throw new Error("Somente administradores podem configurar ou importar fluxos n8n.");
  }
}

async function savedN8nConfig(tenantId: string, userId: string) {
  const secret = await readIntegrationSecret<N8nSecret>(tenantId, userId, N8N_SECRET_NAME);
  if (secret?.baseUrl && secret.apiKey) {
    return {
      source: "user" as const,
      config: {
        baseUrl: normalizeN8nBaseUrl(secret.baseUrl),
        apiKey: secret.apiKey,
      },
    };
  }
  const env = envN8nConfig();
  return env
    ? { source: "server" as const, config: env }
    : { source: "not_configured" as const, config: null };
}

async function n8nRequest(
  config: N8nSecret,
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(`${config.baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-N8N-API-KEY": config.apiKey,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(N8N_REQUEST_TIMEOUT_MS),
  });

  const bodyText = await response.text();
  let body: Record<string, unknown> = {};
  if (bodyText) {
    try {
      body = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      body = { message: bodyText.slice(0, 500) };
    }
  }

  if (!response.ok) {
    const detail =
      typeof body["message"] === "string"
        ? String(body["message"])
        : typeof body["error"] === "string"
          ? String(body["error"])
          : `HTTP ${response.status}`;
    throw new Error(`n8n recusou a operação: ${detail}`);
  }
  return body;
}

async function testN8n(config: N8nSecret) {
  const result = await n8nRequest(config, "/workflows?limit=1", { method: "GET" });
  return {
    ok: true,
    workflowCount:
      Array.isArray(result["data"]) ? result["data"].length : Array.isArray(result["workflows"]) ? result["workflows"].length : 0,
  };
}

export function sanitizeN8nWorkflow(input: z.infer<typeof n8nWorkflowSchema>) {
  const safe: Record<string, unknown> = {
    name: input.name,
    nodes: input.nodes,
    connections: input.connections,
    settings: input.settings ?? {},
  };
  if (input.staticData !== undefined && input.staticData !== null) {
    safe["staticData"] = input.staticData;
  }
  return safe;
}

async function publishN8nWorkflow(
  config: N8nSecret,
  workflow: z.infer<typeof n8nWorkflowSchema>,
  activate: boolean,
) {
  const created = await n8nRequest(config, "/workflows", {
    method: "POST",
    body: JSON.stringify(sanitizeN8nWorkflow(workflow)),
  });
  const id = String(created["id"] ?? "");
  let active = Boolean(created["active"]);
  let warning: string | null = null;

  if (activate && id) {
    try {
      const activated = await n8nRequest(config, `/workflows/${encodeURIComponent(id)}/activate`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      active = activated["active"] === true || active;
    } catch (error) {
      warning =
        error instanceof Error
          ? `Workflow criado no n8n, mas não foi possível ativá-lo: ${error.message}`
          : "Workflow criado no n8n, mas não foi possível ativá-lo.";
    }
  }

  const hasCredentialReferences = workflow.nodes.some((node) => {
    const credentials = node["credentials"];
    return Boolean(credentials && typeof credentials === "object" && Object.keys(credentials).length);
  });

  if (hasCredentialReferences) {
    const credentialWarning =
      "O workflow contém referências a credenciais do n8n. Confirme no n8n se essas credenciais existem nesta instância.";
    warning = warning ? `${warning} ${credentialWarning}` : credentialWarning;
  }

  return { id: id || null, name: workflow.name, active, warning };
}

async function createLocalFlow(
  db: any,
  tenantId: string,
  userId: string,
  flow: z.infer<typeof mercadoFlowSchema>,
) {
  const { data: created, error } = await db
    .from("whatsapp_flows")
    .insert({
      tenant_id: tenantId,
      created_by: userId,
      name: flow.name,
      description: flow.description || null,
      trigger_type: flow.triggerType,
      trigger_value: flow.triggerValue || null,
      enabled: false,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const flowId = String(created.id);
  const rows = flow.steps.map((step, index) => ({
    flow_id: flowId,
    position: index + 1,
    step_type: step.type,
    config: step.config,
  }));

  const { error: stepsError } = await db.from("whatsapp_flow_steps").insert(rows);
  if (stepsError) {
    await db.from("whatsapp_flows").delete().eq("id", flowId).eq("tenant_id", tenantId);
    throw new Error(stepsError.message);
  }
  return flowId;
}

export const getN8nWorkflowSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    await requireIntegrationManager(db, tenantId, context.userId);
    const resolved = await savedN8nConfig(tenantId, context.userId);
    return {
      configured: Boolean(resolved.config),
      source: resolved.source,
      baseUrl: resolved.config?.baseUrl ?? "",
      hasApiKey: Boolean(resolved.config?.apiKey),
    };
  });

export const saveN8nWorkflowSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => connectionSchema.parse(data))
  .handler(async ({ context, data }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    await requireIntegrationManager(db, tenantId, context.userId);

    const current = await savedN8nConfig(tenantId, context.userId);
    const apiKey = data.apiKey?.trim() || current.config?.apiKey;
    if (!apiKey) throw new Error("Informe a API Key do n8n.");

    const config: N8nSecret = {
      baseUrl: normalizeN8nBaseUrl(data.baseUrl),
      apiKey,
    };
    await testN8n(config);
    await writeIntegrationSecret(tenantId, context.userId, N8N_SECRET_NAME, config);
    return {
      success: true,
      configured: true,
      baseUrl: config.baseUrl,
      hasApiKey: true,
    };
  });

export const testN8nWorkflowConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    await requireIntegrationManager(db, tenantId, context.userId);
    const resolved = await savedN8nConfig(tenantId, context.userId);
    if (!resolved.config) throw new Error("Configure a URL e a API Key do n8n primeiro.");
    const result = await testN8n(resolved.config);
    return {
      success: true,
      source: resolved.source,
      baseUrl: resolved.config.baseUrl,
      workflowCount: result.workflowCount,
    };
  });

export const previewWhatsAppFlowJson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ json: z.string().min(2).max(MAX_JSON_CHARS) }).parse(data))
  .handler(async ({ context, data }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    await requireIntegrationManager(db, tenantId, context.userId);
    const parsed = parseWhatsAppFlowImport(data.json);
    return {
      valid: true,
      kind: parsed.kind,
      flowName: parsed.flow?.name ?? null,
      flowSteps: parsed.flow?.steps.length ?? 0,
      n8nWorkflowName: parsed.n8nWorkflow?.name ?? null,
      n8nNodes: parsed.n8nWorkflow?.nodes.length ?? 0,
      hasLocalFlow: Boolean(parsed.flow),
      hasN8nWorkflow: Boolean(parsed.n8nWorkflow),
    };
  });

export const importWhatsAppFlowJson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => importSchema.parse(data))
  .handler(async ({ context, data }) => {
    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    await requireIntegrationManager(db, tenantId, context.userId);

    const parsed = parseWhatsAppFlowImport(data.json);
    if (!parsed.flow && !data.publishToN8n) {
      throw new Error("Este JSON é um workflow nativo do n8n. Marque a opção de publicar no n8n.");
    }
    if (data.publishToN8n && !parsed.n8nWorkflow) {
      throw new Error(
        "O JSON não contém n8nWorkflow. Gere um pacote completo no ChatGPT ou importe um JSON nativo do n8n.",
      );
    }

    let localFlowId: string | null = null;
    if (parsed.flow) {
      localFlowId = await createLocalFlow(db, tenantId, context.userId, parsed.flow);
    }

    let n8n: { id: string | null; name: string; active: boolean; warning: string | null } | null = null;
    let warning: string | null = null;

    if (data.publishToN8n && parsed.n8nWorkflow) {
      try {
        const resolved = await savedN8nConfig(tenantId, context.userId);
        if (!resolved.config) {
          throw new Error("Configure a integração n8n nesta tela antes de publicar o workflow.");
        }
        n8n = await publishN8nWorkflow(resolved.config, parsed.n8nWorkflow, data.activateN8n);
        warning = n8n.warning;
      } catch (error) {
        if (!localFlowId) throw error;
        warning =
          error instanceof Error
            ? `Fluxo salvo no MercadoImobi, mas o envio ao n8n falhou: ${error.message}`
            : "Fluxo salvo no MercadoImobi, mas o envio ao n8n falhou.";
      }
    }

    return {
      success: true,
      localFlowId,
      localFlowName: parsed.flow?.name ?? null,
      localFlowEnabled: false,
      n8n,
      warning,
    };
  });
