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
      "/crm",
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
    expect(workspace).not.toContain("Abrir anúncio original");
    expect(workspace).not.toContain("href={property.source_url}");
    expect(workspace).not.toContain("DashboardAtendimentoPanel");
  });

  it("keeps the real estate CRM visible while unrelated communication tools stay out", () => {
    const layout = source("src/routes/_authenticated.tsx");
    expect(layout).toContain('label: "CRM / Oportunidades"');
    expect(layout).not.toContain('label: "Facebook e Instagram"');
    expect(layout).not.toContain('label: "E-mail / CCA"');
    expect(layout).not.toContain('label: "Discador"');
    expect(layout).toContain('label: "Atendimento WhatsApp"');
    expect(layout).toContain('label: "Fluxos"');
    expect(layout).toContain('label: "Assistente IA"');
    expect(layout).toContain('label: "Diagnóstico"');
    expect(layout).toContain('label: "Fontes de imóveis"');
  });

  it("keeps dashboard and search on all properties, while auctions remain separate", () => {
    expect(source("src/routes/_authenticated/dashboard.tsx")).toContain('initialMarket="all"');
    expect(source("src/routes/_authenticated/buscar.tsx")).toContain('initialMarket="all"');
    expect(source("src/routes/_authenticated/leiloes.tsx")).toContain('initialMarket="auction"');

    const search = source("src/lib/property-search.functions.ts");
    expect(search).toContain('input.market === "market"');
    expect(search).toContain('input.market === "caixa"');
    expect(search).toContain('input.market === "auction"');
    expect(search).toContain('input.market === "all"');
    expect(search).toContain('order("listing_market", { ascending: false })');
    expect(search).toContain("const fetchLimit = Math.min(1000, Math.max(limit * 3, limit + 50));");
    expect(search).not.toContain("Math.min(60, Math.max(limit, limit * 2))");
  });

  it("highlights negotiations from verified discount and comparable value per square meter", () => {
    const workspace = source("src/components/property/PropertyWorkspace.tsx");
    expect(workspace).toContain("Melhor valor/m²");
    expect(workspace).toContain("comparableGroupKey");
    expect(workspace).toContain("comparablePricePerSqm");
    expect(workspace).toContain("median * 0.85");
    expect(workspace).toContain("discount_percent >= 10");
    expect(workspace).not.toContain(">Menor valor</Badge>");
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

it("keeps the CRM process enhancements visible without renaming the existing application structure", () => {
  const shell = source("src/components/crm/CrmWorkspaceShell.tsx");
  expect(shell).toContain('label: "Pipeline"');
  expect(shell).toContain('label: "Propostas"');
  expect(shell).toContain('label: "E-mails"');
  expect(shell).toContain('label: "Documentos"');
  expect(shell).toContain('label: "Assinaturas"');
  expect(shell).toContain('label: "Relatórios"');
  expect(shell).not.toContain("Kanban");
  const attendance = source("src/routes/_authenticated/atendimento.tsx");
  expect(attendance).toContain("AttendanceDistributionPanel");
  expect(attendance).toContain("protocol_code");
});
