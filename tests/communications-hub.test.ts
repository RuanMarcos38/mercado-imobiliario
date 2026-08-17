import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createMetaOAuthState, getMetaOAuthUrl, verifyMetaOAuthState } from "@/lib/meta-social.server";
import { createVoiceBridgeToken, verifyVoiceBridgeToken } from "@/lib/dialer.functions";

describe("MercadoImobi communication hub security", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("signs and validates Meta OAuth state per tenant/user", () => {
    vi.stubEnv("META_APP_ID", "123456789");
    vi.stubEnv("META_APP_SECRET", "meta-test-secret");
    vi.stubEnv("META_OAUTH_STATE_SECRET", "state-test-secret");
    vi.stubEnv("MERCADOIMOBI_BASE_URL", "https://mercadoimobi.example.com");
    const state = createMetaOAuthState({ tenantId: "tenant-a", userId: "user-a" });
    expect(verifyMetaOAuthState(state)).toEqual({ tenantId: "tenant-a", userId: "user-a" });
    const url = getMetaOAuthUrl({ tenantId: "tenant-a", userId: "user-a" });
    expect(url).toContain("facebook.com/dialog/oauth");
    expect(url).toContain("pages_messaging");
    expect(url).toContain("instagram_manage_messages");
    expect(url).toContain(encodeURIComponent("https://mercadoimobi.example.com/api/public/oauth/meta"));
  });

  it("rejects tampered voice bridge tokens", () => {
    vi.stubEnv("VOICE_WEBHOOK_SECRET", "voice-test-secret");
    const token = createVoiceBridgeToken("47999999999");
    expect(verifyVoiceBridgeToken(token).to).toBe("+5547999999999");
    expect(() => verifyVoiceBridgeToken(`${token}x`)).toThrow();
  });

  it("keeps the new communication credentials server-side", () => {
    const env = readFileSync(".env.example", "utf8");
    const nav = readFileSync("src/routes/_authenticated.tsx", "utf8");
    const social = readFileSync("src/routes/_authenticated/midias-sociais.tsx", "utf8");
    const email = readFileSync("src/routes/_authenticated/email-cca.tsx", "utf8");
    const dialer = readFileSync("src/routes/_authenticated/discador.tsx", "utf8");
    const diagnostics = readFileSync("src/routes/_authenticated/diagnostico.tsx", "utf8");

    expect(env).toContain("META_APP_SECRET=");
    expect(env).toContain("RESEND_API_KEY=");
    expect(env).toContain("TWILIO_AUTH_TOKEN=");
    expect(env).not.toContain("VITE_META_APP_SECRET");
    expect(env).not.toContain("VITE_RESEND_API_KEY");
    expect(nav).toContain('to: "/midias-sociais"');
    expect(nav).toContain('to: "/email-cca"');
    expect(nav).toContain('to: "/discador"');
    expect(nav).toContain('to: "/diagnostico"');
    expect(social).toContain("Conectar Facebook e Instagram");
    expect(email).toContain("Enviar documentação por e-mail");
    expect(dialer).toContain("Ligar para o cliente");
    expect(diagnostics).toContain("Testar tudo agora");
  });
});
