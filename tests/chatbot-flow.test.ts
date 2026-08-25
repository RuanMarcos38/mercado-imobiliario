import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  insertedMessages: [] as Array<Record<string, unknown>>,
  conversationUpdates: [] as Array<Record<string, unknown>>,
  settings: {
    enabled: true,
    auto_reply: true,
    agent_name: "Assistente MercadoImobi",
    system_prompt: "Seja breve e consultivo.",
    handoff_keywords: ["humano", "corretor"],
  },
  history: [
    {
      direction: "inbound",
      body: "Olá, tenho interesse no imóvel.",
      sent_at: "2026-08-16T03:00:00.000Z",
    },
  ],
}));

function resultBuilder(data: unknown = null) {
  const builder: Record<string, unknown> & PromiseLike<{ data: unknown; error: null }> = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return Promise.resolve({ data, error: null }) as never;
    },
    maybeSingle() {
      return Promise.resolve({ data, error: null }) as never;
    },
    then(resolve, reject) {
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return builder;
}

const fakeDb = vi.hoisted(() => ({
  from(table: string) {
    if (table === "ai_agent_settings") {
      return resultBuilder(state.settings);
    }
    if (table === "whatsapp_messages") {
      const query = resultBuilder(state.history) as ReturnType<typeof resultBuilder> & {
        insert?: (value: Record<string, unknown>) => Promise<{ error: null }>;
      };
      query.insert = async (value) => {
        state.insertedMessages.push(value);
        return { error: null };
      };
      return query;
    }
    if (table === "whatsapp_conversations") {
      const query = resultBuilder(null) as ReturnType<typeof resultBuilder> & {
        update?: (value: Record<string, unknown>) => ReturnType<typeof resultBuilder>;
      };
      query.update = (value) => {
        state.conversationUpdates.push(value);
        return resultBuilder(null);
      };
      return query;
    }
    return resultBuilder(null);
  },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: fakeDb,
}));

import { maybeAutoReply } from "@/lib/whatsapp-auto-reply.server";

describe("MercadoImobi chatbot auto reply", () => {
  beforeEach(() => {
    state.insertedMessages.length = 0;
    state.conversationUpdates.length = 0;
    state.settings.enabled = true;
    state.settings.auto_reply = true;
    state.settings.handoff_keywords = ["humano", "corretor"];
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("OPENAI_MODEL", "gpt-5.6");
    vi.stubEnv("EVOLUTION_API_URL", "https://evolution.example.test");
    vi.stubEnv("EVOLUTION_API_KEY", "test-evolution-key");
    vi.stubEnv("EVOLUTION_INSTANCE", "MercadoImobi");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("generates with OpenAI, sends with Evolution and persists the outbound reply", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: "Olá! Posso ajudar com esse imóvel. Qual região você procura?",
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ key: { id: "evolution-msg-1" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const result = await maybeAutoReply({
      tenantId: "7945c497-eafd-4357-a571-0f21b25afa9b",
      conversationId: "11111111-1111-4111-8111-111111111111",
      phone: "5547999999999",
      inboundText: "Olá, tenho interesse no imóvel.",
    });

    expect(result).toEqual({ sent: true, reason: "sent" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.openai.com/v1/responses");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/message/sendText/MercadoImobi");
    expect(state.insertedMessages).toHaveLength(1);
    expect(state.insertedMessages[0]).toMatchObject({
      direction: "outbound",
      status: "sent",
      external_message_id: "evolution-msg-1",
    });
    expect(state.conversationUpdates).toHaveLength(1);
  });

  it("hands off to a person without calling AI or WhatsApp", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await maybeAutoReply({
      tenantId: "7945c497-eafd-4357-a571-0f21b25afa9b",
      conversationId: "11111111-1111-4111-8111-111111111111",
      phone: "5547999999999",
      inboundText: "Quero falar com um corretor humano",
    });

    expect(result).toEqual({ sent: false, reason: "human_handoff" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.insertedMessages).toHaveLength(0);
  });
});
