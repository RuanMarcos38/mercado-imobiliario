import { describe, expect, it } from "vitest";
import { normalizeWhatsAppPhone, whatsappPhoneErrorMessage } from "@/lib/whatsapp-phone";

describe("normalizeWhatsAppPhone", () => {
  it("keeps Brazilian numbers that already contain DDI", () => {
    expect(normalizeWhatsAppPhone("5547999999999")).toBe("5547999999999");
    expect(normalizeWhatsAppPhone("+55 (47) 99999-9999")).toBe("5547999999999");
  });

  it("adds Brazil DDI when the user informs DDD plus number", () => {
    expect(normalizeWhatsAppPhone("47999999999")).toBe("5547999999999");
    expect(normalizeWhatsAppPhone("4733334444")).toBe("554733334444");
  });

  it("rejects local numbers without DDD", () => {
    expect(normalizeWhatsAppPhone("89382274")).toBeNull();
    expect(normalizeWhatsAppPhone("999999999")).toBeNull();
    expect(whatsappPhoneErrorMessage("89382274")).toContain("Número incompleto");
  });

  it("keeps explicit international E.164 numbers", () => {
    expect(normalizeWhatsAppPhone("+14155552671")).toBe("14155552671");
  });
});
