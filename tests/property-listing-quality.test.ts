import { describe, expect, it } from "vitest";
import {
  PROPERTY_FRESHNESS_SLA_MINUTES,
  isFreshListing,
  isFreshRealEstateListing,
  isRealEstateListing,
} from "@/lib/property-listing-quality";

const NOW = Date.parse("2026-08-17T18:00:00.000Z");

describe("property listing quality guardrails", () => {
  it("aceita imóvel residencial fresco da CAIXA com preço e localização", () => {
    expect(
      isFreshRealEstateListing(
        {
          source_url: "https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=1",
          title: "Apartamento em Joinville",
          property_type: "Apartamento",
          price: 285000,
          location_city: "Joinville",
          updated_at: "2026-08-17T17:30:00.000Z",
          listing_market: "caixa",
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

  it("rejeita páginas institucionais, contato e marketing", () => {
    expect(
      isRealEstateListing({
        source_url: "https://www.patrimar.com.br/fale-conosco/canal-do-terreno/",
        title: "Canal do Terreno - Patrimar",
        property_type: "Terreno",
      }),
    ).toBe(false);
    expect(
      isRealEstateListing({
        source_url: "https://www.helbor.com.br/empreendimentos/casa-piaui-studios/preview",
        title: "Casa Piauí Studios | Helbor",
        property_type: "Studio",
      }),
    ).toBe(false);
  });

  it("rejeita empreendimento genérico mesmo quando possui quartos e área", () => {
    expect(
      isFreshRealEstateListing(
        {
          source_url: "https://www.rivaincorporadora.com.br/empreendimentos/grand-golf/",
          title: "Grand Golf",
          property_type: "Apartamento",
          updated_at: "2026-08-17T17:30:00.000Z",
          price: null,
          location_address: null,
          location_city: null,
          area_sqm: 48.37,
          bedrooms: 2,
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("rejeita empreendimento chamado Casa quando não existe anúncio comercial de venda", () => {
    expect(
      isFreshRealEstateListing(
        {
          source_url: "https://www.patrimar.com.br/imoveis/armani-casa/",
          title: "Armani/Casa - Patrimar",
          property_type: "Casa",
          updated_at: "2026-08-17T17:30:00.000Z",
          price: null,
          location_address: null,
          location_city: null,
          area_sqm: 149,
          bedrooms: 3,
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("rejeita página imobiliária sem preço ou localização mesmo com dados técnicos", () => {
    expect(
      isFreshRealEstateListing(
        {
          source_url: "https://www.patrimar.com.br/imoveis/connect-square/",
          title: "Connect Square - Patrimar",
          property_type: "Studio",
          updated_at: "2026-08-17T17:30:00.000Z",
          price: null,
          location_address: null,
          location_city: null,
          area_sqm: 60,
          bedrooms: 2,
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("aceita anúncio residencial de venda com dados comerciais completos", () => {
    expect(
      isFreshRealEstateListing(
        {
          source_url:
            "https://www.planoeplano.com.br/imoveis/sp/sao-paulo/apartamentos/mooca/planoreserva-da-mooca",
          title: "Apartamento à venda na Mooca | Plano&Reserva da Mooca",
          property_type: "Apartamento",
          updated_at: "2026-08-17T17:30:00.000Z",
          price: 225000,
          location_city: "São Paulo",
          location_address: "Mooca, São Paulo - SP",
          listing_market: "market",
        },
        NOW,
      ),
    ).toBe(true);
  });

  it("rejeita anúncio apenas de locação", () => {
    expect(
      isFreshRealEstateListing(
        {
          source_url: "https://www.quintoandar.com.br/imovel/alugar/apartamento-centro-123",
          title: "Apartamento para alugar no Centro",
          description: "Locação residencial",
          property_type: "Apartamento",
          updated_at: "2026-08-17T17:30:00.000Z",
          price: 2500,
          location_city: "Joinville",
          listing_market: "market",
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("rejeita terreno mesmo quando vem da CAIXA", () => {
    expect(
      isFreshRealEstateListing(
        {
          source_url: "https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=2",
          title: "Terreno em Joinville",
          property_type: "Terreno",
          updated_at: "2026-08-17T17:30:00.000Z",
          price: 190000,
          location_city: "Joinville",
          listing_market: "caixa",
        },
        NOW,
      ),
    ).toBe(false);
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
          price: 450000,
          location_city: "Joinville",
          updated_at: null,
        },
        NOW,
      ),
    ).toBe(false);
  });
});
