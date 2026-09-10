import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createMetaOAuthState,
  getMetaOAuthUrl,
  verifyMetaOAuthState,
} from "@/lib/meta-social.server";
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
    expect(url).toContain("pages_read_user_content");
    expect(url).toContain("pages_manage_engagement");
    expect(url).toContain("instagram_manage_messages");
    expect(url).toContain("instagram_manage_comments");
    expect(url).toContain(
      encodeURIComponent("https://mercadoimobi.example.com/api/public/oauth/meta"),
    );
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
    const socialServer = readFileSync("src/lib/meta-social.server.ts", "utf8");
    const whatsappProvider = readFileSync("src/lib/whatsapp-provider.server.ts", "utf8");
    const email = readFileSync("src/routes/_authenticated/email-cca.tsx", "utf8");
    const dialer = readFileSync("src/routes/_authenticated/discador.tsx", "utf8");
    const diagnostics = readFileSync("src/routes/_authenticated/diagnostico.tsx", "utf8");

    expect(env).toContain("META_APP_SECRET=");
    expect(env).toContain("instagram_manage_comments");
    expect(env).toContain("pages_read_user_content");
    expect(env).toContain("META_WHATSAPP_ACCESS_TOKEN=");
    expect(env).toContain("META_WHATSAPP_VERIFY_TOKEN=");
    expect(env).toContain("RESEND_API_KEY=");
    expect(env).toContain("TWILIO_AUTH_TOKEN=");
    expect(env).not.toContain("VITE_META_APP_SECRET");
    expect(env).not.toContain("VITE_META_WHATSAPP_ACCESS_TOKEN");
    expect(env).not.toContain("VITE_META_WHATSAPP_VERIFY_TOKEN");
    expect(env).not.toContain("VITE_RESEND_API_KEY");
    expect(nav).toContain('label: "Facebook / Instagram"');
    expect(nav).not.toContain('label: "E-mail / CCA"');
    expect(nav).not.toContain('label: "Discador"');
    expect(nav).toContain('to: "/diagnostico"');
    expect(nav).toContain('to: "/midias-sociais"');
    expect(social).toContain("Atendimento Facebook e Instagram");
    expect(social).toContain("Conectar Facebook e Instagram");
    expect(social).toContain("IA de comentários");
    expect(socialServer).toContain("scanMetaSocialComments");
    expect(socialServer).toContain("/private_replies");
    expect(socialServer).toContain("recipient: { comment_id");
    expect(socialServer).toContain(
      "https://graph.facebook.com/${encodeURIComponent(page.pageId)}/messages",
    );
    expect(whatsappProvider).toContain("Token oficial da Meta expirado ou inválido.");
    expect(email).toContain("Enviar documentação por e-mail");
    expect(dialer).toContain("Ligar para o cliente");
    expect(diagnostics).toContain("Testar tudo agora");
  });
});
