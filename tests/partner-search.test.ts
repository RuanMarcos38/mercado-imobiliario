import { describe, expect, it } from "vitest";
import {
  dedupeAndRankPartners,
  isOfficialCreciSource,
  partnerCompletenessScore,
  sanitizePartnerCandidate,
  type PartnerCandidate,
} from "@/lib/partner-search.core";

function candidate(overrides: Partial<PartnerCandidate> = {}): PartnerCandidate {
  return {
    id: "1",
    name: "Imobiliária Exemplo",
    entityType: "imobiliaria",
    creciNumber: null,
    creciUf: null,
    creciType: "PJ",
    creciStatus: "nao_localizado",
    phone: null,
    email: null,
    website: null,
    address: "Centro, Joinville - SC",
    city: "Joinville",
    state: "SC",
    specialties: [],
    summary: null,
    sourceUrls: [],
    googleMapsUrl: null,
    sourceProviders: [],
    ...overrides,
  };
}

describe("partner search core", () => {
  it("only treats official CRECI/COFECI domains as official registry sources", () => {
    expect(isOfficialCreciSource("https://www.crecisc.gov.br/consulta")).toBe(true);
    expect(isOfficialCreciSource("https://cofeci.gov.br/consulta")).toBe(true);
    expect(isOfficialCreciSource("https://imobiliaria-exemplo.com.br/creci")).toBe(false);
  });

  it("promotes a CRECI to verified only when an official source is present", () => {
    const verified = sanitizePartnerCandidate(
      candidate({
        creciNumber: "12345-J",
        creciUf: "sc",
        creciStatus: "informado",
        sourceUrls: ["https://www.crecisc.gov.br/consulta/12345"],
      }),
    );
    expect(verified.creciStatus).toBe("verificado");
    expect(verified.creciUf).toBe("SC");
  });

  it("deduplicates Google and web results by phone and merges professional data", () => {
    const google = candidate({
      id: "google:1",
      phone: "(47) 99999-0000",
      website: "https://exemplo.com.br",
      googleMapsUrl: "https://maps.google.com/?q=exemplo",
      sourceProviders: ["Google Places"],
    });
    const web = candidate({
      id: "web:1",
      phone: "+55 47 99999-0000",
      email: "contato@exemplo.com.br",
      creciNumber: "12345-J",
      creciUf: "SC",
      creciStatus: "verificado",
      sourceUrls: ["https://www.crecisc.gov.br/consulta/12345"],
      sourceProviders: ["OpenAI Web Search"],
    });

    const result = dedupeAndRankPartners([google, web]);
    expect(result).toHaveLength(1);
    expect(result[0]?.email).toBe("contato@exemplo.com.br");
    expect(result[0]?.creciStatus).toBe("verificado");
    expect(result[0]?.googleMapsUrl).toContain("maps.google.com");
    expect(result[0]?.sourceProviders).toEqual(
      expect.arrayContaining(["Google Places", "OpenAI Web Search"]),
    );
  });

  it("ranks more complete and verified partners first", () => {
    const basic = candidate({ id: "basic", name: "Básico" });
    const complete = candidate({
      id: "complete",
      name: "Completo",
      creciNumber: "9999-F",
      creciStatus: "verificado",
      phone: "5547999999999",
      email: "corretor@example.com",
      website: "https://example.com",
      sourceUrls: ["https://www.crecisc.gov.br/consulta/9999"],
    });
    expect(partnerCompletenessScore(complete)).toBeGreaterThan(partnerCompletenessScore(basic));
    expect(dedupeAndRankPartners([basic, complete])[0]?.name).toBe("Completo");
  });
});
