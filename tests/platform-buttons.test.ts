import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(path, "utf8");

describe("MercadoImobi platform controls", () => {
  it("keeps every main navigation destination wired", () => {
    const layout = source("src/routes/_authenticated.tsx");
    for (const route of [
      "/dashboard",
      "/buscar",
      "/leiloes",
      "/alertas",
      "/atendimento",
      "/fluxos",
      "/assistente",
      "/integracoes",
      "/settings/security",
    ]) {
      expect(layout).toContain(route);
    }
    expect(layout).toContain("signOut");
    expect(layout).toContain("runGlobalSearch");
  });

  it("wires all property workspace actions and full-base pagination", () => {
    const workspace = source("src/components/property/PropertyWorkspace.tsx");
    for (const label of [
      "Buscar imóveis",
      "Limpar filtros",
      "Salvar pesquisa",
      "Criar alerta",
      "Pesquisas salvas",
      "Favoritos",
      "Ver detalhes",
      "Comparar imóvel",
      "Abrir anúncio original",
      "Anterior",
      "Próxima",
    ]) {
      expect(workspace).toContain(label);
    }
    expect(workspace).toContain("setPage(1)");
    expect(workspace).toContain("sourcePortal");
    expect(workspace).toContain("Fonte");
    expect(workspace).toContain("discount_percent");
    expect(workspace).toContain("evaluation_value");
    expect(workspace).toContain("Economia:");
    expect(workspace).not.toContain("DashboardAtendimentoPanel");
  });

  it("keeps dashboard and search on all properties, while auctions remain separate", () => {
    expect(source("src/routes/_authenticated/dashboard.tsx")).toContain('initialMarket="all"');
    expect(source("src/routes/_authenticated/buscar.tsx")).toContain('initialMarket="all"');
    expect(source("src/routes/_authenticated/leiloes.tsx")).toContain('initialMarket="caixa"');
    const search = source("src/lib/property-search.functions.ts");
    expect(search).toContain('input.market === "all"');
    expect(search).toContain('order("listing_market", { ascending: false })');
  });

  it("keeps alert, flow, assistant and atendimento actions connected", () => {
    const alerts = source("src/routes/_authenticated/alertas.tsx");
    const flows = source("src/routes/_authenticated/fluxos.tsx");
    const assistant = source("src/routes/_authenticated/assistente.tsx");
    const atendimento = source("src/routes/_authenticated/atendimento.tsx");
    expect(alerts).toContain("Criar alerta");
    expect(alerts).toContain("markReadFn");
    expect(flows).toContain("Criar fluxo");
    expect(flows).toContain("addStepFn");
    expect(assistant).toContain("Salvar configuração");
    expect(assistant).toContain("Testar resposta");
    expect(atendimento).toContain("Nova conversa");
    expect(atendimento).toContain("Sugerir resposta com IA");
    expect(atendimento).toContain("sendFn");
  });

  it("keeps internal pages on the shared theme system instead of the old fixed dark shell", () => {
    for (const path of [
      "src/routes/_authenticated/alertas.tsx",
      "src/routes/_authenticated/assistente.tsx",
      "src/routes/_authenticated/fluxos.tsx",
      "src/routes/_authenticated/integracoes.tsx",
      "src/routes/_authenticated/settings/security.tsx",
    ]) {
      const file = source(path);
      expect(file).not.toContain("bg-[#06101c]");
      expect(file).not.toContain("bg-[#07111f]");
      expect(file).toContain("var(--mi-");
    }
  });
});
