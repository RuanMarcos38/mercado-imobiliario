import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPublicFeedUrl, readAuthorizedPropertyFeed } from "@/lib/property-feed.server";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("authorized property feeds", () => {
  it("normalizes a JSON inventory", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              properties: [
                {
                  id: "ABC-123",
                  title: "Apartamento no Centro",
                  description: "Pronto para morar",
                  price: 450000,
                  city: "Joinville",
                  state: "SC",
                  propertyType: "Apartamento",
                  bedrooms: 2,
                  bathrooms: 1,
                  area: 61.5,
                  url: "https://imobiliaria.exemplo.com.br/imovel/abc-123",
                  images: ["https://imobiliaria.exemplo.com.br/foto/1.jpg"],
                  contact: {
                    name: "Imobiliária Exemplo",
                    phone: "(47) 3333-4444",
                    whatsapp: "(47) 99999-8888",
                    email: "contato@exemplo.com.br",
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const result = await readAuthorizedPropertyFeed({
      feedUrl: "https://imobiliaria.exemplo.com.br/feed.json",
      format: "json",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "ABC-123",
      title: "Apartamento no Centro",
      price: 450000,
      location_city: "Joinville",
      location_state: "SC",
      property_type: "Apartamento",
      bedrooms: 2,
      bathrooms: 1,
      area_sqm: 61.5,
      contact_whatsapp: "47999998888",
      source_url: "https://imobiliaria.exemplo.com.br/imovel/abc-123",
    });
    expect(result.items[0]?.images).toEqual(["https://imobiliaria.exemplo.com.br/foto/1.jpg"]);
  });

  it("normalizes a VRSYNC-style XML inventory", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <ListingDataFeed>
        <Listings>
          <Listing>
            <ListingID>VR-900</ListingID>
            <Title>Casa com 3 quartos</Title>
            <Description><![CDATA[Casa residencial com quintal.]]></Description>
            <Details>
              <PropertyType>Casa</PropertyType>
              <ListPrice>780000</ListPrice>
              <Bedrooms>3</Bedrooms>
              <Bathrooms>2</Bathrooms>
              <LivingArea>145</LivingArea>
            </Details>
            <Location>
              <Address>Rua das Flores, 100</Address>
              <City>Joinville</City>
              <State>SC</State>
            </Location>
            <ListingUrl>https://imobiliaria.exemplo.com.br/imovel/vr-900</ListingUrl>
            <Media>
              <Item><URL>https://imobiliaria.exemplo.com.br/fotos/vr-900-1.jpg</URL></Item>
            </Media>
            <ContactInfo>
              <ContactName>Equipe Comercial</ContactName>
              <Telephone>47 3333-2222</Telephone>
              <WhatsApp>47 99999-7777</WhatsApp>
              <Email>vendas@exemplo.com.br</Email>
            </ContactInfo>
          </Listing>
        </Listings>
      </ListingDataFeed>`;

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(xml, { status: 200, headers: { "content-type": "application/xml" } }),
      ),
    );

    const result = await readAuthorizedPropertyFeed({
      feedUrl: "https://imobiliaria.exemplo.com.br/vrsync.xml",
      format: "xml",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "VR-900",
      title: "Casa com 3 quartos",
      description: "Casa residencial com quintal.",
      price: 780000,
      location_address: "Rua das Flores, 100",
      location_city: "Joinville",
      location_state: "SC",
      property_type: "Casa",
      bedrooms: 3,
      bathrooms: 2,
      area_sqm: 145,
      source_url: "https://imobiliaria.exemplo.com.br/imovel/vr-900",
      contact_whatsapp: "47999997777",
    });
    expect(result.items[0]?.images).toContain(
      "https://imobiliaria.exemplo.com.br/fotos/vr-900-1.jpg",
    );
  });

  it("blocks local and private feed addresses", () => {
    expect(() => assertPublicFeedUrl("http://127.0.0.1/feed.xml")).toThrow();
    expect(() => assertPublicFeedUrl("http://192.168.1.5/feed.xml")).toThrow();
    expect(() => assertPublicFeedUrl("http://localhost/feed.xml")).toThrow();
  });
});
