import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(path, "utf8");

describe("WhatsApp media experience", () => {
  it("records voice messages from the browser without changing the attendance structure", () => {
    const atendimento = source("src/routes/_authenticated/atendimento.tsx");
    expect(atendimento).toContain("navigator.mediaDevices.getUserMedia({ audio: true })");
    expect(atendimento).toContain("new MediaRecorder");
    expect(atendimento).toContain("Gravar mensagem de voz");
    expect(atendimento).toContain("Gravando");
    expect(atendimento).toContain("Cancelar gravação");
    expect(atendimento).toContain("audio/webm");
    expect(atendimento).toContain("WhatsAppMessageMedia");
    expect(atendimento).toContain("AttendanceDistributionPanel");
  });

  it("sends voice notes through the Evolution WhatsApp audio endpoint", () => {
    const evolution = source("src/lib/evolution-media.server.ts");
    expect(evolution).toContain("sendEvolutionWhatsAppAudioMessage");
    expect(evolution).toContain("/message/sendWhatsAppAudio/");
    expect(evolution).toContain('form.append("encoding", "true")');
    expect(evolution).toContain('form.append("file"');
  });

  it("persists sent media privately and signs it only when displaying the conversation", () => {
    const media = source("src/lib/whatsapp-media.functions.ts");
    const tenant = source("src/lib/whatsapp-tenant.functions.ts");
    const migration = source("supabase/migrations/20260825163500_whatsapp_media_storage.sql");
    expect(media).toContain('WHATSAPP_MEDIA_BUCKET = "whatsapp-media"');
    expect(media).toContain("storage.upload");
    expect(media).toContain("storage://");
    expect(media).toContain('message_type: mediaType');
    expect(tenant).toContain("createSignedUrl(storagePath, 60 * 60)");
    expect(tenant).toContain("media_file_name");
    expect(tenant).toContain("media_mime_type");
    expect(migration).toContain("'whatsapp-media'");
    expect(migration).toContain("false");
    expect(migration).toContain("8388608");
  });

  it("renders images, videos, audio and documents inside WhatsApp-style bubbles", () => {
    const mediaUi = source("src/components/attendance/WhatsAppMessageMedia.tsx");
    expect(mediaUi).toContain("<img");
    expect(mediaUi).toContain("<video controls");
    expect(mediaUi).toContain("<audio controls");
    expect(mediaUi).toContain("<FileText");
    expect(mediaUi).toContain('target="_blank"');
  });
});
