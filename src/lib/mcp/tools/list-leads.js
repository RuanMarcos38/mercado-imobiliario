import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireTenantId, supabaseForUser } from "../supabase";
export default defineTool({
  name: "list_leads",
  title: "Listar leads",
  description: "Lista os leads do usuário autenticado, com filtro opcional por status do funil.",
  inputSchema: {
    status: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Status do lead, ex: novo, contato, negociacao, fechado."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Máximo de leads retornados (padrão 20)."),
  },
  outputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const tenantId = await requireTenantId(supabase, ctx.getUserId());
    let query = supabase
      .from("leads")
      .select(
        "id,client_name,client_email,client_phone,status,ai_qualification_notes,interest_property_id,created_at",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(input.limit ?? 20);
    if (input.status) query = query.eq("status", input.status);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { leads: data ?? [], count: data?.length ?? 0 },
    };
  },
});
