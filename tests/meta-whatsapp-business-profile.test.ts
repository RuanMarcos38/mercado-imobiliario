import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getMetaWhatsAppBusinessProfile,
  getMetaWhatsAppCommerceSettings,
  metaWhatsAppConfigFromStored,
  updateMetaWhatsAppBusinessProfile,
  updateMetaWhatsAppCommerceSettings,
} from "@/lib/meta-whatsapp.server";

function config() {
  return metaWhatsAppConfigFromStored({
    accessToken: "stored-meta-token",
    phoneNumberId: "987654321",
    businessAccountId: "waba-123",
    graphVersion: "v26.0",
  })!;
}

describe("Meta WhatsApp business profile and commerce", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the public WhatsApp business profile", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [
          {
            business_profile: {
              messaging_product: "whatsapp",
              about: "Atendimento imobiliário",
              address: "Joinville - SC",
              description: "Consultoria e oportunidades imobiliárias.",
              email: "contato@example.com",
              websites: ["https://example.com"],
              vertical: "PROF_SERVICES",
              profile_picture_url: "https://pps.whatsapp.net/profile.jpg",
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getMetaWhatsAppBusinessProfile(config());

    expect(result).toEqual({
      about: "Atendimento imobiliário",
      address: "Joinville - SC",
      description: "Consultoria e oportunidades imobiliárias.",
      email: "contato@example.com",
      websites: ["https://example.com"],
      vertical: "PROF_SERVICES",
      profilePictureUrl: "https://pps.whatsapp.net/profile.jpg",
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/987654321/whatsapp_business_profile?",
    );
  });

  it("uploads a profile picture and updates the business profile", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: "upload:session?sig=test" }))
      .mockResolvedValueOnce(Response.json({ h: "profile-picture-handle" }))
      .mockResolvedValueOnce(Response.json({ success: true }))
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              business_profile: {
                description: "Perfil atualizado",
                websites: [],
                profile_picture_url: "https://pps.whatsapp.net/new-profile.jpg",
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateMetaWhatsAppBusinessProfile({
      config: config(),
      description: "Perfil atualizado",
      about: "Imóveis e atendimento",
      vertical: "PROF_SERVICES",
      profilePicture: {
        mimeType: "image/png",
        fileName: "perfil.png",
        base64: Buffer.from("fake-image").toString("base64"),
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [sessionUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sessionUrl).toContain("/app/uploads/?");
    expect(sessionUrl).toContain("file_type=image%2Fpng");

    const [uploadUrl, uploadInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(uploadUrl).toContain("/upload:session?sig=test");
    expect(uploadInit.headers).toMatchObject({
      Authorization: "Bearer stored-meta-token",
      "Content-Type": "image/png",
      file_offset: "0",
    });

    const [, updateInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    const body = JSON.parse(String(updateInit.body));
    expect(body).toMatchObject({
      messaging_product: "whatsapp",
      description: "Perfil atualizado",
      about: "Imóveis e atendimento",
      vertical: "PROF_SERVICES",
      profile_picture_handle: "profile-picture-handle",
    });
    expect(result.profilePictureUrl).toBe("https://pps.whatsapp.net/new-profile.jpg");
  });

  it("reads and updates WhatsApp commerce settings without changing credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ success: true }))
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              id: "commerce-1",
              is_catalog_visible: true,
              is_cart_enabled: true,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              id: "commerce-1",
              is_catalog_visible: true,
              is_cart_enabled: true,
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const updated = await updateMetaWhatsAppCommerceSettings({
      config: config(),
      isCatalogVisible: true,
      isCartEnabled: true,
    });
    const read = await getMetaWhatsAppCommerceSettings(config());

    expect(updated).toEqual({
      id: "commerce-1",
      isCatalogVisible: true,
      isCartEnabled: true,
    });
    expect(read.isCatalogVisible).toBe(true);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "is_catalog_visible=true&is_cart_enabled=true",
    );
  });
});
