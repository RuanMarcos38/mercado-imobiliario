import { describe, expect, it } from "vitest";
import {
  PROPERTY_FRESHNESS_SLA_MINUTES,
  isFreshListing,
  isFreshRealEstateListing,
  isRealEstateListing,
} from "@/lib/property-listing-quality";

const NOW = Date.parse("2026-08-17T18:00:00.000Z");

describe("property listing quality guardrails", () => {
  it("aceita imóvel fresco da CAIXA", () => {
    expect(
      isFreshRealEstateListing(
        {
          source_url: "https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=1",
          title: "Apartamento em Joinville",
          property_type: "Apartamento",
          updated_at: "2026-08-17T17:30:00.000Z",
        },
        NOW,
      ),
    ).toBe(true);
  });

  it("mantém anúncios públicos recentes entre sincronizações diárias", () => {
    expect(PROPERTY_FRESHNESS_SLA_MINUTES).toBe(90 * 24 * 60);
    expect(isFreshListing("2026-08-16T18:00:00.000Z", NOW)).toBe(true);
  });

  it("rejeita anúncio com mais de 90 dias", () => {
    expect(isFreshListing("2026-05-18T17:59:59.000Z", NOW)).toBe(false);
  });

  it("aceita fontes públicas monitoradas no catálogo de imóveis", () => {
    expect(
      isRealEstateListing({
        source_url: "https://ayoshii.com.br/imoveis/joinville/apartamento-centro",
        title: "Apartamento em Joinville",
        property_type: "Apartamento",
      }),
    ).toBe(true);
    expect(
      isRealEstateListing({
        source_url: "https://canalpro.grupozap.com/imovel/123",
        title: "Casa à venda em Joinville",
        property_type: "Casa",
      }),
    ).toBe(true);
  });

  it("rejeita veículo mesmo em URL de portal conhecido", () => {
    expect(
      isRealEstateListing({
        source_url: "https://www.olx.com.br/autos-e-pecas/carro-usado-123",
        title: "Honda Civic 2022",
        description: "Automóvel completo",
        property_type: "Veículo",
      }),
    ).toBe(false);
  });

  it("rejeita OLX sem contexto imobiliário", () => {
    expect(
      isRealEstateListing({
        source_url: "https://www.olx.com.br/item/123",
        title: "Notebook seminovo",
        description: "Eletrônicos",
        property_type: null,
      }),
    ).toBe(false);
  });

  it("rejeita fonte desconhecida", () => {
    expect(
      isRealEstateListing({
        source_url: "https://exemplo-desconhecido.com/anuncio/1",
        title: "Apartamento no Centro",
        property_type: "Apartamento",
      }),
    ).toBe(false);
  });

  it("rejeita timestamp ausente", () => {
    expect(
      isFreshRealEstateListing(
        {
          source_url: "https://www.zapimoveis.com.br/imovel/123",
          title: "Casa à venda",
          property_type: "Casa",
          updated_at: null,
        },
        NOW,
      ),
    ).toBe(false);
  });
});
