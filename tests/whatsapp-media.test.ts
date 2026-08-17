import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEvolutionMediaMessage } from "@/lib/evolution-media.server";

describe("Evolution media sender", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends document as base64 to the tenant instance", async () => {
    vi.stubEnv("EVOLUTION_API_URL", "https://evolution.example.test");
    vi.stubEnv("EVOLUTION_API_KEY", "test-key");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ key: { id: "media-1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await sendEvolutionMediaMessage({
      phone: "5547999999999",
      mediaType: "document",
      mimeType: "application/pdf",
      fileName: "documento.pdf",
      base64: "data:application/pdf;base64,QUJD",
      caption: "Documento do cliente",
      instanceName: "mercadoimobi-tenant-123",
    });

    expect(result).toMatchObject({ key: { id: "media-1" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/message/sendMedia/mercadoimobi-tenant-123",
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      number: "5547999999999",
      mediatype: "document",
      mimetype: "application/pdf",
      media: "QUJD",
      fileName: "documento.pdf",
      caption: "Documento do cliente",
    });
  });
});
