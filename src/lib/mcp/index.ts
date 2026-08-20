import { auth, defineMcp } from "@lovable.dev/mcp-js";
import searchPropertiesTool from "./tools/search-properties";
import { PUBLIC_SUPABASE_PROJECT_ID } from "@/integrations/supabase/public-config";

const projectRef = PUBLIC_SUPABASE_PROJECT_ID;

export default defineMcp({
  name: "mercadoimobi",
  title: "MercadoImobi",
  version: "1.0.0",
  instructions:
    "Ferramentas do MercadoImobi para pesquisa imobiliária. Use `search_properties` para localizar imóveis reais indexados e retornar a fonte original do anúncio. Não crie, liste ou gerencie leads.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [searchPropertiesTool],
});
