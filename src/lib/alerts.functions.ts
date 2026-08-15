import { createServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";

/**
 * Envia um alerta para o Slack via Webhook.
 * O Webhook URL deve ser configurado como segredo SLACK_WEBHOOK_URL.
 */
export const sendSlackAlert = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        message: z.string(),
        type: z.enum(["security", "system", "info"]).default("info"),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    // Record alert in security_alerts table first
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user) {
      await supabase.from("security_alerts").insert({
        user_id: session.user.id,
        title: data.type === "security" ? "Alerta Crítico" : "Notificação de Sistema",
        severity: data.type === "security" ? "high" : "info",
        message: data.message,
      });
    }

    const webhookUrl = process.env["SLACK_WEBHOOK_URL"];
    if (!webhookUrl) {
      console.warn("SLACK_WEBHOOK_URL não configurado. Alerta não enviado:", data.message);
      return { success: false, error: "Slack not configured" };
    }

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `*[${data.type.toUpperCase()}] Alerta MercadoImobi*\n${data.message}`,
          icon_emoji: data.type === "security" ? ":shield:" : ":bell:",
        }),
      });

      if (!response.ok) throw new Error(`Slack API error: ${response.statusText}`);

      return { success: true };
    } catch (err: any) {
      console.error("Falha ao enviar para o Slack:", err);
      return { success: false, error: err.message };
    }
  });

/**
 * E-mail de alerta. Nenhum provedor é simulado: sem integração configurada,
 * a função falha explicitamente para que a UI mostre o estado real.
 */
export const sendEmailAlert = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        to: z.string().email(),
        subject: z.string(),
        body: z.string(),
      })
      .parse(data),
  )
  .handler(async () => {
    throw new Error("Provedor de e-mail não configurado neste ambiente.");
  });

/**
 * Obtém logs de auditoria com filtros avançados.
 */
export const getFilteredAuditLogs = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z
      .object({
        userId: z.string().optional(),
        eventType: z.string().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    let query = supabase
      .from("auth_audit_log")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (data.userId) {
      query = query.eq("user_id", data.userId);
    }

    if (data.eventType) {
      query = query.eq("event_type", data.eventType);
    }

    const { data: logs, error, count } = await query;

    if (error) throw new Error(error.message);
    return { logs, count };
  });

/**
 * Gera relatório de retenção.
 */
export const generateRetentionReport = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ days: z.number().default(30) }).parse(data))
  .handler(async ({ data }) => {
    const { data: report, error } = await supabase.rpc("generate_retention_report", {
      _days: data.days,
    });
    if (error) throw new Error(error.message);
    return JSON.parse(report as string);
  });
