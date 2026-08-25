from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


# 1) Evolution API: keep the existing sendMedia flow untouched and add the
# dedicated WhatsApp voice/audio route used by Evolution API.
evolution_path = Path("src/lib/evolution-media.server.ts")
evolution = evolution_path.read_text(encoding="utf-8")
if "export async function sendEvolutionAudioMessage" in evolution:
    raise RuntimeError("Evolution audio sender already exists; aborting to avoid duplicate changes")

evolution = evolution.rstrip() + r'''

export async function sendEvolutionAudioMessage(input: {
  phone: string;
  base64: string;
  instanceName: string;
}): Promise<JsonObject> {
  const config = evolutionGatewayConfig();
  if (!config) throw new Error("WHATSAPP_NOT_CONFIGURED");

  const endpoint = `${config.baseUrl}/message/sendWhatsAppAudio/${encodeURIComponent(input.instanceName)}`;
  const cleanBase64 = input.base64.replace(/^data:[^;]+;base64,/, "").trim();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.apiKey,
    },
    body: JSON.stringify({
      number: input.phone,
      audio: cleanBase64,
      encoding: true,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const raw = await response.text();
  const payload = parsePayload(raw);
  if (response.ok) return payload;

  throw new Error(`EVOLUTION_AUDIO_FAILED:${response.status}:${responseMessage(payload)}`);
}
''' + "\n"
evolution_path.write_text(evolution, encoding="utf-8")


# 2) Server function: route audio MIME types through the dedicated Evolution
# voice endpoint while preserving image/video/document behavior.
media_path = Path("src/lib/whatsapp-media.functions.ts")
media = media_path.read_text(encoding="utf-8")
media = replace_once(
    media,
    'import { sendEvolutionMediaMessage, type EvolutionMediaType } from "@/lib/evolution-media.server";',
    '''import {
  sendEvolutionAudioMessage,
  sendEvolutionMediaMessage,
  type EvolutionMediaType,
} from "@/lib/evolution-media.server";''',
    "whatsapp media import",
)
media = replace_once(
    media,
    '''function mediaTypeFromMime(mimeType: string): EvolutionMediaType {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "document";
}''',
    '''function mediaTypeFromMime(mimeType: string): EvolutionMediaType | "audio" {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}''',
    "audio MIME classification",
)
media = replace_once(
    media,
    '''    const mediaType = mediaTypeFromMime(data.mimeType);
    const payload = await sendEvolutionMediaMessage({
      phone,
      mediaType,
      mimeType: data.mimeType,
      fileName: data.fileName,
      base64: data.base64,
      caption: data.caption,
      instanceName,
    });''',
    '''    const mediaType = mediaTypeFromMime(data.mimeType);
    const payload =
      mediaType === "audio"
        ? await sendEvolutionAudioMessage({
            phone,
            base64: data.base64,
            instanceName,
          })
        : await sendEvolutionMediaMessage({
            phone,
            mediaType,
            mimeType: data.mimeType,
            fileName: data.fileName,
            base64: data.base64,
            caption: data.caption,
            instanceName,
          });''',
    "dedicated audio sender",
)
media = replace_once(
    media,
    '    const label = data.caption?.trim() || `📎 ${data.fileName}`;',
    '''    const label =
      mediaType === "audio" ? "🎤 Áudio" : data.caption?.trim() || `📎 ${data.fileName}`;''',
    "audio conversation label",
)
media_path.write_text(media, encoding="utf-8")


# 3) Atendimento UI: additive recorder + WhatsApp-like media previews. The
# existing queues, AI, privacy, connection and text sending flows remain intact.
attendance_path = Path("src/routes/_authenticated/atendimento.tsx")
attendance = attendance_path.read_text(encoding="utf-8")
attendance = replace_once(
    attendance,
    '''  MessageCircle,
  Paperclip,''',
    '''  MessageCircle,
  Mic,
  Paperclip,''',
    "mic icon import",
)
attendance = replace_once(
    attendance,
    '''  WifiOff,
  X,
  Sparkles,
} from "lucide-react";''',
    '''  WifiOff,
  X,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";''',
    "recording icon imports",
)
attendance = replace_once(
    attendance,
    '''function readFileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const base64 = result.includes(",") ? (result.split(",")[1] ?? "") : result;
      if (!base64) reject(new Error("Não foi possível ler o arquivo."));
      else resolve(base64);
    };
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}''',
    '''function readBlobBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const base64 = result.includes(",") ? (result.split(",")[1] ?? "") : result;
      if (!base64) reject(new Error("Não foi possível ler o arquivo."));
      else resolve(base64);
    };
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(blob);
  });
}

function readFileBase64(file: File) {
  return readBlobBase64(file);
}

function preferredRecordingMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];
  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

function recordingFileName(mimeType: string) {
  const mime = mimeType.toLowerCase();
  const extension = mime.includes("ogg")
    ? "ogg"
    : mime.includes("mp4") || mime.includes("m4a")
      ? "m4a"
      : mime.includes("wav")
        ? "wav"
        : "webm";
  return `audio-${Date.now()}.${extension}`;
}

function attachmentDataUrl(attachment: PendingAttachment) {
  return `data:${attachment.mimeType};base64,${attachment.base64}`;
}

function isPlayableMediaUrl(value: string | null | undefined): value is string {
  return Boolean(value && /^(https?:|data:|blob:)/i.test(value));
}''',
    "blob and recorder helpers",
)
attendance = replace_once(
    attendance,
    '''  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [propertyContext, setPropertyContext] = useState<PropertyContext | null>(null);''',
    '''  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [propertyContext, setPropertyContext] = useState<PropertyContext | null>(null);''',
    "recording state",
)
attendance = replace_once(
    attendance,
    '''  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);''',
    '''  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingDiscardRef = useRef(false);
  const recordingTimerRef = useRef<number | null>(null);''',
    "recording refs",
)
attendance = replace_once(
    attendance,
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
      recordingDiscardRef.current = true;
      mediaRecorderRef.current.stop();
    }
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setRecording(false);
    setRecordingSeconds(0);
    setPendingAttachment(null);
    setShowEmoji(false);
    setTagInput("");
    void markReadFn({ data: { conversationId: selectedId } }).then(() => conversations.refetch());
  }, [selectedId]);

  useEffect(
    () => () => {
      recordingDiscardRef.current = true;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current);
    },
    [],
  );''',
    "recording lifecycle cleanup",
)
old_select = '''  const selectAttachment = async (file: File | null) => {
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
  };'''
new_select = old_select + '''

  const startRecording = async () => {
    if (recording || sending || !selectedId) return;
    if (!connection.data?.connected) {
      toast.info("Conecte seu WhatsApp para enviar áudio.");
      return;
    }
    if (
      typeof MediaRecorder === "undefined" ||
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      toast.error("Este navegador não oferece gravação de áudio compatível.");
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordingStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      recordingDiscardRef.current = false;
      setPendingAttachment(null);
      setShowEmoji(false);
      setRecordingSeconds(0);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        toast.error("A gravação do áudio foi interrompida pelo navegador.");
      };
      recorder.onstop = () => {
        const shouldDiscard = recordingDiscardRef.current;
        const chunks = recordingChunksRef.current;
        const finalMimeType = recorder.mimeType || mimeType || "audio/webm";
        recordingChunksRef.current = [];
        mediaRecorderRef.current = null;
        recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        if (recordingTimerRef.current !== null) {
          window.clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        setRecording(false);
        setRecordingSeconds(0);
        recordingDiscardRef.current = false;
        if (shouldDiscard) return;

        const blob = new Blob(chunks, { type: finalMimeType });
        if (!blob.size) {
          toast.error("Não foi possível gerar o áudio gravado.");
          return;
        }
        const maxAttachmentMb = connection.data?.maxAttachmentMb ?? 8;
        if (blob.size > maxAttachmentMb * 1024 * 1024) {
          toast.error(`O áudio deve ter no máximo ${maxAttachmentMb} MB.`);
          return;
        }
        void readBlobBase64(blob)
          .then((base64) => {
            setPendingAttachment({
              fileName: recordingFileName(finalMimeType),
              mimeType: finalMimeType,
              base64,
              size: blob.size,
            });
          })
          .catch(() => toast.error("Não foi possível preparar o áudio para envio."));
      };

      const startedAt = Date.now();
      recorder.start(250);
      setRecording(true);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      mediaRecorderRef.current = null;
      toast.error(
        error instanceof Error && error.name === "NotAllowedError"
          ? "Permita o acesso ao microfone para gravar áudio."
          : "Não foi possível iniciar o microfone.",
      );
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  };

  const cancelRecording = () => {
    recordingDiscardRef.current = true;
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setRecording(false);
    setRecordingSeconds(0);
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    mediaRecorderRef.current = null;
  };'''
attendance = replace_once(attendance, old_select, new_select, "recording actions")
attendance = replace_once(
    attendance,
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
        toast.success("Arquivo enviado pelo WhatsApp.");
      } else {
        await sendFn({ data: { conversationId: selectedId, text: outgoing } });
        setText("");
      }''',
    '''      if (pendingAttachment) {
        const isAudio = pendingAttachment.mimeType.toLowerCase().startsWith("audio/");
        await attachmentFn({
          data: {
            conversationId: selectedId,
            fileName: pendingAttachment.fileName,
            mimeType: pendingAttachment.mimeType,
            base64: pendingAttachment.base64,
            caption: isAudio ? undefined : outgoing || undefined,
          },
        });
        if (isAudio && outgoing) {
          await sendFn({ data: { conversationId: selectedId, text: outgoing } });
        }
        setPendingAttachment(null);
        setText("");
        toast.success(isAudio ? "Áudio enviado pelo WhatsApp." : "Arquivo enviado pelo WhatsApp.");
      } else {
        await sendFn({ data: { conversationId: selectedId, text: outgoing } });
        setText("");
      }''',
    "audio send behavior",
)
attendance = replace_once(
    attendance,
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
    '''                        {message.message_type === "image" &&
                          isPlayableMediaUrl(message.media_url) && (
                            <a href={message.media_url} target="_blank" rel="noreferrer">
                              <img
                                src={message.media_url}
                                alt={message.body || "Imagem do WhatsApp"}
                                className="mb-2 max-h-80 w-full rounded-xl object-cover"
                                loading="lazy"
                              />
                            </a>
                          )}
                        {message.message_type === "video" &&
                          isPlayableMediaUrl(message.media_url) && (
                            <video
                              controls
                              preload="metadata"
                              src={message.media_url}
                              className="mb-2 max-h-80 w-full rounded-xl bg-black"
                            />
                          )}
                        {message.message_type === "audio" &&
                          isPlayableMediaUrl(message.media_url) && (
                            <audio
                              controls
                              preload="metadata"
                              src={message.media_url}
                              className="mb-2 max-w-full"
                            />
                          )}
                        {message.message_type !== "text" &&
                          !(
                            ["image", "video", "audio"].includes(message.message_type) &&
                            isPlayableMediaUrl(message.media_url)
                          ) && (
                            <div className="mb-1 flex items-center gap-2 text-xs font-black">
                              {message.message_type === "audio" ? (
                                <Mic className="h-4 w-4" />
                              ) : (
                                <FileText className="h-4 w-4" />
                              )}
                              {message.message_type === "audio"
                                ? "Áudio do WhatsApp"
                                : message.message_type === "image"
                                  ? "Imagem do WhatsApp"
                                  : message.message_type === "video"
                                    ? "Vídeo do WhatsApp"
                                    : "Arquivo do WhatsApp"}
                            </div>
                          )}
                        {message.body && <p className="whitespace-pre-wrap">{message.body}</p>}
                        {message.message_type === "document" &&
                          isPlayableMediaUrl(message.media_url) && (
                            <a
                              href={message.media_url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-flex items-center gap-1 font-bold underline"
                            >
                              <FileText className="h-4 w-4" /> Abrir arquivo
                            </a>
                          )}''',
    "message media previews",
)
attendance = replace_once(
    attendance,
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
                      {pendingAttachment.mimeType.toLowerCase().startsWith("image/") ? (
                        <img
                          src={attachmentDataUrl(pendingAttachment)}
                          alt={pendingAttachment.fileName}
                          className="h-14 w-16 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-blue-600">
                          {pendingAttachment.mimeType.toLowerCase().startsWith("audio/") ? (
                            <Mic className="h-4 w-4" />
                          ) : (
                            <FileText className="h-4 w-4" />
                          )}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-black">{pendingAttachment.fileName}</p>
                        <p className="text-[10px] text-slate-500">
                          {(pendingAttachment.size / 1024 / 1024).toFixed(2)} MB ·{" "}
                          {pendingAttachment.mimeType.toLowerCase().startsWith("audio/")
                            ? "áudio pronto para enviar"
                            : "pronto para enviar"}
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
                    {pendingAttachment.mimeType.toLowerCase().startsWith("audio/") && (
                      <audio
                        controls
                        preload="metadata"
                        src={attachmentDataUrl(pendingAttachment)}
                        className="mt-2 w-full"
                      />
                    )}
                  </div>
                )}''',
    "pending attachment preview",
)
attendance = replace_once(
    attendance,
    '''                  accept="image/*,video/mp4,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"''',
    '''                  accept="image/*,audio/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar"''',
    "attachment accept types",
)
attendance = replace_once(
    attendance,
    '''                    disabled={sending || !connection.data?.connected}
                    onClick={() => fileInputRef.current?.click()}
                    title="Anexar documento, foto ou arquivo"''',
    '''                    disabled={sending || recording || !connection.data?.connected}
                    onClick={() => fileInputRef.current?.click()}
                    title="Anexar foto, vídeo, áudio, documento ou arquivo"''',
    "attachment button recording lock",
)
attendance = replace_once(
    attendance,
    '''                    disabled={sending}
                    onClick={() => setShowEmoji((open) => !open)}
                    title="Adicionar emoji"''',
    '''                    disabled={sending || recording}
                    onClick={() => setShowEmoji((open) => !open)}
                    title="Adicionar emoji"''',
    "emoji recording lock",
)
attendance = replace_once(
    attendance,
    '''                  <textarea
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
                  </Button>''',
    '''                  {recording ? (
                    <div className="flex min-h-12 flex-1 items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm text-rose-700">
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-600" />
                      <span className="font-black">Gravando áudio</span>
                      <span className="ml-auto font-mono text-xs font-black">
                        {formatSeconds(recordingSeconds)}
                      </span>
                      <button
                        type="button"
                        onClick={cancelRecording}
                        className="rounded-lg p-1.5 text-rose-600 hover:bg-white"
                        title="Cancelar gravação"
                        aria-label="Cancelar gravação"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
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
                        pendingAttachment?.mimeType.toLowerCase().startsWith("audio/")
                          ? "Mensagem opcional (será enviada separadamente)"
                          : pendingAttachment
                            ? "Adicione uma legenda (opcional)"
                            : "Digite uma mensagem"
                      }
                      className="max-h-32 min-h-12 flex-1 resize-none rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-4 py-3 text-sm outline-none focus:border-blue-500"
                    />
                  )}
                  {recording ? (
                    <Button
                      size="icon"
                      onClick={stopRecording}
                      className="h-12 w-12 rounded-xl bg-rose-600 text-white hover:bg-rose-700"
                      title="Parar gravação"
                      aria-label="Parar gravação"
                    >
                      <Square className="h-4 w-4 fill-current" />
                    </Button>
                  ) : text.trim() || pendingAttachment ? (
                    <Button
                      size="icon"
                      onClick={() => void send()}
                      disabled={sending || !connection.data?.connected}
                      className="h-12 w-12 rounded-xl bg-blue-600 text-white hover:bg-blue-700"
                      title="Enviar mensagem"
                      aria-label="Enviar mensagem"
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
                      className="h-12 w-12 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                      title="Gravar áudio"
                      aria-label="Gravar áudio"
                    >
                      <Mic className="h-4 w-4" />
                    </Button>
                  )}''',
    "WhatsApp-like recorder composer",
)
attendance = replace_once(
    attendance,
    '''                  Anexos: PDF, documentos Office, imagens, vídeo MP4 e arquivos de texto · até{" "}
                  {connection.data?.maxAttachmentMb ?? 8} MB.''',
    '''                  Áudio pelo microfone, fotos, vídeos, PDF, documentos Office e arquivos · até{" "}
                  {connection.data?.maxAttachmentMb ?? 8} MB.''',
    "composer helper text",
)
attendance_path.write_text(attendance, encoding="utf-8")


# 4) Regression test for the dedicated voice route.
test_path = Path("tests/whatsapp-media.test.ts")
test = test_path.read_text(encoding="utf-8")
test = replace_once(
    test,
    'import { sendEvolutionMediaMessage } from "@/lib/evolution-media.server";',
    '''import {
  sendEvolutionAudioMessage,
  sendEvolutionMediaMessage,
} from "@/lib/evolution-media.server";''',
    "media test import",
)
marker = "\n});\n"
if test.count(marker) != 1:
    raise RuntimeError("media test closing marker not unique")
audio_test = r'''

  it("sends voice audio through the dedicated Evolution WhatsApp audio endpoint", async () => {
    vi.stubEnv("EVOLUTION_API_URL", "https://evolution.example.test");
    vi.stubEnv("EVOLUTION_API_KEY", "test-key");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ key: { id: "audio-1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await sendEvolutionAudioMessage({
      phone: "5547999999999",
      base64: "data:audio/webm;base64,QUJD",
      instanceName: "mercadoimobi-tenant-123",
    });

    expect(result).toMatchObject({ key: { id: "audio-1" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/message/sendWhatsAppAudio/mercadoimobi-tenant-123",
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      number: "5547999999999",
      audio: "QUJD",
      encoding: true,
    });
  });'''
test = test.replace(marker, audio_test + marker, 1)
test_path.write_text(test, encoding="utf-8")

print("WhatsApp audio/media patch applied successfully.")
