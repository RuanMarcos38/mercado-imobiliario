import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "search_properties",
  title: "Buscar imóveis",
  description:
    "Busca imóveis reais indexados no MercadoImobi por localização, tipo, preço, quartos, banheiros, área e fonte.",
  inputSchema: {
    city: z.string().trim().min(1).optional().describe("Cidade do imóvel."),
    state: z.string().trim().length(2).optional().describe("UF do imóvel, ex: SC."),
    property_type: z.string().trim().min(1).optional().describe("Tipo do imóvel."),
    min_price: z.number().nonnegative().optional().describe("Preço mínimo em BRL."),
    max_price: z.number().nonnegative().optional().describe("Preço máximo em BRL."),
    bedrooms: z.number().int().min(0).optional().describe("Mínimo de quartos."),
    bathrooms: z.number().int().min(0).optional().describe("Mínimo de banheiros."),
    min_area: z.number().nonnegative().optional().describe("Área mínima em m²."),
    max_area: z.number().nonnegative().optional().describe("Área máxima em m²."),
    source_portal: z.string().trim().min(1).optional().describe("Fonte do anúncio."),
    verified_only: z.boolean().optional().describe("Retornar somente anúncios verificados."),
    limit: z.number().int().min(1).max(50).optional().describe("Máximo de resultados."),
  },
  outputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Autenticação necessária." }], isError: true };
    }

    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("property_search_index")
      .select(
        "id,title,description,price,location_address,location_city,location_state,property_type,bedrooms,bathrooms,area_sqm,is_verified,source_portal,source_url,scanned_at",
      )
      .order("scanned_at", { ascending: false })
      .limit(input.limit ?? 10);

    if (input.city) query = query.ilike("location_city", `%${input.city}%`);
    if (input.state) query = query.eq("location_state", input.state.toUpperCase());
    if (input.property_type) query = query.ilike("property_type", `%${input.property_type}%`);
    if (input.min_price !== undefined) query = query.gte("price", input.min_price);
    if (input.max_price !== undefined) query = query.lte("price", input.max_price);
    if (input.bedrooms !== undefined) query = query.gte("bedrooms", input.bedrooms);
    if (input.bathrooms !== undefined) query = query.gte("bathrooms", input.bathrooms);
    if (input.min_area !== undefined) query = query.gte("area_sqm", input.min_area);
    if (input.max_area !== undefined) query = query.lte("area_sqm", input.max_area);
    if (input.source_portal) query = query.eq("source_portal", input.source_portal);
    if (input.verified_only) query = query.eq("is_verified", true);

    const { data, error } = await query;
    if (error) {
      return {
        content: [{ type: "text", text: "Não foi possível concluir a busca agora." }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { properties: data ?? [], count: data?.length ?? 0 },
    };
  },
});
