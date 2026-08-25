from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}, found {count}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


Path("src/lib/evolution-media.server.ts").write_text(
    '''type JsonObject = Record<string, unknown>;

function evolutionGatewayConfig() {
  const baseUrl = process.env["EVOLUTION_API_URL"]?.trim().replace(/\\/$/, "");
  const apiKey = process.env["EVOLUTION_API_KEY"]?.trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

function parsePayload(raw: string): JsonObject {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as JsonObject) : { value: parsed };
  } catch {
    return { raw: raw.slice(0, 1000) };
  }
}

function responseMessage(payload: JsonObject): string {
  const response = payload["response"];
  if (response && typeof response === "object") {
    const message = (response as JsonObject)["message"];
    if (Array.isArray(message)) return message.flat(Infinity).map(String).join("; ").slice(0, 500);
    if (typeof message === "string") return message.slice(0, 500);
  }
  if (typeof payload["message"] === "string") return String(payload["message"]).slice(0, 500);
  if (typeof payload["error"] === "string") return String(payload["error"]).slice(0, 500);
  return "Falha desconhecida da Evolution API";
}

function normalizedBase64(value: string) {
  return value.replace(/^data:[^;]+;base64,/, "").replace(/\\s+/g, "").trim();
}

function base64Bytes(value: string) {
  const clean = normalizedBase64(value);
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export type EvolutionMediaType = "image" | "video" | "document";

export async function sendEvolutionMediaMessage(input: {
  phone: string;
  mediaType: EvolutionMediaType;
  mimeType: string;
  fileName: string;
  base64: string;
  caption?: string;
  instanceName: string;
}): Promise<JsonObject> {
  const config = evolutionGatewayConfig();
  if (!config) throw new Error("WHATSAPP_NOT_CONFIGURED");

  const endpoint = `${config.baseUrl}/message/sendMedia/${encodeURIComponent(input.instanceName)}`;
  const body: JsonObject = {
    number: input.phone,
    mediatype: input.mediaType,
    mimetype: input.mimeType,
    media: normalizedBase64(input.base64),
    fileName: input.fileName,
    caption: input.caption?.trim() || "",
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const raw = await response.text();
  const payload = parsePayload(raw);
  if (response.ok) return payload;

  throw new Error(`EVOLUTION_MEDIA_FAILED:${response.status}:${responseMessage(payload)}`);
}

export async function sendEvolutionWhatsAppAudioMessage(input: {
  phone: string;
  mimeType: string;
  fileName: string;
  base64: string;
  instanceName: string;
}): Promise<JsonObject> {
  const config = evolutionGatewayConfig();
  if (!config) throw new Error("WHATSAPP_NOT_CONFIGURED");

  const bytes = base64Bytes(input.base64);
  if (!bytes.byteLength) throw new Error("AUDIO_EMPTY");
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const form = new FormData();
  form.append("number", input.phone);
  form.append("encoding", "true");
  form.append("file", new Blob([buffer], { type: input.mimeType || "audio/webm" }), input.fileName);

  const endpoint = `${config.baseUrl}/message/sendWhatsAppAudio/${encodeURIComponent(input.instanceName)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { apikey: config.apiKey },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const raw = await response.text();
  const payload = parsePayload(raw);
  if (response.ok) return payload;

  throw new Error(`EVOLUTION_AUDIO_FAILED:${response.status}:${responseMessage(payload)}`);
}
''',
    encoding="utf-8",
)

Path("src/lib/whatsapp-media.functions.ts").write_text(
    '''import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  evolutionGatewayConfig,
  getTenantEvolutionInstance,
} from "@/lib/evolution-instance.server";
import {
  sendEvolutionMediaMessage,
  sendEvolutionWhatsAppAudioMessage,
  type EvolutionMediaType,
} from "@/lib/evolution-media.server";
import { requireTenantId } from "@/lib/tenant.server";
import { normalizeWhatsAppPhone, whatsappPhoneErrorMessage } from "@/lib/whatsapp-phone";
import { whatsappParameters } from "@/lib/platform-parameters.server";

const WHATSAPP_MEDIA_BUCKET = "whatsapp-media";

const mediaSchema = z.object({
  conversationId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().min(1).max(120),
  base64: z.string().min(1),
  caption: z.string().trim().max(1024).optional(),
});

function mediaTypeFromMime(mimeType: string): EvolutionMediaType {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

function normalizedBase64(value: string) {
  return value.replace(/^data:[^;]+;base64,/, "").replace(/\\s+/g, "").trim();
}

function base64Bytes(value: string) {
  const clean = normalizedBase64(value);
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function safeFileName(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-120);
  return normalized || "arquivo";
}

export const sendWhatsAppAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => mediaSchema.parse(data))
  .handler(async ({ data, context }) => {
    const parameters = whatsappParameters();
    const bytes = base64Bytes(data.base64);
    const maxBytes = parameters.maxAttachmentMb * 1024 * 1024;
    if (!bytes.byteLength || bytes.byteLength > maxBytes) {
      throw new Error(`O arquivo deve ter no máximo ${parameters.maxAttachmentMb} MB.`);
    }

    const tenantId = await requireTenantId(context.supabase, context.userId);
    const db = context.supabase as any;
    const instanceName = await getTenantEvolutionInstance(db, tenantId);
    if (!instanceName || !evolutionGatewayConfig()) throw new Error("WHATSAPP_NOT_CONFIGURED");

    const { data: conversation, error } = await db
      .from("whatsapp_conversations")
      .select("id,phone_e164")
      .eq("id", data.conversationId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!conversation) throw new Error("Conversa não encontrada.");

    const phone = normalizeWhatsAppPhone(String(conversation.phone_e164 ?? ""));
    if (!phone) throw new Error(whatsappPhoneErrorMessage(String(conversation.phone_e164 ?? "")));

    const isAudio = data.mimeType.toLowerCase().startsWith("audio/");
    const mediaType = isAudio ? "audio" : mediaTypeFromMime(data.mimeType);
    const storagePath = `${tenantId}/${conversation.id}/${Date.now()}-${crypto.randomUUID()}-${safeFileName(data.fileName)}`;
    const storage = supabaseAdmin.storage.from(WHATSAPP_MEDIA_BUCKET);
    const { error: storageError } = await storage.upload(storagePath, bytes, {
      contentType: data.mimeType,
      upsert: false,
    });
    if (storageError) throw new Error(`MEDIA_STORAGE_FAILED:${storageError.message}`);

    let payload: Record<string, unknown>;
    try {
      payload = isAudio
        ? await sendEvolutionWhatsAppAudioMessage({
            phone,
            mimeType: data.mimeType,
            fileName: data.fileName,
            base64: data.base64,
            instanceName,
          })
        : await sendEvolutionMediaMessage({
            phone,
            mediaType: mediaType as EvolutionMediaType,
            mimeType: data.mimeType,
            fileName: data.fileName,
            base64: data.base64,
            caption: data.caption,
            instanceName,
          });
    } catch (providerError) {
      await storage.remove([storagePath]).catch(() => undefined);
      throw providerError;
    }

    const key = payload["key"] as Record<string, unknown> | undefined;
    const externalMessageId =
      (typeof key?.["id"] === "string" && key["id"]) ||
      (typeof payload["id"] === "string" && payload["id"]) ||
      null;
    const now = new Date().toISOString();
    const label = isAudio ? "🎤 Mensagem de voz" : data.caption?.trim() || `📎 ${data.fileName}`;
    const mediaUrl = `storage://${WHATSAPP_MEDIA_BUCKET}/${storagePath}`;

    const { error: insertError } = await db.from("whatsapp_messages").insert({
      tenant_id: tenantId,
      conversation_id: conversation.id,
      external_message_id: externalMessageId,
      direction: "outbound",
      message_type: mediaType,
      body: label,
      media_url: mediaUrl,
      status: "sent",
      sent_at: now,
      raw_payload: {
        ...payload,
        mercadoimobi_file_name: data.fileName,
        mercadoimobi_mime_type: data.mimeType,
        mercadoimobi_storage_path: storagePath,
        mercadoimobi_size_bytes: bytes.byteLength,
      },
    });
    if (insertError && insertError.code !== "23505") throw new Error(insertError.message);

    const { error: updateError } = await db
      .from("whatsapp_conversations")
      .update({ last_message: label, last_message_at: now, updated_at: now })
      .eq("id", conversation.id)
      .eq("tenant_id", tenantId);
    if (updateError) throw new Error(updateError.message);

    return { success: true, externalMessageId, mediaType, fileName: data.fileName };
  });
''',
    encoding="utf-8",
)

replace_once(
    "src/lib/whatsapp-tenant.functions.ts",
    '''export interface WhatsAppMessage {
  id: string;
  direction: "inbound" | "outbound";
  message_type: string;
  body: string | null;
  media_url: string | null;
  status: string;
  sender_name: string | null;
  sent_at: string;
}''',
    '''export interface WhatsAppMessage {
  id: string;
  direction: "inbound" | "outbound";
  message_type: string;
  body: string | null;
  media_url: string | null;
  media_file_name: string | null;
  media_mime_type: string | null;
  status: string;
  sender_name: string | null;
  sent_at: string;
}''',
)

replace_once(
    "src/lib/whatsapp-tenant.functions.ts",
    '''    const { data: messages, error } = await db
      .from("whatsapp_messages")
      .select("id,direction,message_type,body,media_url,status,sender_name,sent_at")
      .eq("tenant_id", tenantId)
      .eq("conversation_id", data.conversationId)
      .order("sent_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return (messages ?? []) as WhatsAppMessage[];''',
    '''    const { data: messages, error } = await db
      .from("whatsapp_messages")
      .select("id,direction,message_type,body,media_url,status,sender_name,sent_at,raw_payload")
      .eq("tenant_id", tenantId)
      .eq("conversation_id", data.conversationId)
      .order("sent_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);

    const storagePrefix = "storage://whatsapp-media/";
    return Promise.all(
      (messages ?? []).map(async (row: Record<string, any>): Promise<WhatsAppMessage> => {
        const rawPayload =
          row.raw_payload && typeof row.raw_payload === "object"
            ? (row.raw_payload as Record<string, unknown>)
            : {};
        let mediaUrl = typeof row.media_url === "string" ? row.media_url : null;
        if (mediaUrl?.startsWith(storagePrefix)) {
          const storagePath = mediaUrl.slice(storagePrefix.length);
          const { data: signed } = await supabaseAdmin.storage
            .from("whatsapp-media")
            .createSignedUrl(storagePath, 60 * 60);
          mediaUrl = signed?.signedUrl ?? null;
        }
        return {
          id: String(row.id),
          direction: row.direction === "outbound" ? "outbound" : "inbound",
          message_type: String(row.message_type ?? "text"),
          body: typeof row.body === "string" ? row.body : null,
          media_url: mediaUrl,
          media_file_name:
            typeof rawPayload["mercadoimobi_file_name"] === "string"
              ? String(rawPayload["mercadoimobi_file_name"])
              : null,
          media_mime_type:
            typeof rawPayload["mercadoimobi_mime_type"] === "string"
              ? String(rawPayload["mercadoimobi_mime_type"])
              : null,
          status: String(row.status ?? "received"),
          sender_name: typeof row.sender_name === "string" ? row.sender_name : null,
          sent_at: String(row.sent_at),
        };
      }),
    );''',
)

replace_once(
    "src/routes/_authenticated/atendimento.tsx",
    '''  MessageCircle,
  Paperclip,
  RefreshCw,''',
    '''  MessageCircle,
  Mic,
  Paperclip,
  RefreshCw,''',
)

replace_once(
    "src/routes/_authenticated/atendimento.tsx",
    '''  Tag,
  UserCheck,
  Users,''',
    '''  Tag,
  Trash2,
  UserCheck,
  Users,''',
)

replace_once(
    "src/routes/_authenticated/atendimento.tsx",
    '''  WifiOff,
  X,
  Sparkles,''',
    '''  WifiOff,
  X,
  Square,
  Sparkles,''',
)

replace_once(
    "src/routes/_authenticated/atendimento.tsx",
    '''import { AttendanceDistributionPanel } from "@/components/attendance/AttendanceDistributionPanel";
import { generateConversationDraft, getAiRuntimeStatus } from "@/lib/ai-assistant.functions";''',
    '''import { AttendanceDistributionPanel } from "@/components/attendance/AttendanceDistributionPanel";
import { WhatsAppMessageMedia } from "@/components/attendance/WhatsAppMessageMedia";
import { generateConversationDraft, getAiRuntimeStatus } from "@/lib/ai-assistant.functions";''',
)

replace_once(
    "src/routes/_authenticated/atendimento.tsx",
    '''  const [showEmoji, setShowEmoji] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [propertyContext, setPropertyContext] = useState<PropertyContext | null>(null);''',
    '''  const [showEmoji, setShowEmoji] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [propertyContext, setPropertyContext] = useState<PropertyContext | null>(null);''',
)

replace_once(
    "src/routes/_authenticated/atendimento.tsx",
    '''  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);''',
    '''  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingCancelledRef = useRef(false);''',
)

replace_once(
    "src/routes/_authenticated/atendimento.tsx",
    '''  useEffect(() => {
    if (!selectedId) return;
    setPendingAttachment(null);
    setShowEmoji(false);
    setTagInput("");
    void markReadFn({ data: { conversationId: selectedId } }).then(() => conversations.refetch());
  }, [selectedId]);''',
    '''  useEffect(() => {
    if (!selectedId) return;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      recordingCancelledRef.current = true;
      mediaRecorderRef.current.stop();
    }
    setPendingAttachment(null);
    setShowEmoji(false);
    setTagInput("");
    void markReadFn({ data: { conversationId: selectedId } }).then(() => conversations.refetch());
  }, [selectedId]);

  useEffect(() => {
    if (!isRecording) {
      setRecordingSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(
    () => () => {
      recordingCancelledRef.current = true;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );''',
)

attachment_block = '''  const selectAttachment = async (file: File | null) => {
    if (!file) return;
    const maxAttachmentMb = connection.data?.maxAttachmentMb ?? 8;
    if (file.size > maxAttachmentMb * 1024 * 1024) {
      toast.error(`O arquivo deve ter no máximo ${maxAttachmentMb} MB.`);
      return;
    }
    const mimeType = file.type || "application/octet-stream";
    try {
      const base64 = await readFileBase64(file);
      setPendingAttachment({ fileName: file.name, mimeType, base64, size: file.size });
      setShowEmoji(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível anexar o arquivo.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };
'''
recorder_block = attachment_block + '''
  const stopRecordingTracks = () => {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
  };

  const startRecording = async () => {
    if (sending || isRecording) return;
    if (!selectedId) {
      toast.info("Selecione uma conversa para gravar o áudio.");
      return;
    }
    if (!connection.data?.connected) {
      toast.info("Conecte seu WhatsApp para enviar mensagens de voz.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Este navegador não oferece gravação de áudio para o WhatsApp.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      recordingChunksRef.current = [];
      recordingCancelledRef.current = false;
      const supportedMime = [
        "audio/webm;codecs=opus",
        "audio/ogg;codecs=opus",
        "audio/webm",
        "audio/ogg",
      ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const recorder = supportedMime
        ? new MediaRecorder(stream, { mimeType: supportedMime })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const cancelled = recordingCancelledRef.current;
        const mimeType = (recorder.mimeType || "audio/webm").split(";")[0] || "audio/webm";
        const chunks = recordingChunksRef.current;
        recordingChunksRef.current = [];
        mediaRecorderRef.current = null;
        stopRecordingTracks();
        setIsRecording(false);
        if (cancelled || chunks.length === 0) return;
        const extension = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm";
        const blob = new Blob(chunks, { type: mimeType });
        const file = new File([blob], `audio-${Date.now()}.${extension}`, { type: mimeType });
        void selectAttachment(file);
      };
      recorder.start(250);
      setPendingAttachment(null);
      setShowEmoji(false);
      setIsRecording(true);
    } catch (error) {
      stopRecordingTracks();
      toast.error(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Permita o acesso ao microfone para gravar mensagens de voz."
          : "Não foi possível iniciar a gravação de áudio.",
      );
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recordingCancelledRef.current = false;
    recorder.stop();
  };

  const cancelRecording = () => {
    const recorder = mediaRecorderRef.current;
    recordingCancelledRef.current = true;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else {
      stopRecordingTracks();
      setIsRecording(false);
    }
  };
'''
replace_once("src/routes/_authenticated/atendimento.tsx", attachment_block, recorder_block)

replace_once(
    "src/routes/_authenticated/atendimento.tsx",
    '''      if (pendingAttachment) {
        await attachmentFn({
          data: {
            conversationId: selectedId,
            fileName: pendingAttachment.fileName,
            mimeType: pendingAttachment.mimeType,
            base64: pendingAttachment.base64,
            caption: outgoing || undefined,
          },
        });
        setPendingAttachment(null);
        setText("");
        toast.success("Arquivo enviado pelo WhatsApp.");''',
    '''      if (pendingAttachment) {
        const sendingAudio = pendingAttachment.mimeType.startsWith("audio/");
        await attachmentFn({
          data: {
            conversationId: selectedId,
            fileName: pendingAttachment.fileName,
            mimeType: pendingAttachment.mimeType,
            base64: pendingAttachment.base64,
            caption: sendingAudio ? undefined : outgoing || undefined,
          },
        });
        setPendingAttachment(null);
        setText(sendingAudio ? outgoing : "");
        toast.success(sendingAudio ? "Áudio enviado pelo WhatsApp." : "Arquivo enviado pelo WhatsApp.");''',
)

replace_once(
    "src/routes/_authenticated/atendimento.tsx",
    '''                        {message.message_type !== "text" && (
                          <div className="mb-1 flex items-center gap-2 text-xs font-black">
                            <FileText className="h-4 w-4" /> Arquivo do WhatsApp
                          </div>
                        )}
                        {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
                        {!message.body && message.media_url && (
                          <a
                            href={message.media_url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-bold underline"
                          >
                            Abrir mídia recebida
                          </a>
                        )}''',
    '''                        {message.message_type === "text" ? (
                          message.body ? <p className="whitespace-pre-wrap">{message.body}</p> : null
                        ) : (
                          <WhatsAppMessageMedia message={message} />
                        )}''',
)

replace_once(
    "src/routes/_authenticated/atendimento.tsx",
    '''                {pendingAttachment && (
                  <div className="mb-2 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-slate-800">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-blue-600">
                      <FileText className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-black">{pendingAttachment.fileName}</p>
                      <p className="text-[10px] text-slate-500">
                        {(pendingAttachment.size / 1024 / 1024).toFixed(2)} MB · pronto para enviar
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPendingAttachment(null)}
                      className="rounded-lg p-1 text-slate-500 hover:bg-white"
                      aria-label="Remover anexo"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}''',
    '''                {pendingAttachment && (
                  <div className="mb-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-slate-800">
                    <div className="flex items-center gap-3">
                      {pendingAttachment.mimeType.startsWith("image/") ? (
                        <img
                          src={`data:${pendingAttachment.mimeType};base64,${pendingAttachment.base64}`}
                          alt={pendingAttachment.fileName}
                          className="h-14 w-14 shrink-0 rounded-lg object-cover"
                        />
                      ) : pendingAttachment.mimeType.startsWith("audio/") ? (
                        <div className="min-w-0 flex-1">
                          <p className="mb-1 truncate text-xs font-black">Mensagem de voz</p>
                          <audio controls preload="metadata" className="h-9 w-full">
                            <source
                              src={`data:${pendingAttachment.mimeType};base64,${pendingAttachment.base64}`}
                              type={pendingAttachment.mimeType}
                            />
                          </audio>
                        </div>
                      ) : (
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-blue-600">
                          <FileText className="h-4 w-4" />
                        </span>
                      )}
                      {!pendingAttachment.mimeType.startsWith("audio/") && (
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-black">{pendingAttachment.fileName}</p>
                          <p className="text-[10px] text-slate-500">
                            {(pendingAttachment.size / 1024 / 1024).toFixed(2)} MB · pronto para enviar
                          </p>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setPendingAttachment(null)}
                        className="rounded-lg p-1 text-slate-500 hover:bg-white"
                        aria-label="Remover anexo"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}''',
)

replace_once(
    "src/routes/_authenticated/atendimento.tsx",
    '''                  accept="image/*,video/mp4,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"''',
    '''                  accept="audio/webm,audio/ogg,audio/mpeg,audio/mp4,audio/aac,audio/wav,image/*,video/mp4,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"''',
)

old_composer = '''                <div className="flex items-end gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-12 w-12 rounded-xl"
                    disabled={sending || !connection.data?.connected}
                    onClick={() => fileInputRef.current?.click()}
                    title="Anexar documento, foto ou arquivo"
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-12 w-12 rounded-xl"
                    disabled={sending}
                    onClick={() => setShowEmoji((open) => !open)}
                    title="Adicionar emoji"
                  >
                    <Smile className="h-5 w-5" />
                  </Button>
                  <textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                    rows={1}
                    placeholder={
                      pendingAttachment ? "Adicione uma legenda (opcional)" : "Digite uma mensagem"
                    }
                    className="max-h-32 min-h-12 flex-1 resize-none rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-4 py-3 text-sm outline-none focus:border-blue-500"
                  />
                  <Button
                    size="icon"
                    onClick={() => void send()}
                    disabled={
                      sending || (!text.trim() && !pendingAttachment) || !connection.data?.connected
                    }
                    className="h-12 w-12 rounded-xl bg-blue-600 text-white hover:bg-blue-700"
                  >
                    {sending ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>'''
new_composer = '''                {isRecording ? (
                  <div className="flex min-h-12 items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-12 w-12 rounded-xl text-rose-600"
                      onClick={cancelRecording}
                      title="Cancelar gravação"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <div className="flex min-h-12 flex-1 items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm text-rose-700">
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
                      <span className="font-black">Gravando</span>
                      <span className="font-mono text-xs">{formatSeconds(recordingSeconds)}</span>
                      <span className="ml-auto text-xs text-rose-500">Mensagem de voz</span>
                    </div>
                    <Button
                      size="icon"
                      onClick={stopRecording}
                      className="h-12 w-12 rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
                      title="Finalizar gravação"
                    >
                      <Square className="h-4 w-4 fill-current" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-end gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-12 w-12 rounded-xl"
                      disabled={sending || !connection.data?.connected}
                      onClick={() => fileInputRef.current?.click()}
                      title="Anexar foto, vídeo, áudio ou documento"
                    >
                      <Paperclip className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-12 w-12 rounded-xl"
                      disabled={sending}
                      onClick={() => setShowEmoji((open) => !open)}
                      title="Adicionar emoji"
                    >
                      <Smile className="h-5 w-5" />
                    </Button>
                    <textarea
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void send();
                        }
                      }}
                      rows={1}
                      placeholder={
                        pendingAttachment?.mimeType.startsWith("audio/")
                          ? "Áudio pronto para enviar"
                          : pendingAttachment
                            ? "Adicione uma legenda (opcional)"
                            : "Digite uma mensagem"
                      }
                      className="max-h-32 min-h-12 flex-1 resize-none rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-4 py-3 text-sm outline-none focus:border-blue-500"
                    />
                    {text.trim() || pendingAttachment ? (
                      <Button
                        size="icon"
                        onClick={() => void send()}
                        disabled={sending || !connection.data?.connected}
                        className="h-12 w-12 rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
                        title="Enviar"
                      >
                        {sending ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        onClick={() => void startRecording()}
                        disabled={sending || !connection.data?.connected}
                        className="h-12 w-12 rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
                        title="Gravar mensagem de voz"
                      >
                        <Mic className="h-5 w-5" />
                      </Button>
                    )}
                  </div>
                )}'''
replace_once("src/routes/_authenticated/atendimento.tsx", old_composer, new_composer)

replace_once(
    "src/routes/_authenticated/atendimento.tsx",
    '''                  Anexos: PDF, documentos Office, imagens, vídeo MP4 e arquivos de texto · até{" "}
                  {connection.data?.maxAttachmentMb ?? 8} MB.''',
    '''                  WhatsApp: mensagens de voz, imagens, vídeo MP4, PDF, documentos Office e arquivos de texto · até{" "}
                  {connection.data?.maxAttachmentMb ?? 8} MB.''',
)

print("WhatsApp media UX patch applied successfully.")
