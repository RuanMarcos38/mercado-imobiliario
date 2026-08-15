import { auth, defineMcp } from "@lovable.dev/mcp-js";
import searchPropertiesTool from "./tools/search-properties";
import listLeadsTool from "./tools/list-leads";
import createLeadTool from "./tools/create-lead";
const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";
export default defineMcp({
  name: "casa-conectada",
  title: "Casa Conectada",
  version: "0.1.0",
  instructions:
    "Ferramentas da plataforma imobiliária Casa Conectada. Use `search_properties` para encontrar imóveis no Brasil dentro do perfil do cliente, `list_leads` para consultar a carteira de leads do usuário e `create_lead` para registrar um novo lead qualificado. Todos os dados são isolados por usuário.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [searchPropertiesTool, listLeadsTool, createLeadTool],
});
