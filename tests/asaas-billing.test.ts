import { describe, expect, it } from "vitest";
import { __asaasBillingTestUtils } from "@/lib/asaas-billing.server";

describe("Asaas billing helpers", () => {
  it("round-trips MercadoImobi external references", () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const planId = "22222222-2222-4222-8222-222222222222";
    const reference = __asaasBillingTestUtils.buildAsaasExternalReference(userId, planId);
    expect(reference).toBe(`mercadoimobi:${userId}:${planId}`);
    expect(__asaasBillingTestUtils.parseAsaasExternalReference(reference)).toEqual({ userId, planId });
  });

  it("rejects foreign references", () => {
    expect(__asaasBillingTestUtils.parseAsaasExternalReference("pedido-123")).toBeNull();
    expect(__asaasBillingTestUtils.parseAsaasExternalReference(null)).toBeNull();
  });

  it("adds onboarding only to the first cycle amount", () => {
    expect(
      __asaasBillingTestUtils.asaasFirstCycleValue({
        id: "22222222-2222-4222-8222-222222222222",
        slug: "pro_ia",
        name: "Corretor Pro IA",
        price_monthly: 397,
        onboarding_fee: 497,
      }),
    ).toBe(894);
  });
});
