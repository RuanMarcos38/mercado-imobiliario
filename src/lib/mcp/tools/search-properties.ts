import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { requireTenantId, supabaseForUser } from "../supabase";

export default defineTool({
  name: "search_properties",
  title: "Buscar imóveis",
  description:
    "Busca imóveis disponíveis no Brasil por cidade, estado, tipo, faixa de preço e verificação anti-fraude.",
  inputSchema: {
    city: z.string().trim().min(1).optional().describe("Cidade do imóvel."),
    state: z.string().trim().length(2).optional().describe("UF do imóvel, ex: SP."),
    property_type: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Tipo do imóvel, ex: apartamento, casa, terreno."),
    min_price: z.number().positive().optional().describe("Preço mínimo em BRL."),
    max_price: z.number().positive().optional().describe("Preço máximo em BRL."),
    bedrooms: z.number().int().min(0).optional().describe("Mínimo de quartos."),
    verified_only: z
      .boolean()
      .optional()
      .describe("Retornar apenas anúncios verificados pelo score anti-fraude."),
    limit: z.number().int().min(1).max(50).optional().describe("Máximo de resultados (padrão 10)."),
  },
  outputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const tenantId = await requireTenantId(supabase, ctx.getUserId()!);
    let query = supabase
      .from("properties")
      .select(
        "id,title,price,location_city,location_state,property_type,bedrooms,bathrooms,area_sqm,anti_fraud_score,is_verified,source_portal,source_url",
      )
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .order("anti_fraud_score", { ascending: false })
      .limit(input.limit ?? 10);

    if (input.city) query = query.ilike("location_city", `%${input.city}%`);
    if (input.state) query = query.ilike("location_state", input.state);
    if (input.property_type) query = query.ilike("property_type", `%${input.property_type}%`);
    if (input.min_price !== undefined) query = query.gte("price", input.min_price);
    if (input.max_price !== undefined) query = query.lte("price", input.max_price);
    if (input.bedrooms !== undefined) query = query.gte("bedrooms", input.bedrooms);
    if (input.verified_only) query = query.eq("is_verified", true);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { properties: data ?? [], count: data?.length ?? 0 },
    };
  },
});
