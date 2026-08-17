import { afterEach, describe, expect, it } from "vitest";
import {
  createLeadWebhookSignature,
  normalizeLeadPayload,
  verifyLeadWebhookSignature,
} from "@/lib/lead-operations.server";

const originalSecret = process.env["LEAD_WEBHOOK_SECRET"];

afterEach(() => {
  if (originalSecret === undefined) delete process.env["LEAD_WEBHOOK_SECRET"];
  else process.env["LEAD_WEBHOOK_SECRET"] = originalSecret;
});

describe("Speed to Lead", () => {
  it("normaliza payload de formulário Meta/Lead Ads", () => {
    const lead = normalizeLeadPayload(
      {
        leadgen_id: "meta-123",
        campaign_name: "Lançamento Joinville",
        field_data: [
          { name: "full_name", values: ["Maria Souza"] },
          { name: "phone_number", values: ["(47) 99999-9999"] },
          { name: "email", values: ["maria@example.com"] },
        ],
      },
      "meta",
    );

    expect(lead.source).toBe("meta");
    expect(lead.externalId).toBe("meta-123");
    expect(lead.name).toBe("Maria Souza");
    expect(lead.phone).toBe("5547999999999");
    expect(lead.email).toBe("maria@example.com");
    expect(lead.campaign).toBe("Lançamento Joinville");
  });

  it("normaliza payload simples de landing page", () => {
    const lead = normalizeLeadPayload(
      {
        external_id: "lp-99",
        nome: "João Cliente",
        telefone: "47988887777",
        empreendimento: "Residencial Centro",
      },
      "landing-page",
    );

    expect(lead.source).toBe("landing-page");
    expect(lead.phone).toBe("5547988887777");
    expect(lead.propertyReference).toBe("Residencial Centro");
  });

  it("assina cada endpoint por tenant e origem", () => {
    process.env["LEAD_WEBHOOK_SECRET"] = "speed-to-lead-test-secret";
    const tenantId = "11111111-1111-4111-8111-111111111111";
    const signature = createLeadWebhookSignature(tenantId, "meta");

    expect(verifyLeadWebhookSignature(tenantId, "meta", signature)).toBe(true);
    expect(verifyLeadWebhookSignature(tenantId, "google", signature)).toBe(false);
  });
});
