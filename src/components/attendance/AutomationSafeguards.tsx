import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Hand } from "lucide-react";
import { toast } from "sonner";
import {
  getConversationAiMode,
  getUnansweredCustomerAlerts,
  setConversationAiMode,
} from "@/lib/customer-automation.functions";

export function ConversationAiControl({
  conversationId,
  compact = true,
}: {
  conversationId: string;
  compact?: boolean;
}) {
  const getMode = useServerFn(getConversationAiMode);
  const setMode = useServerFn(setConversationAiMode);
  const mode = useQuery({
    queryKey: ["conversation-ai-mode", conversationId],
    queryFn: () => getMode({ data: { conversationId } }),
    staleTime: 10_000,
  });

  const enabled = mode.data?.enabled !== false;
  const toggle = async () => {
    if (mode.isFetching) return;
    try {
      await setMode({ data: { conversationId, enabled: !enabled } });
      await mode.refetch();
      toast.success(
        enabled
          ? "IA pausada nesta conversa. O atendimento ficou manual."
          : "Agente de IA reativado nesta conversa.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível alterar o modo da IA.",
      );
    }
  };

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      title={enabled ? "Pausar IA nesta conversa" : "Reativar IA nesta conversa"}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-black transition ${
        enabled
          ? "border-emerald-300/40 bg-emerald-500/[0.06] text-emerald-700"
          : "border-amber-300/40 bg-amber-500/[0.06] text-amber-700"
      }`}
      aria-pressed={!enabled}
    >
      {enabled ? <Bot className="h-3.5 w-3.5" /> : <Hand className="h-3.5 w-3.5" />}
      {compact ? (enabled ? "IA" : "Manual") : enabled ? "IA ativa" : "Atendimento manual"}
      <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-emerald-500" : "bg-amber-500"}`} />
    </button>
  );
}

export function ResponseGuardPopup({
  onOpenConversation,
}: {
  onOpenConversation?: (conversationId: string) => void;
}) {
  const getAlerts = useServerFn(getUnansweredCustomerAlerts);
  const announced = useRef(new Set<string>());
  const alerts = useQuery({
    queryKey: ["attendance-response-guard"],
    queryFn: () => getAlerts(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!alerts.data?.length || typeof window === "undefined") return;
    for (const item of alerts.data.slice(0, 5)) {
      const storageKey = `mercadoimobi:response-risk:${item.conversationId}`;
      const previous = Number(sessionStorage.getItem(storageKey) || "0");
      const canRepeat = Date.now() - previous > 30 * 60_000;
      if (announced.current.has(item.conversationId) || !canRepeat) continue;
      announced.current.add(item.conversationId);
      sessionStorage.setItem(storageKey, String(Date.now()));
      toast.warning(`${item.contactName} está sem resposta`, {
        description: `A última mensagem do cliente foi há ${item.hoursWaiting}h e não há resposta posterior do corretor.`,
        duration: 12_000,
        action: onOpenConversation
          ? {
              label: "Abrir conversa",
              onClick: () => onOpenConversation(item.conversationId),
            }
          : undefined,
      });
    }
  }, [alerts.data, onOpenConversation]);

  return null;
}
