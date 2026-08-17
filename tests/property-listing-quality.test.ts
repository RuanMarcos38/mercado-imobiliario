import { describe, expect, it } from "vitest";
import {
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

  it("rejeita anúncio com mais de 120 minutos", () => {
    expect(isFreshListing("2026-08-17T15:59:59.000Z", NOW)).toBe(false);
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
