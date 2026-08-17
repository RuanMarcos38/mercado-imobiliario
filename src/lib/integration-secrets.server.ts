import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BUCKET = "integration-secrets";
const MAX_SECRET_SIZE = 512 * 1024;

function keyBytes() {
  const material =
    process.env["INTEGRATIONS_ENCRYPTION_KEY"]?.trim() ||
    process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!material) {
    throw new Error("INTEGRATIONS_ENCRYPTION_KEY_MISSING");
  }
  return createHash("sha256").update(material).digest();
}

async function ensureBucket() {
  const current = await supabaseAdmin.storage.getBucket(BUCKET);
  if (current.data) return;
  const created = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_SECRET_SIZE,
    allowedMimeTypes: ["application/octet-stream"],
  });
  if (created.error && !String(created.error.message).toLowerCase().includes("already")) {
    throw new Error(created.error.message);
  }
}

function safeName(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  return cleaned.replace(/^[-.]+|[-.]+$/g, "").slice(0, 100) || "integration";
}

function secretPath(tenantId: string, userId: string, name: string) {
  return `${tenantId}/${userId}/${safeName(name)}.bin`;
}

function encrypt(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.from(
    JSON.stringify({
      v: 1,
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      data: ciphertext.toString("base64"),
    }),
    "utf8",
  );
}

function decrypt<T>(buffer: Buffer): T {
  const envelope = JSON.parse(buffer.toString("utf8")) as {
    v?: number;
    iv?: string;
    tag?: string;
    data?: string;
  };
  if (envelope.v !== 1 || !envelope.iv || !envelope.tag || !envelope.data) {
    throw new Error("INTEGRATION_SECRET_INVALID");
  }
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

export async function readIntegrationSecret<T>(
  tenantId: string,
  userId: string,
  name: string,
): Promise<T | null> {
  await ensureBucket();
  const result = await supabaseAdmin.storage
    .from(BUCKET)
    .download(secretPath(tenantId, userId, name));
  if (result.error) {
    const message = String(result.error.message ?? "").toLowerCase();
    if (message.includes("not found") || message.includes("object not found")) return null;
    throw new Error(result.error.message);
  }
  const bytes = Buffer.from(await result.data.arrayBuffer());
  return decrypt<T>(bytes);
}

export async function writeIntegrationSecret(
  tenantId: string,
  userId: string,
  name: string,
  value: unknown,
) {
  await ensureBucket();
  const body = encrypt(value);
  if (body.byteLength > MAX_SECRET_SIZE) throw new Error("INTEGRATION_SECRET_TOO_LARGE");
  const result = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(secretPath(tenantId, userId, name), body, {
      contentType: "application/octet-stream",
      upsert: true,
      cacheControl: "0",
    });
  if (result.error) throw new Error(result.error.message);
}

export async function deleteIntegrationSecret(tenantId: string, userId: string, name: string) {
  await ensureBucket();
  const result = await supabaseAdmin.storage
    .from(BUCKET)
    .remove([secretPath(tenantId, userId, name)]);
  if (result.error) throw new Error(result.error.message);
}
