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
    const searchRoute = source("src/routes/_authenticated/buscar.tsx");

    expect(layout).toContain('to: "/dashboard"');
    expect(layout).toContain('to: "/buscar"');
    expect(layout).toContain('to: "/leiloes"');
    expect(layout).toContain('to: "/alertas"');
    expect(layout).toContain('to: "/atendimento"');
    expect(layout).toContain('to: "/fluxos"');
    expect(layout).toContain('to: "/assistente"');
    expect(layout).toContain('to: "/integracoes"');
    expect(layout).toContain("Sair");
    expect(searchRoute).toContain("PropertyWorkspace");
  });

  it("supports a legible light and dark SaaS theme", () => {
    const theme = source("src/mercadoimobi.css");
    const toggle = source("src/components/ThemeToggle.tsx");

    expect(theme).toContain("html.light-mode");
    expect(theme).toContain("html.dark-mode");
    expect(theme).toContain("--mi-text:");
    expect(theme).toContain("--mi-bg:");
    expect(theme).toContain("--mi-surface:");
    expect(toggle).toContain('choose("light")');
    expect(toggle).toContain('choose("dark")');
  });

  it("separates CAIXA opportunities and real auction classification", () => {
    const search = source("src/lib/property-search.functions.ts");
    const workspace = source("src/components/property/PropertyWorkspace.tsx");
    const refresh = source("supabase/migrations/20260816033000_caixa_market_refresh.sql");

    expect(search).toContain('market: z.enum(["all", "market", "caixa", "auction"])');
    expect(search).toContain('input.market === "auction"');
    expect(workspace).toContain("Leilões CAIXA");
    expect(workspace).toContain("Modalidade:");
    expect(workspace).toContain("Preço do imóvel");
    expect(workspace).toMatch(/nunca compõem\s+o\s+preço exibido do imóvel/);
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
    expect(importHook).toContain(".delete()");
    expect(importHook).toContain("PROPERTY_IMPORT_WEBHOOK_SECRET");
    expect(discovery).toContain("web_search");
    expect(discovery).not.toMatch(/playwright|puppeteer/i);
    expect(discovery).toContain(
      "Não tente contornar login, CAPTCHA, bloqueio, paywall ou área privada",
    );
  });

  it("keeps AI and WhatsApp secrets server-side", () => {
    const envExample = source(".env.example");
    const assistant = source("src/lib/ai-assistant.functions.ts");
    const evolutionSender = source("src/lib/evolution-text.server.ts");
    const evolutionConfig = source("src/lib/evolution-instance.server.ts");
    const metaWhatsApp = source("src/lib/meta-whatsapp.server.ts");

    expect(envExample).toContain("OPENAI_API_KEY=");
    expect(envExample).toContain("EVOLUTION_API_KEY=");
    expect(envExample).toContain("META_WHATSAPP_ACCESS_TOKEN=");
    expect(envExample).toContain("META_WHATSAPP_PHONE_NUMBER_ID=");
    expect(envExample).not.toContain("VITE_OPENAI_API_KEY");
    expect(envExample).not.toContain("VITE_EVOLUTION_API_KEY");
    expect(envExample).not.toContain("VITE_META_WHATSAPP_ACCESS_TOKEN");
    expect(envExample).not.toContain("VITE_META_WHATSAPP_PHONE_NUMBER_ID");
    expect(assistant).toContain('process.env["OPENAI_API_KEY"]');
    expect(evolutionSender).toContain("evolutionGatewayConfig");
    expect(evolutionConfig).toContain('"EVOLUTION_API_KEY"');
    expect(evolutionConfig).toContain('"AUTHENTICATION_API_KEY"');
    expect(metaWhatsApp).toContain("process.env[name]");
    expect(metaWhatsApp).toContain('"META_WHATSAPP_ACCESS_TOKEN"');
    expect(metaWhatsApp).toContain('"META_WHATSAPP_PHONE_NUMBER_ID"');
  });

  it("keeps the Lovable template visual primitives and paginates the full property base", () => {
    const workspace = source("src/components/property/PropertyWorkspace.tsx");
    const css = source("src/mercadoimobi.css");
    const search = source("src/lib/property-search.functions.ts");
    expect(workspace).toContain("max-w-6xl");
    expect(workspace).toContain("Urbanist");
    expect(workspace).toContain("Página {page}");
    expect(css).toContain("LOVABLE_EXACT_TEMPLATE_V2");
    expect(css).toContain("--gradient-results");
    expect(css).toContain("JetBrains Mono");
    expect(search).toContain("offset: z.number()");
    expect(search).toContain(".range(offset, offset + fetchLimit - 1)");
  });

  it("keeps property search coverage aligned with source refresh cadence", () => {
    const quality = source("src/lib/property-listing-quality.ts");
    const search = source("src/lib/property-search.functions.ts");
    const migration = source(
      "supabase/migrations/20260820113000_restore_property_search_coverage.sql",
    );

    expect(quality).toContain("90 * 24 * 60");
    expect(quality).toContain("ayoshii.com.br");
    expect(quality).toContain("canalpro.grupozap.com");
    expect(search).toContain("PROPERTY_FRESHNESS_SLA_MINUTES");
    expect(migration).toContain("interval '90 days'");
    expect(migration).not.toContain("interval '2 hours'");
    expect(migration).toContain("p_state text default null");
  });
});
