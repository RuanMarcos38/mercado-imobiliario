import { afterEach, describe, expect, it } from "vitest";
import {
  aiParameters,
  documentParameters,
  externalServiceParameters,
  integrationReadiness,
  speedToLeadParameters,
  whatsappParameters,
} from "@/lib/platform-parameters.server";

const KEYS = [
  "SPEED_TO_LEAD_SLA_SECONDS",
  "SPEED_TO_LEAD_METRICS_DAYS",
  "LEAD_DISTRIBUTION_LOOKBACK_HOURS",
  "AI_HISTORY_MESSAGES",
  "AI_REQUEST_TIMEOUT_MS",
  "WHATSAPP_ATTACHMENT_MAX_MB",
  "WHATSAPP_SEND_DELAY_MS",
  "CCA_DOCUMENT_MAX_MB",
  "CCA_SIGNED_URL_TTL_SECONDS",
  "STRIPE_REQUEST_TIMEOUT_MS",
  "VOICE_BRIDGE_TOKEN_MINUTES",
  "EVOLUTION_API_URL",
  "EVOLUTION_API_KEY",
  "EVOLUTION_URL",
  "EVOLUTION_GLOBAL_API_KEY",
  "AUTHENTICATION_API_KEY",
] as const;

const originals = new Map(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    const value = originals.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("platform parameters", () => {
  it("uses backward-compatible safe defaults", () => {
    for (const key of KEYS) delete process.env[key];

    expect(speedToLeadParameters()).toMatchObject({
      slaSeconds: 300,
      metricsDays: 7,
      distributionLookbackHours: 24,
    });
    expect(aiParameters()).toMatchObject({ requestTimeoutMs: 30000, historyMessages: 20 });
    expect(whatsappParameters()).toMatchObject({ sendDelayMs: 800, maxAttachmentMb: 8 });
    expect(documentParameters()).toMatchObject({
      ccaDocumentMaxMb: 12,
      ccaSignedUrlTtlSeconds: 900,
    });
    expect(externalServiceParameters()).toMatchObject({
      stripeTimeoutMs: 20000,
      voiceBridgeTokenMinutes: 5,
    });
  });

  it("applies configured values without code changes", () => {
    process.env["SPEED_TO_LEAD_SLA_SECONDS"] = "420";
    process.env["SPEED_TO_LEAD_METRICS_DAYS"] = "14";
    process.env["LEAD_DISTRIBUTION_LOOKBACK_HOURS"] = "48";
    process.env["AI_HISTORY_MESSAGES"] = "33";
    process.env["AI_REQUEST_TIMEOUT_MS"] = "45000";
    process.env["WHATSAPP_ATTACHMENT_MAX_MB"] = "10";
    process.env["WHATSAPP_SEND_DELAY_MS"] = "1200";
    process.env["CCA_DOCUMENT_MAX_MB"] = "18";
    process.env["CCA_SIGNED_URL_TTL_SECONDS"] = "1800";
    process.env["STRIPE_REQUEST_TIMEOUT_MS"] = "30000";
    process.env["VOICE_BRIDGE_TOKEN_MINUTES"] = "8";

    expect(speedToLeadParameters()).toMatchObject({
      slaSeconds: 420,
      metricsDays: 14,
      distributionLookbackHours: 48,
    });
    expect(aiParameters()).toMatchObject({ requestTimeoutMs: 45000, historyMessages: 33 });
    expect(whatsappParameters()).toMatchObject({ sendDelayMs: 1200, maxAttachmentMb: 10 });
    expect(documentParameters()).toMatchObject({
      ccaDocumentMaxMb: 18,
      ccaSignedUrlTtlSeconds: 1800,
    });
    expect(externalServiceParameters()).toMatchObject({
      stripeTimeoutMs: 30000,
      voiceBridgeTokenMinutes: 8,
    });
  });

  it("clamps unsafe or unreasonable values", () => {
    process.env["SPEED_TO_LEAD_SLA_SECONDS"] = "1";
    process.env["SPEED_TO_LEAD_METRICS_DAYS"] = "1000";
    process.env["AI_HISTORY_MESSAGES"] = "999";
    process.env["WHATSAPP_ATTACHMENT_MAX_MB"] = "999";
    process.env["CCA_DOCUMENT_MAX_MB"] = "0";
    process.env["VOICE_BRIDGE_TOKEN_MINUTES"] = "999";

    expect(speedToLeadParameters().slaSeconds).toBe(30);
    expect(speedToLeadParameters().metricsDays).toBe(90);
    expect(aiParameters().historyMessages).toBe(100);
    expect(whatsappParameters().maxAttachmentMb).toBe(32);
    expect(documentParameters().ccaDocumentMaxMb).toBe(1);
    expect(externalServiceParameters().voiceBridgeTokenMinutes).toBe(30);
  });

  it("recognizes EasyPanel/Evolution gateway aliases", () => {
    process.env["EVOLUTION_API_URL"] = "";
    process.env["EVOLUTION_API_KEY"] = "";
    process.env["EVOLUTION_URL"] = "https://evolution.example.test";
    process.env["AUTHENTICATION_API_KEY"] = "gateway-key";

    const whatsapp = integrationReadiness().find((item) => item.key === "whatsapp");

    expect(whatsapp?.configured).toBe(true);
  });
});
