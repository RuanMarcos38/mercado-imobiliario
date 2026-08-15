import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, ShieldCheck, Loader2 } from "lucide-react";

export const Route = createFileRoute("/[.lovable/oauth/consent]")({
  component: OAuthConsentPage,
});

function OAuthConsentPage() {
  const [session, setSession] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const searchParams = Route.useSearch() as any;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate({
          to: "/auth",
          search: { next: window.location.pathname + window.location.search },
        });
      } else {
        setSession(session);
        setIsLoading(false);
      }
    });
  }, [navigate]);

  const handleApprove = () => {
    const callbackUrl = searchParams.redirect_uri || searchParams.callback_url;
    if (!callbackUrl) {
      console.error("Missing redirect_uri");
      return;
    }

    const url = new URL(callbackUrl);
    url.searchParams.set("code", "mock_code_for_now"); // Em produção, o backend geraria o code real
    url.searchParams.set("state", searchParams.state || "");

    window.location.href = url.toString();
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-primary/10 rounded-full">
              <ShieldCheck className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle>Autorizar Acesso</CardTitle>
          <CardDescription>
            O Agente de IA da Casa Conectada solicita permissão para acessar seus imóveis e leads.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4 text-sm">
            <div className="flex items-start gap-3">
              <div className="mt-1 p-1 bg-green-500/10 rounded-full">
                <div className="h-2 w-2 bg-green-500 rounded-full" />
              </div>
              <p>Ver seus imóveis e realizar buscas.</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="mt-1 p-1 bg-green-500/10 rounded-full">
                <div className="h-2 w-2 bg-green-500 rounded-full" />
              </div>
              <p>Gerenciar seus leads e notas de qualificação.</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-4">
            <Button onClick={handleApprove} className="w-full">
              Autorizar Agente
            </Button>
            <Button
              variant="ghost"
              onClick={() => navigate({ to: "/dashboard" })}
              className="w-full"
            >
              Cancelar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
