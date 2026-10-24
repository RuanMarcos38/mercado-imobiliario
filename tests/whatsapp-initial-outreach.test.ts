import { beforeEach, expect, it, vi } from "vitest";
import { JOINVILLE_PRESENTATION } from "@/lib/whatsapp-templates.core";
import { sendInitialJoinvillePresentation } from "@/lib/whatsapp-initial-outreach.server";
import { listMetaWhatsAppTemplates, sendMetaWhatsAppApprovedTemplate, type MetaWhatsAppConfig } from "@/lib/meta-whatsapp.server";

vi.mock("@/lib/meta-whatsapp.server", () => ({
  testMetaWhatsAppConfig: vi.fn(async () => ({ ok: true, businessAccountMatched: true, displayPhoneNumber: "+55 47 99623-8649" })),
  listMetaWhatsAppTemplates: vi.fn(), sendMetaWhatsAppApprovedTemplate: vi.fn(),
  extractMetaWhatsAppMessageId: (p: any) => p.messages?.[0]?.id ?? null,
}));
const config = {} as MetaWhatsAppConfig;
function database(authorized = true) {
  let reserved = false;
  const updates: unknown[] = [];
  return { updates, rpc: vi.fn(async () => {
    if (!authorized) return { error: { message: "CONTACT_PERMISSION_REQUIRED" } };
    if (reserved) return { data: null };
    reserved = true; return { data: "reservation-id" };
  }), from: (table: string) => {
    const result = { data: table === "whatsapp_messages" ? [] : [{ id: "conversation-id" }], error: null };
    const chain: any = { select: () => chain, eq: () => chain, in: () => chain,
      update: (value: unknown) => { updates.push(value); return chain; },
      insert: async () => ({ error: null }),
      maybeSingle: async () => ({ data: { phone_e164: "5547996238649", contact_name: "Ruan Marcos" }, error: null }),
      then: (resolve: (value: unknown) => void) => Promise.resolve(result).then(resolve),
    }; return chain;
  } };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listMetaWhatsAppTemplates).mockResolvedValue([{ name: "ruan_joinville_mcmv_apresentacao_v1", language: "pt_BR", status: "APPROVED", components: [{ type: "BODY", text: JOINVILLE_PRESENTATION.replaceAll("{{primeiro_nome}}", "{{1}}") }] }]);
  vi.mocked(sendMetaWhatsAppApprovedTemplate).mockResolvedValue({ messages: [{ id: "wamid.test" }] });
});
it("reserves atomically before sending and blocks concurrent duplicates", async () => {
  const db = database(); const input = { db, tenantId: "tenant-a", conversationId: "conversation-id", config };
  const results = await Promise.all([sendInitialJoinvillePresentation(input), sendInitialJoinvillePresentation(input)]);
  expect(results.map(r => r.status).sort()).toEqual(["already_reserved", "sent"]);
  expect(sendMetaWhatsAppApprovedTemplate).toHaveBeenCalledTimes(1);
});
it("does not send without validated consent or approval", async () => {
  await expect(sendInitialJoinvillePresentation({ db: database(false), tenantId: "tenant-a", conversationId: "conversation-id", config })).rejects.toThrow("autorização");
  vi.mocked(listMetaWhatsAppTemplates).mockResolvedValue([]);
  await expect(sendInitialJoinvillePresentation({ db: database(), tenantId: "tenant-a", conversationId: "conversation-id", config })).rejects.toThrow("aprovada");
  expect(sendMetaWhatsAppApprovedTemplate).not.toHaveBeenCalled();
});
it("keeps the reservation after an uncertain response instead of retrying", async () => {
  const db = database(); const input = { db, tenantId: "tenant-a", conversationId: "conversation-id", config };
  vi.mocked(sendMetaWhatsAppApprovedTemplate).mockRejectedValue(new Error("timeout"));
  await expect(sendInitialJoinvillePresentation(input)).rejects.toThrow("Reenvio bloqueado");
  expect(await sendInitialJoinvillePresentation(input)).toEqual({ status: "already_reserved" });
  expect(db.updates).toContainEqual({ status: "uncertain" });
  expect(sendMetaWhatsAppApprovedTemplate).toHaveBeenCalledTimes(1);
});
