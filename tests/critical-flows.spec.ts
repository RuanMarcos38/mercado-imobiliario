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

  it("has the requested corporate sidebar and separate operational areas", () => {
    const layout = source("src/routes/_authenticated.tsx");

    expect(layout).toContain('to: "/dashboard"');
    expect(layout).toContain('to: "/leiloes"');
    expect(layout).toContain('to: "/alertas"');
    expect(layout).toContain('to: "/atendimento"');
    expect(layout).toContain('to: "/fluxos"');
    expect(layout).toContain('to: "/assistente"');
    expect(layout).toContain('to: "/integracoes"');
    expect(layout).toContain("Sair");
  });

  it("separates CAIXA opportunities and real auction classification", () => {
    const search = source("src/lib/property-search.functions.ts");
    const workspace = source("src/components/property/PropertyWorkspace.tsx");
    const refresh = source("supabase/migrations/20260816033000_caixa_market_refresh.sql");

    expect(search).toContain('market: z.enum(["all", "market", "caixa", "auction"])');
    expect(search).toContain('input.market === "auction"');
    expect(workspace).toContain("Leilões CAIXA");
    expect(workspace).toContain("Modalidade:");
    expect(refresh).toContain("listing_market='caixa'");
    expect(refresh).toContain("like '%leil%'");
  });

  it("routes a public WhatsApp contact into the internal Atendimento", () => {
    const workspace = source("src/components/property/PropertyWorkspace.tsx");
    const atendimento = source("src/routes/_authenticated/atendimento.tsx");

    expect(workspace).toContain("contact_whatsapp");
    expect(workspace).toContain("mercadoimobi:selectedConversation");
    expect(workspace).toContain('navigate({ to: "/atendimento" })');
    expect(atendimento).toContain("mercadoimobi:selectedConversation");
    expect(atendimento).toContain("Sugerir resposta com IA");
  });

  it("supports alerting, authorized imports and listing removal events", () => {
    const alerts = source("src/lib/property-alerts.functions.ts");
    const importHook = source("src/routes/api/public/hooks/properties.tsx");
    const discovery = source("src/lib/property-discovery.server.ts");

    expect(alerts).toContain("property_alert_rules");
    expect(alerts).toContain("property_alert_events");
    expect(importHook).toContain("removed_urls");
    expect(importHook).toContain('.delete()');
    expect(importHook).toContain("PROPERTY_IMPORT_WEBHOOK_SECRET");
    expect(discovery).toContain("web_search");
    expect(discovery).not.toMatch(/captcha|playwright|puppeteer/i);
  });

  it("keeps AI and WhatsApp secrets server-side", () => {
    const envExample = source(".env.example");
    const assistant = source("src/lib/ai-assistant.functions.ts");
    const autoReply = source("src/lib/whatsapp-auto-reply.server.ts");

    expect(envExample).toContain("OPENAI_API_KEY=");
    expect(envExample).toContain("EVOLUTION_API_KEY=");
    expect(envExample).not.toContain("VITE_OPENAI_API_KEY");
    expect(envExample).not.toContain("VITE_EVOLUTION_API_KEY");
    expect(assistant).toContain('process.env["OPENAI_API_KEY"]');
    expect(autoReply).toContain('process.env["EVOLUTION_API_KEY"]');
  });
});
