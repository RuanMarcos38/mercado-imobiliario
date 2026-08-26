import { describe, expect, it } from "vitest";
import { buildProspectSearchPhrase, isBrazilNationalScope } from "@/lib/prospect-leads.functions";
import {
  dedupeAndRankProspectLeads,
  isNetworkUrl,
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
    intentStage: "quente",
    intentScore: 88,
    intentSignals: ["perguntou valor", "citou financiamento"],
    evidence: "Demonstrou publicamente interesse em preço e financiamento de um imóvel.",
    publishedAt: "2026-08-25",
    sourceUrls: ["https://www.instagram.com/perfil/"],
    ...overrides,
  };
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
    expect(phrase).not.toContain("Joinville");
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
