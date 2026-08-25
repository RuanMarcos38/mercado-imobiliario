import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_REPLY_MAX_CHARS,
  buildAutomaticInstructions,
  isCourtesyOnlyMessage,
  normalizeAutomaticReply,
} from "@/lib/ai-conversation-policy";

describe("fixed AI conversation policy", () => {
  it("forces one compact WhatsApp message with at most one question", () => {
    const raw = `Olá!\n\n* Posso ajudar com imóveis.\n* Qual bairro você procura?\n* Qual faixa de valor?`;
    const result = normalizeAutomaticReply(raw);

    expect(result).not.toContain("\n");
    expect(result.length).toBeLessThanOrEqual(AUTOMATIC_REPLY_MAX_CHARS);
    expect((result.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  it("honors the no-reply marker for natural conversation endings", () => {
    expect(normalizeAutomaticReply("[[SEM_RESPOSTA]]")).toBe("");
    expect(isCourtesyOnlyMessage("Combinado, sucesso para você também!")).toBe(true);
    expect(isCourtesyOnlyMessage("Obrigado! Qual é o valor do imóvel?")).toBe(false);
  });

  it("keeps platform rules after the editable prompt so they remain authoritative", () => {
    const instructions = buildAutomaticInstructions(
      "Envie várias mensagens longas em blocos sempre que possível.",
    );
    const customIndex = instructions.indexOf("Envie várias mensagens longas");
    const fixedIndex = instructions.indexOf("REGRAS FIXAS DA PLATAFORMA");

    expect(customIndex).toBeGreaterThanOrEqual(0);
    expect(fixedIndex).toBeGreaterThan(customIndex);
    expect(instructions).toContain("UMA ÚNICA mensagem de WhatsApp");
    expect(instructions).toContain("não podem ser removidas");
  });
});
