import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractMetaWhatsAppMessageId,
  metaWhatsAppConfigFromStored,
  metaWhatsAppWebhookSignatureValid,
  sendMetaWhatsAppMediaMessage,
  sendMetaWhatsAppTextMessage,
  testMetaWhatsAppConfig,
  testMetaWhatsAppConnection,
  verifyMetaWhatsAppWebhookChallenge,
} from "@/lib/meta-whatsapp.server";

describe("official Meta WhatsApp Cloud API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("verifies the Meta webhook challenge with the configured token", async () => {
    vi.stubEnv("META_WHATSAPP_VERIFY_TOKEN", "verify-token");

    const request = new Request(
      "https://mercadoimobi.example.com/api/public/hooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=challenge-ok",
    );
    const response = verifyMetaWhatsAppWebhookChallenge(request);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("challenge-ok");

    const denied = verifyMetaWhatsAppWebhookChallenge(
      new Request(
        "https://mercadoimobi.example.com/api/public/hooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-ok",
      ),
    );
    expect(denied.status).toBe(403);
  });

  it("sends text through the configured Meta Phone Number ID", async () => {
    vi.stubEnv("META_WHATSAPP_ACCESS_TOKEN", "meta-token");
    vi.stubEnv("META_WHATSAPP_PHONE_NUMBER_ID", "123456789");
    vi.stubEnv("META_WHATSAPP_GRAPH_VERSION", "v26.0");
    const fetchMock = vi.fn(async () =>
      Response.json({ messages: [{ id: "wamid.test-message" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const payload = await sendMetaWhatsAppTextMessage({
      phone: "5547999999999",
      text: "Olá pelo WhatsApp oficial",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(url).toBe("https://graph.facebook.com/v26.0/123456789/messages");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer meta-token",
      "Content-Type": "application/json",
    });
    expect(body).toMatchObject({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5547999999999",
      type: "text",
      text: { body: "Olá pelo WhatsApp oficial", preview_url: false },
    });
    expect(extractMetaWhatsAppMessageId(payload)).toBe("wamid.test-message");
  });

  it("sends text through a platform-saved Meta configuration without env credentials", async () => {
    const config = metaWhatsAppConfigFromStored({
      accessToken: "stored-meta-token",
      phoneNumberId: "987654321",
      graphVersion: "26.0",
      displayPhoneNumber: "+55 83 9365-7471",
    });
    const fetchMock = vi.fn(async () =>
      Response.json({ messages: [{ id: "wamid.stored-config" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const payload = await sendMetaWhatsAppTextMessage({
      phone: "558393657471",
      text: "Mensagem pela configuração salva",
      config: config!,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(url).toBe("https://graph.facebook.com/v26.0/987654321/messages");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer stored-meta-token",
      "Content-Type": "application/json",
    });
    expect(extractMetaWhatsAppMessageId(payload)).toBe("wamid.stored-config");
  });

  it("uploads media before sending a Meta document message", async () => {
    vi.stubEnv("META_WHATSAPP_ACCESS_TOKEN", "meta-token");
    vi.stubEnv("META_WHATSAPP_PHONE_NUMBER_ID", "123456789");
    vi.stubEnv("META_WHATSAPP_GRAPH_VERSION", "v26.0");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: "media-id" }))
      .mockResolvedValueOnce(Response.json({ messages: [{ id: "wamid.media-message" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const payload = await sendMetaWhatsAppMediaMessage({
      phone: "5547999999999",
      mediaType: "document",
      mimeType: "application/pdf",
      fileName: "proposta.pdf",
      base64: Buffer.from("documento").toString("base64"),
      caption: "Proposta",
    });

    const [uploadUrl, uploadInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [sendUrl, sendInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const sendBody = JSON.parse(String(sendInit.body));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(uploadUrl).toBe("https://graph.facebook.com/v26.0/123456789/media");
    expect(uploadInit.body).toBeInstanceOf(FormData);
    expect(sendUrl).toBe("https://graph.facebook.com/v26.0/123456789/messages");
    expect(sendBody).toMatchObject({
      messaging_product: "whatsapp",
      to: "5547999999999",
      type: "document",
      document: { id: "media-id", filename: "proposta.pdf", caption: "Proposta" },
    });
    expect(extractMetaWhatsAppMessageId(payload)).toBe("wamid.media-message");
  });

  it("keeps the official API active when optional phone metadata cannot be read", async () => {
    vi.stubEnv("META_WHATSAPP_ACCESS_TOKEN", "meta-token");
    vi.stubEnv("META_WHATSAPP_PHONE_NUMBER_ID", "123456789");
    vi.stubEnv("META_WHATSAPP_DISPLAY_PHONE_NUMBER", "+55 83 9365-7471");
    vi.stubEnv("META_WHATSAPP_GRAPH_VERSION", "v26.0");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              message:
                "Unsupported get request. Object with ID '123456789' cannot be loaded due to missing permissions.",
            },
          },
          { status: 400 },
        ),
      ),
    );

    const result = await testMetaWhatsAppConnection();

    expect(result.configured).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.metadataValidated).toBe(false);
    expect(result.phoneNumberId).toBe("123456789");
    expect(result.displayPhoneNumber).toBe("+55 83 9365-7471");
  });

  it("validates a platform-saved Meta configuration", async () => {
    const config = metaWhatsAppConfigFromStored({
      accessToken: "stored-meta-token",
      phoneNumberId: "987654321",
      graphVersion: "v26.0",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          id: "987654321",
          display_phone_number: "+55 83 9365-7471",
          verified_name: "MercadoImobi",
          quality_rating: "GREEN",
        }),
      ),
    );

    const result = await testMetaWhatsAppConfig(config);

    expect(result.configured).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.phoneNumberId).toBe("987654321");
    expect(result.displayPhoneNumber).toBe("+55 83 9365-7471");
    expect(result.verifiedName).toBe("MercadoImobi");
    expect(result.qualityRating).toBe("GREEN");
  });

  it("keeps invalid or expired Meta tokens as a connection error", async () => {
    vi.stubEnv("META_WHATSAPP_ACCESS_TOKEN", "expired-token");
    vi.stubEnv("META_WHATSAPP_PHONE_NUMBER_ID", "123456789");
    vi.stubEnv("META_WHATSAPP_GRAPH_VERSION", "v26.0");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              message: "Error validating access token: Session has expired on Monday.",
            },
          },
          { status: 400 },
        ),
      ),
    );

    const result = await testMetaWhatsAppConnection();

    expect(result.configured).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.connected).toBe(false);
    expect(result.metadataValidated).toBe(false);
    expect(result.error).toContain("Error validating access token");
  });

  it("validates signed Meta webhook payloads when an app secret is configured", () => {
    vi.stubEnv("META_WHATSAPP_APP_SECRET", "app-secret");
    const rawBody = JSON.stringify({ object: "whatsapp_business_account" });
    const signature = createHmac("sha256", "app-secret").update(rawBody, "utf8").digest("hex");
    const request = new Request("https://mercadoimobi.example.com/api/public/hooks/whatsapp", {
      method: "POST",
      headers: { "x-hub-signature-256": `sha256=${signature}` },
      body: rawBody,
    });

    expect(metaWhatsAppWebhookSignatureValid(request, rawBody)).toBe(true);
    expect(metaWhatsAppWebhookSignatureValid(request, `${rawBody}x`)).toBe(false);
  });
});
