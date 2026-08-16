import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("MercadoImobi product invariants", () => {
  it("keeps the active search experience free of CRM lead actions", () => {
    const dashboard = source("src/routes/_authenticated/dashboard.tsx");
    const auth = source("src/routes/auth.tsx");

    expect(dashboard).not.toMatch(/Exportar Leads|Leads Totais|pipeline|funil de vendas/i);
    expect(auth).not.toMatch(/gerenciar seus imóveis e leads|Entrar no Painel|7 dias grátis/i);
  });

  it("uses the real property index for the MCP property search", () => {
    const mcp = source("src/lib/mcp/index.ts");
    const tool = source("src/lib/mcp/tools/search-properties.ts");

    expect(mcp).toContain('title: "MercadoImobi"');
    expect(mcp).toContain("tools: [searchPropertiesTool]");
    expect(mcp).not.toMatch(/createLead|listLeads/i);
    expect(tool).toContain('.from("property_search_index")');
    expect(tool).not.toContain('.from("leads")');
  });

  it("does not expose fake health metrics", () => {
    const health = source("src/lib/health.functions.ts");

    expect(health).not.toContain('.from("leads")');
    expect(health).not.toContain("scanners_active: true");
    expect(health).toContain("search_index_health");
  });

  it("keeps Supabase service-role credentials out of browser configuration", () => {
    const publicConfig = source("src/integrations/supabase/public-config.ts");
    const client = source("src/integrations/supabase/client.ts");

    expect(publicConfig).not.toMatch(/service[_-]?role/i);
    expect(client).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
