import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifySocialInterestText,
  extractMetaSocialWebhookItems,
  metaSocialWebhookSignatureValid,
  verifyMetaSocialWebhookChallenge,
} from "@/lib/meta-social-automation.server";

describe("official Meta Facebook and Instagram automation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("verifies the social webhook challenge", async () => {
    vi.stubEnv("META_SOCIAL_VERIFY_TOKEN", "meta-social-verify");
    const request = new Request(
      "https://mercadoimobi.example.com/api/public/hooks/meta-social?hub.mode=subscribe&hub.verify_token=meta-social-verify&hub.challenge=ok-123",
    );
    const response = verifyMetaSocialWebhookChallenge(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok-123");
  });

  it("requires a valid X-Hub-Signature-256", () => {
    vi.stubEnv("META_APP_SECRET", "app-secret");
    const rawBody = JSON.stringify({ object: "instagram", entry: [] });
    const signature = createHmac("sha256", "app-secret").update(rawBody, "utf8").digest("hex");
    const request = new Request("https://mercadoimobi.example.com/api/public/hooks/meta-social", {
      method: "POST",
      headers: { "x-hub-signature-256": `sha256=${signature}` },
      body: rawBody,
    });
    expect(metaSocialWebhookSignatureValid(request, rawBody)).toBe(true);
    expect(metaSocialWebhookSignatureValid(request, `${rawBody}x`)).toBe(false);
  });

  it("extracts Instagram comments and direct messages", () => {
    const items = extractMetaSocialWebhookItems({
      object: "instagram",
      entry: [
        {
          id: "ig-business-id",
          messaging: [
            {
              sender: { id: "ig-user" },
              message: { mid: "mid.1", text: "Quero saber mais" },
            },
          ],
          changes: [
            {
              field: "comments",
              value: {
                id: "comment.1",
                text: "Qual valor? Tenho interesse",
                from: { id: "ig-commenter", username: "cliente" },
              },
            },
          ],
        },
      ],
    });

    expect(items).toEqual([
      {
        kind: "message",
        channel: "instagram",
        accountId: "ig-business-id",
        externalId: "mid.1",
        senderId: "ig-user",
        text: "Quero saber mais",
      },
      {
        kind: "comment",
        channel: "instagram",
        accountId: "ig-business-id",
        externalId: "comment.1",
        senderId: "ig-commenter",
        text: "Qual valor? Tenho interesse",
      },
    ]);
  });

  it("extracts Facebook Page comments and ignores message echoes", () => {
    const items = extractMetaSocialWebhookItems({
      object: "page",
      entry: [
        {
          id: "page-id",
          messaging: [
            {
              sender: { id: "page-id" },
              message: { mid: "echo.1", text: "resposta da página", is_echo: true },
            },
          ],
          changes: [
            {
              field: "feed",
              value: {
                item: "comment",
                verb: "add",
                comment_id: "fb-comment-1",
                message: "Gostei. Onde fica?",
                from: { id: "fb-user" },
              },
            },
          ],
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "comment",
      channel: "facebook",
      accountId: "page-id",
      externalId: "fb-comment-1",
      senderId: "fb-user",
    });
  });

  it("detects buying-intent language without treating a refusal as interest", () => {
    expect(classifySocialInterestText("Qual valor? Tenho interesse em visitar.")).toBe(true);
    expect(classifySocialInterestText("Não tenho interesse, obrigado.")).toBe(false);
    expect(classifySocialInterestText("Muito bonito!")).toBe(false);
  });
});
