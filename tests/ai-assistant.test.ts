import { describe, expect, it } from "vitest";
import { extractOpenAIText } from "../src/lib/ai-assistant.functions";

describe("MercadoImobi AI assistant", () => {
  it("extracts only assistant output text from a Responses API payload", () => {
    const text = extractOpenAIText({
      output: [
        { type: "reasoning", content: [] },
        {
          type: "message",
          content: [{ type: "output_text", text: "Olá! Posso ajudar a encontrar um imóvel." }],
        },
      ],
    });

    expect(text).toBe("Olá! Posso ajudar a encontrar um imóvel.");
  });

  it("extracts direct Responses API and Chat Completions text", () => {
    expect(extractOpenAIText({ output_text: "OK" })).toBe("OK");
    expect(
      extractOpenAIText({
        choices: [{ message: { content: "Olá! Vamos continuar o atendimento." } }],
      }),
    ).toBe("Olá! Vamos continuar o atendimento.");
  });

  it("returns an empty string when no output text exists", () => {
    expect(extractOpenAIText({ output: [] })).toBe("");
  });
});
