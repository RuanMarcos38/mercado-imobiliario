import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractMetaWhatsAppMessageId,
  metaWhatsAppWebhookSignatureValid,
  sendMetaWhatsAppMediaMessage,
  sendMetaWhatsAppTextMessage,
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
