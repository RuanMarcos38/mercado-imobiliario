import { afterEach, describe, expect, it, vi } from "vitest";
import {
  metaWhatsAppEnvAllowedForTenant,
  shouldUseMetaWhatsApp,
  type TenantWhatsAppConnection,
} from "@/lib/whatsapp-provider.server";

describe("WhatsApp provider tenant isolation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps an explicit Evolution tenant isolated even when Meta env credentials exist", () => {
    vi.stubEnv("WHATSAPP_PROVIDER", "auto");
    vi.stubEnv("META_WHATSAPP_ACCESS_TOKEN", "shared-server-token");
    vi.stubEnv("META_WHATSAPP_PHONE_NUMBER_ID", "999999999");
    vi.stubEnv("META_WHATSAPP_DEFAULT_TENANT_ID", "tenant-mercadoimobi");

    const connection: TenantWhatsAppConnection = {
      tenant_id: "tenant-evolution",
      provider: "evolution",
      instance_name: "tenant-evolution-instance",
    };

    expect(shouldUseMetaWhatsApp(connection, "tenant-evolution")).toBe(false);
  });

  it("keeps an explicit Meta tenant on Meta regardless of another server default", () => {
    vi.stubEnv("WHATSAPP_PROVIDER", "auto");
    vi.stubEnv("META_WHATSAPP_ACCESS_TOKEN", "shared-server-token");
    vi.stubEnv("META_WHATSAPP_PHONE_NUMBER_ID", "999999999");
    vi.stubEnv("META_WHATSAPP_DEFAULT_TENANT_ID", "another-tenant");

    const connection: TenantWhatsAppConnection = {
      tenant_id: "tenant-mercadoimobi",
      provider: "meta",
      provider_phone_number_id: "1369868062866539",
      phone_number: "+55 47 9623-8649",
    };

    expect(shouldUseMetaWhatsApp(connection, "tenant-mercadoimobi")).toBe(true);
  });

  it("allows server Meta credentials only for the explicitly assigned default tenant", () => {
    vi.stubEnv("WHATSAPP_PROVIDER", "auto");
    vi.stubEnv("META_WHATSAPP_ACCESS_TOKEN", "server-token");
    vi.stubEnv("META_WHATSAPP_PHONE_NUMBER_ID", "1369868062866539");
    vi.stubEnv("META_WHATSAPP_DEFAULT_TENANT_ID", "tenant-mercadoimobi");

    expect(metaWhatsAppEnvAllowedForTenant("tenant-mercadoimobi")).toBe(true);
    expect(metaWhatsAppEnvAllowedForTenant("tenant-errejota")).toBe(false);
    expect(shouldUseMetaWhatsApp(null, "tenant-mercadoimobi")).toBe(true);
    expect(shouldUseMetaWhatsApp(null, "tenant-errejota")).toBe(false);
  });

  it("never lets unscoped Meta environment credentials leak into another tenant", () => {
    vi.stubEnv("WHATSAPP_PROVIDER", "meta");
    vi.stubEnv("META_WHATSAPP_ACCESS_TOKEN", "server-token");
    vi.stubEnv("META_WHATSAPP_PHONE_NUMBER_ID", "999999999");
    vi.stubEnv("META_WHATSAPP_DEFAULT_TENANT_ID", "");

    expect(metaWhatsAppEnvAllowedForTenant("tenant-mercadoimobi")).toBe(false);
    expect(shouldUseMetaWhatsApp(null, "tenant-mercadoimobi")).toBe(false);
    expect(shouldUseMetaWhatsApp(null, "tenant-errejota")).toBe(false);
  });
});
