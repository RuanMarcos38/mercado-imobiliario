import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildProspectSearchPhrase, isBrazilNationalScope } from "@/lib/prospect-leads.functions";
import {
  dedupeAndRankProspectLeads,
  isNetworkUrl,
  PROSPECT_RADAR_INTERVAL_MINUTES,
  PROSPECT_REAL_SWEEP_RULES,
  sanitizeProspectLead,
  type ProspectLead,
} from "@/lib/prospect-leads.core";

function baseLead(overrides: Partial<ProspectLead> = {}): ProspectLead {
  return {
    id: "lead-1",
    displayName: "Perfil Exemplo",
    profileHandle: "@perfil",
    network: "instagram",
    profileUrl: "https://www.instagram.com/perfil/",
    profileType: "consumidor",
    publicPhone: null,
    publicEmail: null,
    publicWebsite: null,
    location: "Joinville, SC",
    sourceKind: "comentario",
    profileInsight: "Comentou publicamente em publicação imobiliária.",
    marketOpportunity: "Oferecer opções similares com financiamento na região.",
    intentStage: "quente",
    intentScore: 88,
    intentSignals: ["perguntou valor", "citou financiamento"],
    evidence: "Demonstrou publicamente interesse em preço e financiamento de um imóvel.",
    publishedAt: "2026-08-25",
    sourceUrls: ["https://www.instagram.com/perfil/"],
    ...overrides,
  };
}

function plain(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

describe("prospect lead privacy and quality", () => {
  it("treats the default scope as nationwide Brazil", () => {
    expect(isBrazilNationalScope(undefined)).toBe(true);
    expect(isBrazilNationalScope("Brasil — todo território nacional")).toBe(true);
    expect(isBrazilNationalScope("Joinville, SC")).toBe(false);
  });

  it("builds a nationwide social search when Brazil scope is selected", () => {
    const phrase = buildProspectSearchPhrase(
      {
        query: "procura apartamento com financiamento",
        location: "Brasil — todo território nacional",
        intent: "comprar",
        propertyType: "apartamento",
        networks: ["instagram"],
        limit: 20,
      },
      "instagram",
    );
    expect(phrase).toContain("site:instagram.com");
    expect(phrase).toContain("no Brasil");
    expect(phrase).toContain("Norte, Nordeste, Centro-Oeste, Sudeste e Sul");
    expect(phrase).not.toContain("Joinville");

    const regionalPass = buildProspectSearchPhrase(
      {
        query: "procura apartamento com financiamento",
        location: "Brasil — todo território nacional",
        intent: "comprar",
        propertyType: "apartamento",
        networks: ["instagram"],
        limit: 20,
      },
      "instagram",
      "Região Norte",
    );
    expect(regionalPass).toContain("Região Norte, Brasil");
  });
  it("accepts only the matching social network domain", () => {
    expect(isNetworkUrl("https://instagram.com/teste", "instagram")).toBe(true);
    expect(isNetworkUrl("https://facebook.com/teste", "instagram")).toBe(false);
  });

  it("never enriches consumer profiles with personal phone or email", () => {
    const lead = sanitizeProspectLead({
      ...baseLead({ publicPhone: "47 99999-9999", publicEmail: "pessoa@example.com" }),
      contactIsProfessional: true,
    });
    expect(lead?.publicPhone).toBeNull();
    expect(lead?.publicEmail).toBeNull();
  });

  it("documents the real sweep rule for comments, posts and likes context", () => {
    const rules = plain(PROSPECT_REAL_SWEEP_RULES.join(" "));
    expect(rules).toContain("comentarios");
    expect(rules).toContain("posts");
    expect(rules).toContain("curtidas");
    expect(rules).toContain("nunca geram prospect isolado");
  });

  it("runs the automated prospect radar every 10 minutes", () => {
    const workflow = readFileSync(".github/workflows/prospect-radar.yml", "utf8");
    expect(PROSPECT_RADAR_INTERVAL_MINUTES).toBe(10);
    expect(workflow).toContain('cron: "*/10 * * * *"');
    expect(workflow).toContain("/api/public/jobs/prospect-radar");
  });

  it("keeps public profile context and market opportunity on the lead", () => {
    const lead = sanitizeProspectLead({
      ...baseLead({
        sourceKind: "post",
        profileInsight: "Perfil público menciona interesse em financiamento imobiliário.",
        marketOpportunity: "Mostrar apartamentos com entrada facilitada e simulação.",
      }),
      contactIsProfessional: false,
    });
    expect(lead?.sourceKind).toBe("post");
    expect(lead?.profileInsight).toContain("financiamento imobiliário");
    expect(lead?.marketOpportunity).toContain("entrada facilitada");
  });

  it("keeps explicitly public professional contact only for professional profiles", () => {
    const lead = sanitizeProspectLead({
      ...baseLead({
        profileType: "profissional",
        publicPhone: "(47) 99999-9999",
        publicEmail: "contato@imobiliaria.com.br",
        publicWebsite: "https://imobiliaria.com.br",
      }),
      contactIsProfessional: true,
    });
    expect(lead?.publicPhone).toBe("(47) 99999-9999");
    expect(lead?.publicEmail).toBe("contato@imobiliaria.com.br");
    expect(lead?.publicWebsite).toBe("https://imobiliaria.com.br/");
  });

  it("rejects a profile URL that does not belong to the declared network", () => {
    const lead = sanitizeProspectLead({
      ...baseLead({ profileUrl: "https://example.com/perfil" }),
      contactIsProfessional: false,
    });
    expect(lead).toBeNull();
  });

  it("deduplicates the same public profile and prioritizes the stronger intent", () => {
    const leads = dedupeAndRankProspectLeads([
      baseLead({ id: "a", intentScore: 60, intentStage: "morno" }),
      baseLead({
        id: "b",
        intentScore: 94,
        intentStage: "quente",
        evidence: "Pedido direto de visita.",
      }),
    ]);
    expect(leads).toHaveLength(1);
    expect(leads[0]?.intentScore).toBe(94);
    expect(leads[0]?.evidence).toBe("Pedido direto de visita.");
  });
});
