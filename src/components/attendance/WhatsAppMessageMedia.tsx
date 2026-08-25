import { ExternalLink, FileText, ImageIcon, Music2, Video } from "lucide-react";

export interface WhatsAppMessageMediaProps {
  message: {
    message_type: string;
    body: string | null;
    media_url: string | null;
    media_file_name?: string | null;
    media_mime_type?: string | null;
  };
}

function normalizedType(message: WhatsAppMessageMediaProps["message"]) {
  const type = message.message_type?.toLowerCase() ?? "";
  const mime = message.media_mime_type?.toLowerCase() ?? "";
  if (type === "audio" || mime.startsWith("audio/")) return "audio";
  if (type === "image" || type === "sticker" || mime.startsWith("image/")) return "image";
  if (type === "video" || mime.startsWith("video/")) return "video";
  return "document";
}

function fallbackFileName(message: WhatsAppMessageMediaProps["message"]) {
  if (message.media_file_name?.trim()) return message.media_file_name.trim();
  const body = message.body?.replace(/^📎\s*/, "").trim();
  if (body && body.length <= 120) return body;
  const type = normalizedType(message);
  if (type === "audio") return "Mensagem de voz";
  if (type === "image") return "Imagem";
  if (type === "video") return "Vídeo";
  return "Documento";
}

function captionFor(message: WhatsAppMessageMediaProps["message"]) {
  const body = message.body?.trim();
  if (!body || body.startsWith("📎 ")) return null;
  if (body === message.media_file_name) return null;
  return body;
}

export function WhatsAppMessageMedia({ message }: WhatsAppMessageMediaProps) {
  const type = normalizedType(message);
  const fileName = fallbackFileName(message);
  const caption = captionFor(message);

  if (!message.media_url) {
    const Icon = type === "audio" ? Music2 : type === "image" ? ImageIcon : type === "video" ? Video : FileText;
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-sm">
          <Icon className="h-4 w-4 shrink-0" />
          <span className="min-w-0 truncate">{fileName}</span>
        </div>
        {caption ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{caption}</p> : null}
      </div>
    );
  }

  if (type === "image") {
    return (
      <div className="space-y-1.5">
        <a href={message.media_url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg">
          <img src={message.media_url} alt={fileName} className="max-h-80 w-full max-w-sm object-cover" loading="lazy" />
        </a>
        {caption ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{caption}</p> : null}
      </div>
    );
  }

  if (type === "video") {
    return (
      <div className="space-y-1.5">
        <video controls playsInline preload="metadata" className="max-h-80 w-full max-w-sm rounded-lg bg-black">
          <source src={message.media_url} type={message.media_mime_type ?? undefined} />
        </video>
        {caption ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{caption}</p> : null}
      </div>
    );
  }

  if (type === "audio") {
    return (
      <div className="min-w-[230px] space-y-1.5">
        <div className="flex items-center gap-2">
          <Music2 className="h-4 w-4 shrink-0" />
          <span className="text-xs font-medium">{fileName}</span>
        </div>
        <audio controls preload="metadata" className="h-10 w-full max-w-sm">
          <source src={message.media_url} type={message.media_mime_type ?? undefined} />
        </audio>
        {caption ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{caption}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <a
        href={message.media_url}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-[220px] items-center gap-3 rounded-lg bg-black/5 px-3 py-2.5 transition hover:bg-black/10"
      >
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-background/80">
          <FileText className="h-4 w-4" />
        </div>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{fileName}</span>
        <ExternalLink className="h-4 w-4 shrink-0 opacity-70" />
      </a>
      {caption ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{caption}</p> : null}
    </div>
  );
}
