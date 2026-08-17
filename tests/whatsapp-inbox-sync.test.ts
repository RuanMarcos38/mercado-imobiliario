import { describe, expect, it } from "vitest";
import { normalizeEvolutionMessage } from "@/lib/whatsapp-inbox-sync.server";

describe("Evolution inbox recovery normalization", () => {
  it("normalizes a normal inbound phone JID", () => {
    const result = normalizeEvolutionMessage({
      key: {
        id: "MSG-IN-1",
        fromMe: false,
        remoteJid: "5547999999999@s.whatsapp.net",
      },
      pushName: "Cliente",
      messageType: "conversation",
      messageTimestamp: 1786932600,
      message: { conversation: "Olá, tenho interesse no imóvel" },
    });

    expect(result).toMatchObject({
      externalId: "MSG-IN-1",
      fromMe: false,
      phone: "5547999999999",
      contactName: "Cliente",
      body: "Olá, tenho interesse no imóvel",
      messageType: "text",
    });
  });

  it("uses remoteJidAlt when Evolution v2.3.7 stores inbound remoteJid as LID", () => {
    const result = normalizeEvolutionMessage({
      key: {
        id: "MSG-LID-1",
        fromMe: false,
        remoteJid: "123456789012345@lid",
        remoteJidAlt: "5547999999999@s.whatsapp.net",
      },
      pushName: "Cliente LID",
      messageType: "conversation",
      messageTimestamp: 1786932601,
      message: { conversation: "Resposta recebida" },
    });

    expect(result).toMatchObject({
      externalId: "MSG-LID-1",
      fromMe: false,
      phone: "5547999999999",
      body: "Resposta recebida",
    });
  });

  it("never mistakes a LID-only internal identifier for a customer phone", () => {
    const result = normalizeEvolutionMessage({
      key: {
        id: "MSG-LID-ONLY",
        fromMe: false,
        remoteJid: "123456789012345@lid",
      },
      messageType: "conversation",
      messageTimestamp: 1786932602,
      message: { conversation: "Mensagem sem telefone alternativo" },
    });

    expect(result).toBeNull();
  });
});
