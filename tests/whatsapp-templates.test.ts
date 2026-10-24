import { afterEach, describe, expect, it, vi } from "vitest";
import { JOINVILLE_PRESENTATION, templateSubmission } from "@/lib/whatsapp-templates.core";
import {
  createMetaWhatsAppTemplate,
  listMetaWhatsAppTemplates,
  type MetaWhatsAppConfig,
} from "@/lib/meta-whatsapp.server";
const config: MetaWhatsAppConfig = {
  graphVersion: "v26.0",
  phoneNumberId: "phone-a",
  businessAccountId: "waba-a",
  accessToken: "test-token",
  displayPhoneNumber: null,
  callbackUrl: "https://example.com",
};
afterEach(() => vi.unstubAllGlobals());
describe("Meta templates", () => {
  it("preserves the presentation and submits to the tenant WABA, without sending messages", async () => {
    const payload = templateSubmission({
      name: "ruan_joinville_mcmv_apresentacao_v1",
      body: JOINVILLE_PRESENTATION,
      exampleName: "Ruan",
    });
    expect(payload.components[0].text).toBe(
      JOINVILLE_PRESENTATION.replaceAll("{{primeiro_nome}}", "{{1}}"),
    );
    const fetcher = vi.fn(async (..._args: unknown[]) =>
      Response.json({ id: "template-1", status: "PENDING" }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await createMetaWhatsAppTemplate(config, payload)).toEqual({
      id: "template-1",
      status: "PENDING",
    });
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://graph.facebook.com/v26.0/waba-a/message_templates",
    );
  });
  it("rejects unknown placeholders and invalid names", () => {
    expect(() =>
      templateSubmission({ name: "Upper Case", body: "Oi", exampleName: "Ruan" }),
    ).toThrow();
    expect(() =>
      templateSubmission({ name: "valid", body: "Oi {{telefone}}", exampleName: "Ruan" }),
    ).toThrow();
  });
  it("rebuilds pagination rather than following URLs that can contain tokens", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: "one" }],
          paging: {
            next: "https://evil.invalid/?access_token=secret",
            cursors: { after: "next-page" },
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({ data: [{ id: "two" }] }));
    vi.stubGlobal("fetch", fetcher);
    expect(await listMetaWhatsAppTemplates(config)).toHaveLength(2);
    expect(fetcher.mock.calls[1][0]).toContain(
      "https://graph.facebook.com/v26.0/waba-a/message_templates?",
    );
    expect(fetcher.mock.calls[1][0]).toContain("after=next-page");
    expect(fetcher.mock.calls[1][0]).not.toContain("secret");
  });
  it("fails closed without a WABA or valid provider response", async () => {
    const fetcher = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      listMetaWhatsAppTemplates({ ...config, businessAccountId: null }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(listMetaWhatsAppTemplates(config)).rejects.toThrow();
  });
});
