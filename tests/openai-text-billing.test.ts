import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAIText, describeOpenAIError } from "../src/lib/openai-text.server";

describe("OpenAI billing errors", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("stops after Responses API when credits are exhausted", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("OPENAI_MODEL", "gpt-5.6");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            message: "You have no credits remaining. Add credits to continue using the API.",
            type: "insufficient_quota",
            code: "credit_balance_exhausted",
          },
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      createOpenAIText("Teste", "Responda somente OK.", { timeoutMs: 5000 }),
    ).rejects.toThrow("AI_BILLING_REQUIRED");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.openai.com/v1/responses");
  });

  it("returns a safe Portuguese billing explanation", () => {
    const message = describeOpenAIError(
      new Error(
        "AI_BILLING_REQUIRED: A OpenAI API está configurada, mas o projeto/organização está sem créditos disponíveis ou atingiu um limite de gastos.",
      ),
    );

    expect(message).toContain("sem créditos disponíveis");
    expect(message).not.toContain("AI_BILLING_REQUIRED");
  });
});
