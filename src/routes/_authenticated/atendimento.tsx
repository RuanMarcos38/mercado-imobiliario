import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  BarChart3,
  Bot,
  CheckCheck,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileText,
  Filter,
  Link2,
  LockKeyhole,
  MessageCircle,
  Mic,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Smile,
  Tag,
  Trash2,
  UserCheck,
  Users,
  Wifi,
  WifiOff,
  X,
  Square,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AttendanceDecisionDashboard } from "@/components/attendance/AttendanceDecisionDashboard";
import { AttendanceDistributionPanel } from "@/components/attendance/AttendanceDistributionPanel";
import { WhatsAppMessageMedia } from "@/components/attendance/WhatsAppMessageMedia";
import { generateConversationDraft, getAiRuntimeStatus } from "@/lib/ai-assistant.functions";
import {
  claimAttendanceConversation,
  endAttendanceConversation,
  getAttendanceDashboard,
  getAttendanceViewer,
  listAttendanceConversations,
  queueAttendanceConversation,
  recordAttendanceFirstResponse,
  setSensitiveDataVisibility,
  updateAttendancePresence,
  updateAttendanceTags,
  type AttendanceConversation,
  type AttendantPresenceStatus,
} from "@/lib/attendance-center.functions";
import {
  disconnectWhatsAppConnection,
  prepareWhatsAppConnection,
} from "@/lib/whatsapp-connection.functions";
import { startWhatsAppConversation } from "@/lib/whatsapp-conversation.functions";
import { sendWhatsAppAttachment } from "@/lib/whatsapp-media.functions";
import {
  getWhatsAppConnectionStatus,
  getWhatsAppQrCode,
  listWhatsAppMessages,
  markWhatsAppConversationRead,
  sendWhatsAppText,
} from "@/lib/whatsapp-tenant.functions";

export const Route = createFileRoute("/_authenticated/atendimento")({
  component: AtendimentoPage,
  head: () => ({ title: "Conversas | MercadoImobi" }),
});

type PropertyContext = {
  id?: string;
  title?: string;
  url?: string | null;
};

type PendingAttachment = {
  fileName: string;
  mimeType: string;
  base64: string;
  size: number;
};

type QueueTab = "waiting" | "in_service" | "automatic";
type DashboardPeriod = "today" | "7d" | "30d";

const EMOJIS = [
  "😀",
  "😃",
  "😄",
  "😁",
  "😊",
  "😍",
  "🥰",
  "😉",
  "🙂",
  "🤩",
  "😎",
  "🤝",
  "👍",
  "👏",
  "🙏",
  "💪",
  "❤️",
  "💙",
  "💚",
  "✨",
  "🎉",
  "🔥",
  "✅",
  "⭐",
  "🏠",
  "🏡",
  "🏢",
  "🔑",
  "📍",
  "📅",
  "📞",
  "💬",
  "💰",
  "📄",
  "📎",
  "🚀",
  "👀",
  "🤔",
  "☺️",
  "🙌",
];

const QUEUE_LABELS: Record<QueueTab, string> = {
  waiting: "Esperando",
  in_service: "Atendimentos",
  automatic: "Automático",
};

const PRESENCE_LABELS: Record<AttendantPresenceStatus, string> = {
  alert: "Em alerta",
  in_service: "Em atendimento",
  free: "Livre",
  paused: "Em pausa",
  away: "Ausente",
};

function readFileBase64(file: File) {
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
}

function formatSeconds(total: number) {
  const seconds = Math.max(0, Math.round(total || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0)
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function startIsoForPeriod(period: DashboardPeriod) {
  const now = new Date();
  if (period === "today") {
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  }
  now.setDate(now.getDate() - (period === "7d" ? 7 : 30));
  return now.toISOString();
}

function statusDot(status: AttendantPresenceStatus) {
  if (status === "alert") return "bg-rose-500";
  if (status === "in_service") return "bg-indigo-600";
  if (status === "free") return "bg-emerald-600";
  if (status === "paused") return "bg-amber-500";
  return "bg-slate-500";
}

function AtendimentoPage() {
  const navigate = useNavigate();
  const statusFn = useServerFn(getWhatsAppConnectionStatus);
  const qrFn = useServerFn(getWhatsAppQrCode);
  const prepareFn = useServerFn(prepareWhatsAppConnection);
  const disconnectFn = useServerFn(disconnectWhatsAppConnection);
  const conversationsFn = useServerFn(listAttendanceConversations);
  const viewerFn = useServerFn(getAttendanceViewer);
  const messagesFn = useServerFn(listWhatsAppMessages);
  const markReadFn = useServerFn(markWhatsAppConversationRead);
  const sendFn = useServerFn(sendWhatsAppText);
  const attachmentFn = useServerFn(sendWhatsAppAttachment);
  const startFn = useServerFn(startWhatsAppConversation);
  const draftFn = useServerFn(generateConversationDraft);
  const aiStatusFn = useServerFn(getAiRuntimeStatus);
  const queueFn = useServerFn(queueAttendanceConversation);
  const claimFn = useServerFn(claimAttendanceConversation);
  const endFn = useServerFn(endAttendanceConversation);
  const firstResponseFn = useServerFn(recordAttendanceFirstResponse);
  const presenceFn = useServerFn(updateAttendancePresence);
  const tagsFn = useServerFn(updateAttendanceTags);
  const dashboardFn = useServerFn(getAttendanceDashboard);
  const sensitivePermissionFn = useServerFn(setSensitiveDataVisibility);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queueTab, setQueueTab] = useState<QueueTab>("waiting");
  const [search, setSearch] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [propertyContext, setPropertyContext] = useState<PropertyContext | null>(null);
  const [showRealtimePanel, setShowRealtimePanel] = useState(false);
  const [dashboardPeriod, setDashboardPeriod] = useState<DashboardPeriod>("today");
  const [dashboardSearch, setDashboardSearch] = useState("");
  const [dashboardStatuses, setDashboardStatuses] = useState<AttendantPresenceStatus[]>([
    "alert",
    "in_service",
    "free",
    "paused",
    "away",
  ]);
  const [tagInput, setTagInput] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingCancelledRef = useRef(false);

  const connection = useQuery({
    queryKey: ["whatsapp-connection"],
    queryFn: () => statusFn(),
    refetchInterval: showQr ? 4_000 : 30_000,
  });
  const aiStatus = useQuery({ queryKey: ["ai-runtime-status"], queryFn: () => aiStatusFn() });
  const viewer = useQuery({
    queryKey: ["attendance-viewer"],
    queryFn: () => viewerFn(),
    refetchInterval: 60_000,
  });
  const conversations = useQuery({
    queryKey: ["attendance-conversations"],
    queryFn: () => conversationsFn(),
    refetchInterval: 20_000,
  });
  const messages = useQuery({
    queryKey: ["whatsapp-messages", selectedId],
    queryFn: () => messagesFn({ data: { conversationId: selectedId! } }),
    enabled: Boolean(selectedId),
    refetchInterval: selectedId ? 15_000 : false,
  });
  const dashboard = useQuery({
    queryKey: ["attendance-dashboard", dashboardPeriod],
    queryFn: () => dashboardFn({ data: { startIso: startIsoForPeriod(dashboardPeriod) } }),
    enabled: showRealtimePanel,
    refetchInterval: showRealtimePanel ? 15_000 : false,
  });

  useEffect(() => {
    if (selectedId || conversations.isLoading) return;
    const latestConversation = conversations.data?.[0];
    if (!latestConversation) return;
    setQueueTab(latestConversation.attendance_state || "automatic");
    setSelectedId(latestConversation.id);
  }, [conversations.data, conversations.isLoading, selectedId]);

  useEffect(() => {
    // Opening the attendance center also reconciles the Evolution webhook for the
    // tenant's currently saved instance, so inbound messages keep flowing after deploys.
    void prepareFn()
      .then(() => connection.refetch())
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const storedConversation = sessionStorage.getItem("mercadoimobi:selectedConversation");
    if (storedConversation) {
      setSelectedId(storedConversation);
      sessionStorage.removeItem("mercadoimobi:selectedConversation");
    }
    const storedProperty = sessionStorage.getItem("mercadoimobi:propertyContext");
    if (storedProperty) {
      try {
        setPropertyContext(JSON.parse(storedProperty) as PropertyContext);
      } catch {
        setPropertyContext(null);
      }
      sessionStorage.removeItem("mercadoimobi:propertyContext");
    }
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("mercadoimobi-atendimento-live-v2")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_conversations" },
        () => {
          void conversations.refetch();
          if (showRealtimePanel) void dashboard.refetch();
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_messages" }, () => {
        void conversations.refetch();
        if (selectedId) void messages.refetch();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "system_events" }, () => {
        if (showRealtimePanel) void dashboard.refetch();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "system_events" }, () => {
        if (showRealtimePanel) void dashboard.refetch();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedId, showRealtimePanel]);

  useEffect(() => {
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
  );

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.data?.length, selectedId]);

  useEffect(() => {
    if (!showQr) return;
    if (connection.data?.connected) {
      setShowQr(false);
      setQrBase64(null);
      setQrCode(null);
      setPairingCode(null);
      toast.success("WhatsApp conectado com sucesso.");
      void conversations.refetch();
    }
  }, [showQr, connection.data?.connected]);

  useEffect(() => {
    if (!showQr || connection.data?.connected) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const qr = await qrFn();
        if (cancelled) return;
        if (qr.base64) setQrBase64(qr.base64);
        if (qr.code) setQrCode(qr.code);
        if (qr.pairingCode) setPairingCode(qr.pairingCode);
      } catch {
        // O QR expira e é renovado pela Evolution; a próxima tentativa continua o polling.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [showQr, connection.data?.connected]);

  const selected = (conversations.data ?? []).find((item) => item.id === selectedId) ?? null;
  const queueCounts = useMemo(() => {
    const result: Record<QueueTab, number> = { waiting: 0, in_service: 0, automatic: 0 };
    for (const conversation of conversations.data ?? []) {
      const state = conversation.attendance_state || "automatic";
      if (state in result) result[state as QueueTab] += 1;
    }
    return result;
  }, [conversations.data]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (conversations.data ?? []).filter((conversation) => {
      if ((conversation.attendance_state || "automatic") !== queueTab) return false;
      if (!needle) return true;
      return [
        conversation.contact_name,
        conversation.phone_e164,
        conversation.last_message,
        ...(conversation.tags ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [conversations.data, search, queueTab]);

  const filteredAgents = useMemo(() => {
    const needle = dashboardSearch.trim().toLowerCase();
    return (dashboard.data?.agents ?? []).filter(
      (agent) =>
        dashboardStatuses.includes(agent.status) &&
        (!needle || agent.name.toLowerCase().includes(needle)),
    );
  }, [dashboard.data?.agents, dashboardSearch, dashboardStatuses]);

  const refreshQr = async () => {
    setQrLoading(true);
    try {
      const qr = await qrFn();
      setQrBase64(qr.base64);
      setQrCode(qr.code);
      setPairingCode(qr.pairingCode);
      await connection.refetch();
    } catch {
      toast.error("Ainda não foi possível gerar o QR Code. Tente novamente em alguns segundos.");
    } finally {
      setQrLoading(false);
    }
  };

  const connect = async () => {
    setShowQr(true);
    setQrLoading(true);
    setQrBase64(null);
    setQrCode(null);
    setPairingCode(null);
    try {
      const prepared = await prepareFn();
      if (!prepared.configured) {
        setShowQr(false);
        toast.info("O gateway do WhatsApp ainda precisa ser ativado no servidor.");
        return;
      }
      if (prepared.connected) {
        setShowQr(false);
        await connection.refetch();
        toast.success("Seu WhatsApp já está conectado.");
        return;
      }
      if (prepared.qrBase64) setQrBase64(prepared.qrBase64);
      if (prepared.qrCode) setQrCode(prepared.qrCode);
      if (prepared.pairingCode) setPairingCode(prepared.pairingCode);
      if (!prepared.qrBase64 && !prepared.qrCode) await refreshQr();
      await connection.refetch();
    } catch (error) {
      setShowQr(false);
      toast.error(
        error instanceof Error
          ? `Não foi possível iniciar a conexão: ${error.message}`
          : "Não foi possível iniciar a conexão agora.",
      );
    } finally {
      setQrLoading(false);
    }
  };

  const disconnect = async () => {
    if (disconnecting) return;
    if (!window.confirm("Desconectar este WhatsApp do MercadoImobi?")) return;
    setDisconnecting(true);
    try {
      await disconnectFn();
      setShowQr(false);
      setQrBase64(null);
      setQrCode(null);
      setPairingCode(null);
      await connection.refetch();
      toast.success("WhatsApp desconectado. Você pode conectar novamente por QR Code.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível desconectar o WhatsApp.",
      );
    } finally {
      setDisconnecting(false);
    }
  };

  const startConversation = async () => {
    const phone = window.prompt("Número do WhatsApp com DDI e DDD (ex.: 5547999999999):");
    if (!phone?.trim()) return;
    const name = window.prompt("Nome do contato (opcional):") ?? "";
    try {
      const result = await startFn({ data: { phone, contactName: name || undefined } });
      await claimFn({ data: { conversationId: result.id } });
      await Promise.all([conversations.refetch(), viewer.refetch()]);
      setQueueTab("in_service");
      setSelectedId(result.id);
      setPropertyContext(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível abrir a conversa.");
    }
  };

  const selectAttachment = async (file: File | null) => {
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
        const extension = mimeType.includes("ogg")
          ? "ogg"
          : mimeType.includes("mp4")
            ? "m4a"
            : "webm";
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

  const send = async () => {
    if (!selectedId || sending || (!text.trim() && !pendingAttachment)) return;
    if (!connection.data?.connected) {
      toast.info("Conecte seu WhatsApp para enviar mensagens.");
      return;
    }
    const outgoing = text.trim();
    setSending(true);
    try {
      if (pendingAttachment) {
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
        toast.success(
          sendingAudio ? "Áudio enviado pelo WhatsApp." : "Arquivo enviado pelo WhatsApp.",
        );
      } else {
        await sendFn({ data: { conversationId: selectedId, text: outgoing } });
        setText("");
      }
      if (selected?.attendance_state === "in_service") {
        await firstResponseFn({ data: { conversationId: selectedId } });
      }
      setShowEmoji(false);
      await Promise.all([messages.refetch(), conversations.refetch()]);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "A mensagem não foi enviada. Verifique a conexão e tente novamente.",
      );
    } finally {
      setSending(false);
    }
  };

  const suggest = async () => {
    if (!selectedId || drafting) return;
    if (!aiStatus.data?.configured) {
      toast.info("A IA ainda precisa ser configurada no servidor.");
      return;
    }
    setDrafting(true);
    try {
      const result = await draftFn({ data: { conversationId: selectedId } });
      setText(result.text);
    } catch {
      toast.error("Não foi possível gerar uma sugestão agora.");
    } finally {
      setDrafting(false);
    }
  };

  const runConversationAction = async (action: "queue" | "claim" | "end") => {
    if (!selectedId || actionLoading) return;
    setActionLoading(true);
    try {
      if (action === "queue") {
        await queueFn({ data: { conversationId: selectedId } });
        setQueueTab("waiting");
        toast.success("Conversa enviada para a fila de atendimento.");
      } else if (action === "claim") {
        await claimFn({ data: { conversationId: selectedId } });
        setQueueTab("in_service");
        toast.success("Atendimento iniciado.");
      } else {
        await endFn({ data: { conversationId: selectedId } });
        setQueueTab("automatic");
        toast.success("Atendimento encerrado e devolvido ao automático.");
      }
      await Promise.all([conversations.refetch(), viewer.refetch()]);
      if (showRealtimePanel) await dashboard.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível atualizar o atendimento.",
      );
    } finally {
      setActionLoading(false);
    }
  };

  const updatePresence = async (status: AttendantPresenceStatus) => {
    try {
      await presenceFn({ data: { status } });
      await viewer.refetch();
      if (showRealtimePanel) await dashboard.refetch();
      toast.success(`Status alterado para ${PRESENCE_LABELS[status]}.`);
    } catch {
      toast.error("Não foi possível alterar seu status.");
    }
  };

  const addTag = async () => {
    if (!selected || !tagInput.trim()) return;
    const tags = [...new Set([...(selected.tags ?? []), tagInput.trim()])].slice(0, 8);
    try {
      await tagsFn({ data: { conversationId: selected.id, tags } });
      setTagInput("");
      await conversations.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível adicionar a tag.");
    }
  };

  const removeTag = async (tag: string) => {
    if (!selected) return;
    try {
      await tagsFn({
        data: {
          conversationId: selected.id,
          tags: (selected.tags ?? []).filter((item) => item !== tag),
        },
      });
      await conversations.refetch();
    } catch {
      toast.error("Não foi possível remover a tag.");
    }
  };

  const toggleSensitivePermission = async (userId: string, allowed: boolean) => {
    try {
      await sensitivePermissionFn({ data: { userId, allowed } });
      await dashboard.refetch();
      toast.success("Permissão de dados sensíveis atualizada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível alterar a permissão.");
    }
  };

  return (
    <div className="min-h-[calc(100vh-72px)] bg-[var(--mi-bg)] px-4 py-5 text-[var(--mi-text)] sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-112px)] max-w-[1600px] overflow-hidden rounded-[28px] border border-[var(--mi-border)] bg-[var(--mi-surface)] shadow-sm">
        <aside className="flex w-[360px] shrink-0 flex-col border-r border-[var(--mi-border)] bg-[var(--mi-surface-soft)]">
          <div className="border-b border-[var(--mi-border)] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-blue-600">
                  Central
                </p>
                <h1 className="text-lg font-black">Conversas</h1>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRealtimePanel(true)}
                className="rounded-xl border-blue-300/50 bg-[var(--mi-surface)] text-xs font-black text-blue-600"
              >
                <BarChart3 className="mr-1.5 h-3.5 w-3.5" /> Dashboard Atendimento
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => void startConversation()}
                className="h-10 flex-1 rounded-xl border-[var(--mi-border)] bg-[var(--mi-surface)] font-black"
              >
                <MessageCircle className="mr-2 h-4 w-4" /> Nova conversa
              </Button>
              <span
                className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-black ${connection.data?.connected ? "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-700 dark:text-emerald-200" : "border-amber-300/20 bg-amber-300/[0.05] text-amber-700 dark:text-amber-100"}`}
              >
                {connection.data?.connected ? (
                  <Link2 className="h-4 w-4" />
                ) : (
                  <WifiOff className="h-4 w-4" />
                )}
                {connection.data?.connected ? "Conectado" : "Desconectado"}
              </span>
            </div>
            {viewer.data?.isPlatformAdmin && (
              <details className="mt-3 overflow-hidden rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface)]">
                <summary className="cursor-pointer px-3 py-2.5 text-xs font-black text-[var(--mi-text-muted)]">
                  Configurações do atendimento
                </summary>
                <div className="border-t border-[var(--mi-border)] p-3">
                  {connection.data?.connected ? (
                    <Button
                      variant="outline"
                      disabled={disconnecting}
                      onClick={() => void disconnect()}
                      className="h-10 w-full rounded-xl border-rose-300/50 font-black text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                    >
                      <WifiOff className="mr-2 h-4 w-4" />
                      {disconnecting ? "Desconectando..." : "Desconectar WhatsApp"}
                    </Button>
                  ) : (
                    <Button
                      onClick={() => void connect()}
                      className="h-10 w-full rounded-xl bg-emerald-600 font-black text-white hover:bg-emerald-700"
                    >
                      <Link2 className="mr-2 h-4 w-4" /> Conectar WhatsApp por QR Code
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => void navigate({ to: "/assistente" })}
                    className="mt-2 h-10 w-full rounded-xl border-[var(--mi-border)] font-black"
                  >
                    <Bot className="mr-2 h-4 w-4" /> Configurar agente de IA
                  </Button>
                  <div className="mt-2">
                    <AttendanceDistributionPanel />
                  </div>
                </div>
              </details>
            )}
            <div className="mt-3 flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--mi-text-soft)]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por nome, telefone ou tag"
                  className="h-10 w-full rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface)] pl-9 pr-3 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <Button
                size="icon"
                variant="outline"
                onClick={() => {
                  void conversations.refetch();
                  if (selectedId) void messages.refetch();
                }}
                className="h-10 w-10 rounded-xl border-[var(--mi-border)]"
                title="Atualizar conversas"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-3 border-b border-[var(--mi-border)] bg-[var(--mi-surface)]">
            {(Object.keys(QUEUE_LABELS) as QueueTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setQueueTab(tab)}
                className={`relative px-2 py-3 text-xs font-black transition ${queueTab === tab ? "text-blue-600" : "text-[var(--mi-text-soft)] hover:text-[var(--mi-text)]"}`}
              >
                {QUEUE_LABELS[tab]}
                {queueCounts[tab] > 0 && (
                  <span className="ml-1 rounded-full bg-blue-600 px-1.5 py-0.5 text-[9px] text-white">
                    {queueCounts[tab]}
                  </span>
                )}
                {queueTab === tab && (
                  <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-blue-600" />
                )}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.map((conversation: AttendanceConversation) => (
              <button
                type="button"
                key={conversation.id}
                onClick={() => {
                  setSelectedId(conversation.id);
                  setPropertyContext(null);
                }}
                className={`flex w-full items-start gap-3 border-b border-[var(--mi-border)] px-4 py-3 text-left transition ${selectedId === conversation.id ? "bg-blue-500/10" : "hover:bg-[var(--mi-surface)]"}`}
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue-500/10 text-xs font-black text-blue-600">
                  {(conversation.contact_name || conversation.phone_e164 || "CO")
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-black">
                      {conversation.contact_name || conversation.phone_e164}
                    </span>
                    {conversation.last_message_at && (
                      <span className="shrink-0 text-[10px] text-[var(--mi-text-soft)]">
                        {new Date(conversation.last_message_at).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-[10px] font-black uppercase tracking-[0.08em] text-blue-600">
                    {conversation.protocol_code}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className="truncate text-xs text-[var(--mi-text-soft)]">
                      {conversation.last_message || "Nova conversa"}
                    </span>
                    {conversation.unread_count > 0 && (
                      <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-black text-white">
                        {conversation.unread_count}
                      </span>
                    )}
                  </span>
                  {(conversation.tags ?? []).length > 0 && (
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {conversation.tags.slice(0, 2).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md bg-[var(--mi-surface)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--mi-text-soft)]"
                        >
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </button>
            ))}
            {!filtered.length && (
              <div className="px-5 py-10 text-center text-xs text-[var(--mi-text-soft)]">
                Nenhuma conversa nesta fila.
              </div>
            )}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              <header className="flex items-center justify-between gap-3 border-b border-[var(--mi-border)] px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-black">
                      {selected.contact_name || selected.phone_e164}
                    </p>
                    <span className="rounded-full border border-[var(--mi-border)] px-2 py-0.5 text-[10px] font-black text-[var(--mi-text-soft)]">
                      {QUEUE_LABELS[selected.attendance_state]}
                    </span>
                  </div>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--mi-text-soft)]">
                    {selected.phone_masked && <LockKeyhole className="h-3 w-3" />}
                    {selected.phone_e164}
                  </p>
                  <p className="mt-1 text-[10px] font-black uppercase tracking-[0.08em] text-blue-600">
                    Protocolo {selected.protocol_code}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {selected.attendance_state === "waiting" && (
                    <Button
                      size="sm"
                      disabled={actionLoading}
                      onClick={() => void runConversationAction("claim")}
                      className="rounded-xl bg-blue-600 text-white"
                    >
                      <UserCheck className="mr-1.5 h-3.5 w-3.5" /> Iniciar atendimento
                    </Button>
                  )}
                  {selected.attendance_state === "automatic" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actionLoading}
                      onClick={() => void runConversationAction("queue")}
                      className="rounded-xl"
                    >
                      <Users className="mr-1.5 h-3.5 w-3.5" /> Mover para fila
                    </Button>
                  )}
                  {selected.attendance_state === "in_service" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actionLoading}
                      onClick={() => void runConversationAction("end")}
                      className="rounded-xl"
                    >
                      <Bot className="mr-1.5 h-3.5 w-3.5" /> Encerrar
                    </Button>
                  )}
                  <div className="hidden items-center gap-2 text-xs font-bold text-[var(--mi-text-soft)] lg:flex">
                    {connection.data?.connected ? (
                      <>
                        <Wifi className="h-4 w-4 text-emerald-600" /> WhatsApp online
                      </>
                    ) : (
                      <>
                        <WifiOff className="h-4 w-4 text-amber-600" /> WhatsApp offline
                      </>
                    )}
                  </div>
                </div>
              </header>

              {propertyContext && (
                <div className="border-b border-[var(--mi-border)] bg-blue-500/[0.04] px-5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-blue-600">
                        Imóvel relacionado
                      </p>
                      <p className="mt-1 truncate text-sm font-bold">
                        {propertyContext.title || "Imóvel selecionado"}
                      </p>
                    </div>
                    {propertyContext.url && (
                      <a
                        href={propertyContext.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-black text-blue-600"
                      >
                        Abrir anúncio <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              )}

              <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5">
                <div className="space-y-3">
                  {(messages.data ?? []).map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-5 shadow-sm ${message.direction === "outbound" ? "rounded-br-md bg-blue-600 text-white" : "rounded-bl-md border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] text-[var(--mi-text)]"}`}
                      >
                        {message.message_type === "text" ? (
                          message.body ? (
                            <p className="whitespace-pre-wrap">{message.body}</p>
                          ) : null
                        ) : (
                          <WhatsAppMessageMedia message={message} />
                        )}
                        <div
                          className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${message.direction === "outbound" ? "text-blue-100" : "text-[var(--mi-text-soft)]"}`}
                        >
                          {new Date(message.sent_at).toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {message.direction === "outbound" && <CheckCheck className="h-3 w-3" />}
                        </div>
                      </div>
                    </div>
                  ))}
                  {(messages.data?.length ?? 0) === 0 && (
                    <div className="py-20 text-center text-sm text-[var(--mi-text-soft)]">
                      Ainda não há mensagens nesta conversa.
                    </div>
                  )}
                </div>
              </div>

              <footer className="relative border-t border-[var(--mi-border)] p-4">
                <div className="mb-2 flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!aiStatus.data?.configured || drafting}
                    onClick={() => void suggest()}
                    className="rounded-xl border-blue-300/40 text-blue-600"
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />{" "}
                    {drafting ? "Gerando..." : "Sugerir resposta com IA"}
                  </Button>
                </div>

                {pendingAttachment && (
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
                          <p className="truncate text-xs font-black">
                            {pendingAttachment.fileName}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {(pendingAttachment.size / 1024 / 1024).toFixed(2)} MB · pronto para
                            enviar
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
                )}

                {showEmoji && (
                  <div className="absolute bottom-[82px] left-16 z-20 w-72 rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-3 shadow-xl">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-black">Emojis</p>
                      <button
                        type="button"
                        onClick={() => setShowEmoji(false)}
                        aria-label="Fechar emojis"
                      >
                        <X className="h-4 w-4 text-[var(--mi-text-soft)]" />
                      </button>
                    </div>
                    <div className="grid grid-cols-8 gap-1">
                      {EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => setText((current) => `${current}${emoji}`)}
                          className="grid h-8 w-8 place-items-center rounded-lg text-xl hover:bg-[var(--mi-surface-soft)]"
                          title={emoji}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="audio/webm,audio/ogg,audio/mpeg,audio/mp4,audio/aac,audio/wav,image/*,video/mp4,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                  onChange={(event) => void selectAttachment(event.target.files?.[0] ?? null)}
                />
                {isRecording ? (
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
                )}
                <p className="mt-2 text-[10px] text-[var(--mi-text-soft)]">
                  WhatsApp: mensagens de voz, imagens, vídeo MP4, PDF, documentos Office e arquivos
                  de texto · até {connection.data?.maxAttachmentMb ?? 8} MB.
                </p>
              </footer>
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div>
                <MessageCircle className="mx-auto h-10 w-10 text-[var(--mi-text-soft)]" />
                <h2 className="mt-3 text-lg font-black">Selecione uma conversa</h2>
                <p className="mt-1 text-sm text-[var(--mi-text-soft)]">
                  As mensagens recebidas pelo WhatsApp aparecerão aqui em tempo real.
                </p>
                {viewer.data?.isPlatformAdmin && !connection.data?.connected && (
                  <Button
                    onClick={() => void connect()}
                    className="mt-5 rounded-xl bg-emerald-600 text-white"
                  >
                    <Link2 className="mr-2 h-4 w-4" /> Conectar WhatsApp
                  </Button>
                )}
              </div>
            </div>
          )}
        </main>

        {selected && (
          <aside className="hidden w-[300px] shrink-0 flex-col border-l border-[var(--mi-border)] bg-[var(--mi-surface-soft)] xl:flex">
            <div className="border-b border-[var(--mi-border)] px-5 py-4">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
                Detalhes
              </p>
            </div>
            <div className="space-y-5 overflow-y-auto p-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
                  Contato
                </p>
                <p className="mt-2 text-sm font-black">
                  {selected.contact_name || "Sem nome cadastrado"}
                </p>
                <p className="mt-1 flex items-center gap-1 text-xs text-[var(--mi-text-muted)]">
                  {selected.phone_masked && <LockKeyhole className="h-3 w-3" />}
                  {selected.phone_e164}
                </p>
                {selected.phone_masked && (
                  <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-[10px] leading-4 text-amber-800">
                    Telefone protegido pela política de dados sensíveis deste usuário.
                  </p>
                )}
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
                  Atendimento
                </p>
                <div className="mt-2 space-y-2 text-xs">
                  <DetailRow label="Fila" value={QUEUE_LABELS[selected.attendance_state]} />
                  <DetailRow label="Departamento" value={selected.department_name || "Geral"} />
                  <DetailRow label="Não lidas" value={String(selected.unread_count)} />
                  <DetailRow
                    label="Última atividade"
                    value={
                      selected.last_message_at
                        ? new Date(selected.last_message_at).toLocaleString("pt-BR")
                        : "—"
                    }
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <Tag className="h-4 w-4 text-blue-600" />
                  <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
                    Tags
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(selected.tags ?? []).map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => void removeTag(tag)}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--mi-border)] bg-[var(--mi-surface)] px-2 py-1 text-[10px] font-bold"
                      title="Clique para remover"
                    >
                      {tag}
                      <X className="h-2.5 w-2.5" />
                    </button>
                  ))}
                  {!selected.tags?.length && (
                    <span className="text-xs text-[var(--mi-text-soft)]">Sem tags.</span>
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    value={tagInput}
                    onChange={(event) => setTagInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void addTag();
                      }
                    }}
                    placeholder="Nova tag"
                    className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--mi-border)] bg-[var(--mi-surface)] px-2 text-xs outline-none focus:border-blue-500"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void addTag()}
                    className="h-9 rounded-lg"
                  >
                    Adicionar
                  </Button>
                </div>
              </div>
              <div className="rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-3 text-[10px] leading-4 text-[var(--mi-text-muted)]">
                Dados sensíveis são exibidos conforme a permissão do usuário e ficam isolados por
                organização.
              </div>
            </div>
          </aside>
        )}
      </div>

      {showRealtimePanel && (
        <div className="fixed inset-0 z-50 bg-black/55 p-3 sm:p-5">
          <div className="mx-auto flex h-full max-w-[1500px] flex-col overflow-hidden rounded-[28px] border border-[var(--mi-border)] bg-[var(--mi-surface)] shadow-2xl">
            <header className="flex flex-col gap-3 border-b border-[var(--mi-border)] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600/10 text-blue-600">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-black">Dashboard de Atendimento · Tempo Real</h2>
                  <p className="text-xs text-[var(--mi-text-soft)]">
                    SLA, conversas sem resposta, risco operacional, capacidade da equipe e
                    prioridades em dados reais.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs font-bold text-[var(--mi-text-soft)]">Meu status</label>
                <select
                  value={viewer.data?.presence || "free"}
                  onChange={(event) =>
                    void updatePresence(event.target.value as AttendantPresenceStatus)
                  }
                  className="h-9 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-3 text-xs font-bold outline-none"
                >
                  {(Object.keys(PRESENCE_LABELS) as AttendantPresenceStatus[]).map((status) => (
                    <option key={status} value={status}>
                      {PRESENCE_LABELS[status]}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void dashboard.refetch()}
                  className="h-9 rounded-xl"
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Atualizar
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowRealtimePanel(false)}
                  className="h-9 w-9 rounded-xl"
                  aria-label="Fechar painel"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </header>

            <div className="border-b border-[var(--mi-border)] px-5 py-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                {(Object.keys(PRESENCE_LABELS) as AttendantPresenceStatus[]).map((status) => {
                  const checked = dashboardStatuses.includes(status);
                  return (
                    <label
                      key={status}
                      className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setDashboardStatuses((current) =>
                            checked
                              ? current.filter((item) => item !== status)
                              : [...current, status],
                          )
                        }
                        className="h-4 w-4 rounded"
                      />
                      <span className={`h-2.5 w-2.5 rounded-full ${statusDot(status)}`} />
                      {dashboard.data?.statuses?.[status] ?? 0} {PRESENCE_LABELS[status]}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="grid min-h-0 flex-1 lg:grid-cols-[230px_1fr]">
              <aside className="border-b border-[var(--mi-border)] p-4 lg:border-b-0 lg:border-r">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-black">Sumário</p>
                  <CircleAlert className="h-3.5 w-3.5 text-[var(--mi-text-soft)]" />
                </div>
                <label className="mt-4 block text-[10px] font-bold text-[var(--mi-text-soft)]">
                  Período
                </label>
                <select
                  value={dashboardPeriod}
                  onChange={(event) => setDashboardPeriod(event.target.value as DashboardPeriod)}
                  className="mt-1 h-10 w-full rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] px-3 text-sm outline-none"
                >
                  <option value="today">Hoje</option>
                  <option value="7d">Últimos 7 dias</option>
                  <option value="30d">Últimos 30 dias</option>
                </select>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <SummaryMetric value={String(dashboard.data?.waiting ?? 0)} label="em espera" />
                  <SummaryMetric value={String(dashboard.data?.attended ?? 0)} label="atendidos" />
                  <SummaryMetric
                    value={formatSeconds(dashboard.data?.avgWaitSeconds ?? 0)}
                    label="tempo médio de espera"
                  />
                  <SummaryMetric
                    value={formatSeconds(dashboard.data?.avgResponseSeconds ?? 0)}
                    label="tempo médio de resposta"
                  />
                  <SummaryMetric
                    value={formatSeconds(dashboard.data?.avgAttendanceSeconds ?? 0)}
                    label="tempo médio de atendimento"
                  />
                </div>
              </aside>

              <section className="min-h-0 overflow-y-auto p-5">
                <AttendanceDecisionDashboard
                  startIso={startIsoForPeriod(dashboardPeriod)}
                  onOpenConversation={(conversationId, state) => {
                    setSelectedId(conversationId);
                    setQueueTab(state);
                    setShowRealtimePanel(false);
                  }}
                />

                <div className="flex flex-col gap-3 border-t border-[var(--mi-border)] pt-6 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-black">Equipe de atendimento</p>
                    <p className="mt-1 text-xs text-[var(--mi-text-soft)]">
                      Status atualizado em tempo real e quantidade de conversas em atendimento.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <div className="relative w-full sm:w-64">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--mi-text-soft)]" />
                      <input
                        value={dashboardSearch}
                        onChange={(event) => setDashboardSearch(event.target.value)}
                        placeholder="Buscar atendente"
                        className="h-10 w-full rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] pl-9 pr-3 text-sm outline-none"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-10 w-10 rounded-xl"
                      title="Filtros ativos"
                    >
                      <Filter className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="mt-5 overflow-hidden rounded-2xl border border-[var(--mi-border)]">
                  <div className="hidden grid-cols-[1.5fr_1fr_120px_170px] gap-3 bg-[var(--mi-surface-soft)] px-4 py-3 text-[10px] font-black uppercase tracking-[0.1em] text-[var(--mi-text-soft)] md:grid">
                    <span>Atendente</span>
                    <span>Status</span>
                    <span>Conversas</span>
                    <span>Dados sensíveis</span>
                  </div>
                  {filteredAgents.map((agent) => (
                    <div
                      key={agent.userId}
                      className="grid gap-3 border-t border-[var(--mi-border)] px-4 py-4 md:grid-cols-[1.5fr_1fr_120px_170px] md:items-center"
                    >
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-blue-600/10 text-xs font-black text-blue-600">
                          {agent.name.slice(0, 2).toUpperCase()}
                        </span>
                        <div>
                          <p className="text-sm font-black">{agent.name}</p>
                          <p className="text-[10px] text-[var(--mi-text-soft)]">
                            desde{" "}
                            {new Date(agent.statusSince).getFullYear() > 2000
                              ? new Date(agent.statusSince).toLocaleTimeString("pt-BR", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "—"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs font-bold">
                        <span className={`h-2.5 w-2.5 rounded-full ${statusDot(agent.status)}`} />
                        {PRESENCE_LABELS[agent.status]}
                      </div>
                      <div className="text-sm font-black">{agent.activeConversations}</div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-1 text-[10px] font-black ${agent.canViewSensitiveData ? "bg-emerald-500/10 text-emerald-700" : "bg-slate-500/10 text-slate-600"}`}
                        >
                          {agent.canViewSensitiveData ? "Visível" : "Protegido"}
                        </span>
                        {dashboard.data?.canManageSensitiveVisibility && (
                          <button
                            type="button"
                            onClick={() =>
                              void toggleSensitivePermission(
                                agent.userId,
                                !agent.canViewSensitiveData,
                              )
                            }
                            className="text-[10px] font-black text-blue-600 hover:underline"
                          >
                            Alterar
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {!filteredAgents.length && (
                    <div className="grid min-h-56 place-items-center p-6 text-center text-sm text-[var(--mi-text-soft)]">
                      <div>
                        <Users className="mx-auto mb-2 h-7 w-7" />
                        Nenhum atendente corresponde aos filtros.
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-3 text-xs leading-5 text-[var(--mi-text-muted)]">
                  <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                  <span>
                    A visibilidade de dados sensíveis é controlada por usuário. Proprietários e
                    administradores mantêm acesso; os demais podem ter o telefone mascarado sem
                    afetar o envio de mensagens.
                  </span>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {showQr && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-slate-950 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-black">Conectar meu WhatsApp</h2>
              <button type="button" onClick={() => setShowQr(false)} aria-label="Fechar">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              No WhatsApp do celular, abra Configurações → Aparelhos conectados → Conectar aparelho
              e leia o QR Code abaixo.
            </p>
            <div className="mt-5 grid min-h-60 place-items-center rounded-2xl bg-slate-50 p-4">
              {qrBase64 ? (
                <img
                  src={
                    qrBase64.startsWith("data:") ? qrBase64 : `data:image/png;base64,${qrBase64}`
                  }
                  alt="QR Code para conectar o WhatsApp"
                  className="h-56 w-56"
                />
              ) : qrCode ? (
                <div className="break-all rounded-xl bg-white p-3 text-xs text-slate-600">
                  {qrCode}
                </div>
              ) : (
                <div className="text-center">
                  <RefreshCw
                    className={`mx-auto h-7 w-7 text-slate-400 ${qrLoading ? "animate-spin" : ""}`}
                  />
                  <p className="mt-3 text-sm text-slate-500">
                    Gerando QR Code seguro para esta conta...
                  </p>
                </div>
              )}
            </div>
            {pairingCode && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                  Código de pareamento
                </p>
                <p className="mt-1 font-mono text-xl font-black tracking-[0.18em]">{pairingCode}</p>
              </div>
            )}
            <p className="mt-3 text-center text-xs text-slate-500">
              O status é atualizado automaticamente. Após a leitura, esta janela fecha quando a
              conexão estiver online.
            </p>
            <Button
              variant="outline"
              onClick={() => void refreshQr()}
              disabled={qrLoading}
              className="mt-4 h-10 w-full rounded-xl"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${qrLoading ? "animate-spin" : ""}`} /> Atualizar
              QR Code
            </Button>
            <Button
              onClick={() => {
                setShowQr(false);
                void connection.refetch();
              }}
              className="mt-2 h-11 w-full rounded-xl bg-blue-600 font-black text-white"
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Voltar ao atendimento
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[var(--mi-text-soft)]">{label}</span>
      <span className="text-right font-bold">{value}</span>
    </div>
  );
}

function SummaryMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface)] px-3 py-4 text-center">
      <p className="text-xl font-black">{value}</p>
      <p className="mt-1 text-[10px] leading-4 text-[var(--mi-text-soft)]">{label}</p>
    </div>
  );
}
