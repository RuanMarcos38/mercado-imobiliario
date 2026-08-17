import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PropertyWorkspace } from "@/components/property/PropertyWorkspace";
import { startWhatsAppConversation } from "@/lib/whatsapp-conversation.functions";

type MarketMode = "all" | "market" | "caixa" | "auction";

export function PropertyWorkspaceAtendimento({
  initialMarket = "all",
}: {
  initialMarket?: MarketMode;
}) {
  const navigate = useNavigate();
  const startConversationFn = useServerFn(startWhatsAppConversation);
  const rootRef = useRef<HTMLDivElement>(null);
  const launchingRef = useRef(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const handlePhoneClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const phoneLink = target?.closest('a[href^="tel:"]') as HTMLAnchorElement | null;
      if (!phoneLink || !root.contains(phoneLink)) return;

      event.preventDefault();
      event.stopPropagation();

      const phone = decodeURIComponent(phoneLink.getAttribute("href")?.slice(4) ?? "").trim();
      if (!phone || launchingRef.current) return;

      launchingRef.current = true;
      void startConversationFn({ data: { phone } })
        .then((conversation) => {
          sessionStorage.setItem("mercadoimobi:selectedConversation", conversation.id);
          void navigate({ to: "/atendimento" });
        })
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Não foi possível abrir o atendimento para este telefone.",
          );
        })
        .finally(() => {
          launchingRef.current = false;
        });
    };

    root.addEventListener("click", handlePhoneClick, true);
    return () => root.removeEventListener("click", handlePhoneClick, true);
  }, [navigate, startConversationFn]);

  return (
    <div ref={rootRef} className="contents">
      <PropertyWorkspace initialMarket={initialMarket} />
    </div>
  );
}
