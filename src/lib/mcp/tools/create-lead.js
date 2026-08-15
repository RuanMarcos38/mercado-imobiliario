import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireTenantId, supabaseForUser } from "../supabase";
export default defineTool({
  name: "create_lead",
  title: "Criar lead",
  description:
    "Cria um novo lead na carteira do usuário autenticado, com notas de qualificação opcionais.",
  inputSchema: {
    client_name: z.string().trim().min(1).describe("Nome do cliente."),
    client_email: z.string().trim().email().optional().describe("E-mail do cliente."),
    client_phone: z.string().trim().min(8).optional().describe("Telefone/WhatsApp do cliente."),
    interest_property_id: z.string().uuid().optional().describe("ID do imóvel de interesse."),
    status: z.string().trim().min(1).optional().describe("Status inicial do lead (padrão: novo)."),
    ai_qualification_notes: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Notas de qualificação do lead."),
  },
  outputSchema: {},
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const userId = ctx.getUserId();
    const tenantId = await requireTenantId(supabase, userId);
    const { data, error } = await supabase
      .from("leads")
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        client_name: input.client_name,
        client_email: input.client_email ?? null,
        client_phone: input.client_phone ?? null,
        interest_property_id: input.interest_property_id ?? null,
        status: input.status ?? "novo",
        ai_qualification_notes: input.ai_qualification_notes ?? null,
      })
      .select();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { lead: data?.[0] ?? null },
    };
  },
});
