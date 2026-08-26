import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  eventInserts: [] as Array<Record<string, unknown>>,
  insertedMessages: [] as Array<Record<string, unknown>>,
  conversationUpdates: [] as Array<Record<string, unknown>>,
  sentTexts: [] as Array<Record<string, unknown>>,
  instanceName: "mercadoimobi-test",
}));

function metadata(event: Record<string, unknown>) {
  const value = event["metadata"];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function systemEventsQuery() {
  const equals = new Map<string, unknown>();
  let eventTypes: string[] | null = null;
  const builder: Record<string, unknown> & PromiseLike<{ data: unknown[]; error: null }> = {
    select() {
      return builder;
    },
    eq(column: string, value: unknown) {
      equals.set(column, value);
      return builder;
    },
    in(column: string, values: string[]) {
      if (column === "event_type") eventTypes = values;
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return Promise.resolve({ data: filteredEvents(), error: null }) as never;
    },
    insert(value: Record<string, unknown>) {
      const createdAt =
        String(metadata(value)["requestedAt"] ?? metadata(value)["respondedAt"] ?? "") ||
        new Date().toISOString();
      const event = { ...value, created_at: createdAt };
      state.eventInserts.push(value);
      state.events.unshift(event);
      return Promise.resolve({ error: null });
    },
    then(resolve, reject) {
      return Promise.resolve({ data: filteredEvents(), error: null }).then(resolve, reject);
    },
  };

  function filteredEvents() {
    return state.events.filter((event) => {
      for (const [column, value] of equals) {
        if (event[column] !== value) return false;
      }
      if (eventTypes && !eventTypes.includes(String(event["event_type"]))) return false;
      return true;
    });
  }

  return builder;
}

const fakeDb = vi.hoisted(() => ({
  from(table: string) {
    if (table === "system_events") return systemEventsQuery();
    if (table === "whatsapp_messages") {
      return {
        insert(value: Record<string, unknown>) {
          state.insertedMessages.push(value);
          return Promise.resolve({ error: null });
        },
      };
    }
    if (table === "whatsapp_conversations") {
      const builder = {
        update(value: Record<string, unknown>) {
          state.conversationUpdates.push(value);
          return builder;
        },
        eq() {
          return builder;
        },
      };
      return builder;
    }
    return {};
  },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: fakeDb,
}));

vi.mock("@/lib/evolution-instance.server", () => ({
  getTenantEvolutionInstance: vi.fn(async () => state.instanceName),
}));

vi.mock("@/lib/evolution-text.server", () => ({
  sendEvolutionTextMessage: vi.fn(async (input: Record<string, unknown>) => {
    state.sentTexts.push(input);
    return { key: { id: "survey-message-1" } };
  }),
}));

import {
  ATTENDANCE_SATISFACTION_SURVEY_TEXT,
  captureAttendanceSatisfactionResponse,
  parseAttendanceSatisfactionRating,
  sendAttendanceSatisfactionSurvey,
} from "@/lib/attendance-satisfaction.server";

describe("attendance satisfaction survey", () => {
  beforeEach(() => {
    state.events.length = 0;
    state.eventInserts.length = 0;
    state.insertedMessages.length = 0;
    state.conversationUpdates.length = 0;
    state.sentTexts.length = 0;
    state.instanceName = "mercadoimobi-test";
  });

  it("accepts only a satisfaction score from 1 to 5", () => {
    expect(parseAttendanceSatisfactionRating("5")).toBe(5);
    expect(parseAttendanceSatisfactionRating("nota 4/5")).toBe(4);
    expect(parseAttendanceSatisfactionRating("10")).toBeNull();
    expect(parseAttendanceSatisfactionRating("quero falar com corretor")).toBeNull();
  });

  it("sends the satisfaction message when attendance is closed", async () => {
    const result = await sendAttendanceSatisfactionSurvey({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      sessionId: "session-1",
      attendantUserId: "user-1",
      phone: "47 99999-9999",
      protocolCode: "MI-1",
    });

    expect(result.sent).toBe(true);
    expect(state.sentTexts[0]).toMatchObject({
      phone: "5547999999999",
      text: ATTENDANCE_SATISFACTION_SURVEY_TEXT,
      instanceName: "mercadoimobi-test",
    });
    expect(state.insertedMessages[0]).toMatchObject({
      direction: "outbound",
      message_type: "text",
      body: ATTENDANCE_SATISFACTION_SURVEY_TEXT,
    });
    expect(state.conversationUpdates[0]).toMatchObject({
      last_message: ATTENDANCE_SATISFACTION_SURVEY_TEXT,
    });
    expect(
      state.eventInserts.some(
        (event) => event["event_type"] === "attendance_satisfaction_requested",
      ),
    ).toBe(true);
  });

  it("captures a pending 1-to-5 reply without creating an AI turn", async () => {
    state.events.push({
      tenant_id: "tenant-1",
      event_type: "attendance_satisfaction_requested",
      created_at: new Date().toISOString(),
      metadata: {
        conversationId: "conversation-1",
        sessionId: "session-1",
        attendantUserId: "user-1",
        requestedAt: new Date().toISOString(),
      },
    });

    const result = await captureAttendanceSatisfactionResponse({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
      inboundText: "5",
      inboundExternalMessageId: "client-message-1",
      inboundSentAt: new Date().toISOString(),
    });

    expect(result).toEqual({ captured: true, rating: 5 });
    expect(state.eventInserts.at(-1)).toMatchObject({
      event_type: "attendance_satisfaction_answered",
      metadata: expect.objectContaining({
        conversationId: "conversation-1",
        rating: 5,
        responseMessageId: "client-message-1",
      }),
    });
  });
});
