import { randomUUID } from "node:crypto";
import { connect, type TLSSocket } from "node:tls";
import { documentParameters } from "@/lib/platform-parameters.server";

type Attachment = { filename: string; content: string; contentType?: string };
type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  attachments?: Attachment[];
};

const DEFAULT_FROM = "contato@rdmconsultoriaimobiliaria.com.br";
const DEFAULT_SMTP_HOST = "smtp.hostinger.com";
const DEFAULT_SMTP_PORT = 465;

function smtpConfig() {
  const from = process.env["EMAIL_FROM"]?.trim() || DEFAULT_FROM;
  const user = process.env["SMTP_USER"]?.trim() || from;
  const password = process.env["SMTP_PASSWORD"]?.trim() || process.env["SMTP_PASS"]?.trim() || "";
  const host = process.env["SMTP_HOST"]?.trim() || DEFAULT_SMTP_HOST;
  const parsedPort = Number(process.env["SMTP_PORT"]?.trim() || DEFAULT_SMTP_PORT);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : DEFAULT_SMTP_PORT;
  return { configured: Boolean(user && password && from), host, port, user, password, from };
}

export function emailRuntimeStatus() {
  const smtp = smtpConfig();
  const resend = Boolean(process.env["RESEND_API_KEY"]?.trim() && (process.env["EMAIL_FROM"]?.trim() || DEFAULT_FROM));
  return {
    configured: smtp.configured || resend,
    provider: smtp.configured ? "smtp-hostinger" : resend ? "resend" : "none",
    from: smtp.from,
    smtpHost: smtp.host,
    smtpPort: smtp.port,
  } as const;
}

function readResponse(socket: TLSSocket, timeoutMs: number): Promise<{ code: number; raw: string }> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => cleanup(new Error("SMTP_RESPONSE_TIMEOUT")), timeoutMs);
    const onError = (error: Error) => cleanup(error);
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || "";
      const match = last.match(/^(\d{3})\s/);
      if (match) cleanup(null, { code: Number(match[1]), raw: buffer.trim() });
    };
    const cleanup = (error?: Error | null, result?: { code: number; raw: string }) => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      if (error) reject(error);
      else if (result) resolve(result);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function command(socket: TLSSocket, value: string, expected: number[], timeoutMs: number) {
  socket.write(`${value}\r\n`);
  const response = await readResponse(socket, timeoutMs);
  if (!expected.includes(response.code)) {
    throw new Error(`SMTP_${response.code}:${response.raw.slice(0, 240)}`);
  }
  return response;
}

function connectSmtp(host: string, port: number, timeoutMs: number): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port, servername: host, rejectUnauthorized: true });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("SMTP_CONNECT_TIMEOUT"));
    }, timeoutMs);
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function authenticate(socket: TLSSocket, timeoutMs: number) {
  const config = smtpConfig();
  const greeting = await readResponse(socket, timeoutMs);
  if (greeting.code !== 220) throw new Error(`SMTP_${greeting.code}:${greeting.raw.slice(0, 200)}`);
  await command(socket, "EHLO mercadoimobi", [250], timeoutMs);
  await command(socket, "AUTH LOGIN", [334], timeoutMs);
  await command(socket, Buffer.from(config.user).toString("base64"), [334], timeoutMs);
  await command(socket, Buffer.from(config.password).toString("base64"), [235], timeoutMs);
}

function wrapBase64(value: string) {
  return value.replace(/\s+/g, "").match(/.{1,76}/g)?.join("\r\n") || "";
}

function encodeHeader(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function buildMime(input: SendEmailInput, from: string) {
  const boundary = `mi-${randomUUID()}`;
  const lines = [
    `From: ${safeHeader(from)}`,
    `To: ${safeHeader(input.to)}`,
    `Subject: ${encodeHeader(safeHeader(input.subject))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@rdmconsultoriaimobiliaria.com.br>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(input.text, "utf8").toString("base64")),
  ];

  for (const attachment of input.attachments ?? []) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType || "application/octet-stream"}; name="${safeHeader(attachment.filename)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${safeHeader(attachment.filename)}"`,
      "",
      wrapBase64(attachment.content),
    );
  }
  lines.push(`--${boundary}--`, "");
  return lines.join("\r\n").replace(/\r\n\./g, "\r\n..");
}

export async function verifyEmailRuntime() {
  const status = emailRuntimeStatus();
  if (status.provider === "smtp-hostinger") {
    const timeoutMs = documentParameters().emailRequestTimeoutMs;
    const socket = await connectSmtp(status.smtpHost, status.smtpPort, timeoutMs);
    try {
      await authenticate(socket, timeoutMs);
      await command(socket, "QUIT", [221], timeoutMs).catch(() => undefined);
      return { configured: true, ok: true, provider: status.provider, from: status.from };
    } finally {
      socket.end();
      socket.destroy();
    }
  }

  const apiKey = process.env["RESEND_API_KEY"]?.trim();
  if (status.provider === "resend" && apiKey) {
    const response = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": "MercadoImobi/1.0" },
      signal: AbortSignal.timeout(documentParameters().emailRequestTimeoutMs),
    });
    return { configured: true, ok: response.ok, provider: status.provider, from: status.from, httpStatus: response.status };
  }

  return { configured: false, ok: false, provider: "none" as const, from: status.from };
}

export async function sendEmail(input: SendEmailInput) {
  const status = emailRuntimeStatus();
  if (status.provider === "smtp-hostinger") {
    const timeoutMs = documentParameters().emailRequestTimeoutMs;
    const socket = await connectSmtp(status.smtpHost, status.smtpPort, timeoutMs);
    try {
      await authenticate(socket, timeoutMs);
      await command(socket, `MAIL FROM:<${status.from}>`, [250], timeoutMs);
      await command(socket, `RCPT TO:<${safeHeader(input.to)}>`, [250, 251], timeoutMs);
      await command(socket, "DATA", [354], timeoutMs);
      socket.write(`${buildMime(input, status.from)}\r\n.\r\n`);
      const accepted = await readResponse(socket, timeoutMs);
      if (accepted.code !== 250) throw new Error(`SMTP_${accepted.code}:${accepted.raw.slice(0, 240)}`);
      await command(socket, "QUIT", [221], timeoutMs).catch(() => undefined);
      return { provider: status.provider, id: accepted.raw, from: status.from };
    } finally {
      socket.end();
      socket.destroy();
    }
  }

  const apiKey = process.env["RESEND_API_KEY"]?.trim();
  if (status.provider === "resend" && apiKey) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "MercadoImobi/1.0",
      },
      body: JSON.stringify({ from: status.from, to: [input.to], subject: input.subject, text: input.text, attachments: input.attachments ?? [] }),
      signal: AbortSignal.timeout(documentParameters().emailRequestTimeoutMs),
    });
    const raw = await response.text();
    let payload: any = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { raw };
    }
    if (!response.ok) throw new Error(`EMAIL_SEND_FAILED:${response.status}:${String(payload?.message ?? payload?.raw ?? "").slice(0, 220)}`);
    return { provider: status.provider, id: payload?.id ? String(payload.id) : null, from: status.from };
  }

  throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
}
