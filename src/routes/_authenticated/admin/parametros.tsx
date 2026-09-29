import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPlatformParameterOverview } from "@/lib/platform-parameters.functions";

export const Route = createFileRoute("/_authenticated/admin/parametros")({
  component: PlatformParametersPage,
  head: () => ({ title: "Status da plataforma | MercadoImobi" }),
});

function friendlyServiceName(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes("openai")) return "Assistente inteligente";
  if (normalized.includes("google") && (normalized.includes("maps") || normalized.includes("places"))) {
    return "Pesquisa de empresas";
  }
  if (normalized.includes("whatsapp")) return "WhatsApp";
  if (normalized.includes("direct") || normalized.includes("messenger")) return "Mensagens sociais";
  if (normalized.includes("smtp") || normalized.includes("e-mail") || normalized.includes("email")) {
    return "E-mail";
  }
  if (normalized.includes("stripe")) return "Pagamentos";
  if (normalized.includes("twilio") || normalized.includes("discador")) return "Telefonia";
  if (normalized.includes("cca")) return "Documentos";
  if (normalized.includes("lead")) return "Captação de leads";
  return label
    .replace(/\bAPI\b/gi, "")
    .replace(/\bOAuth\b/gi, "")
    .replace(/\bWebhook\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function PlatformParametersPage() {
  const overviewFn = useServerFn(getPlatformParameterOverview);
  const overview = useQuery({
    queryKey: ["platform-parameter-overview"],
    queryFn: () => overviewFn(),
  });

  return (
    <div className="min-h-[calc(100vh-64px)] bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1200px]">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">
              Administração
            </p>
            <h1 className="mt-2 text-3xl font-black">Status da plataforma</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--mi-text-muted)]">
              Visão simples dos serviços utilizados pela operação. Informações internas e detalhes
              técnicos permanecem ocultos na interface.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void overview.refetch()}
            className="rounded-xl border-[var(--mi-border)]"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${overview.isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>

        {overview.error ? (
          <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
            Não foi possível atualizar o status dos serviços neste momento.
          </div>
        ) : (
          <section className="mt-6 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-black">Serviços da plataforma</h2>
                <p className="mt-1 text-xs text-[var(--mi-text-muted)]">
                  A disponibilidade é verificada automaticamente.
                </p>
              </div>
              <span className="text-xs font-bold text-[var(--mi-text-soft)]">
                {overview.data
                  ? `${overview.data.integrations.filter((item) => item.configured).length} ativos`
                  : "Carregando..."}
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(overview.data?.integrations ?? []).map((service) => (
                <div
                  key={service.key}
                  className="rounded-lg border border-[var(--mi-border)] bg-[var(--mi-bg)] p-4"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        service.configured ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                    />
                    <p className="text-sm font-black">{friendlyServiceName(service.label)}</p>
                  </div>
                  <p
                    className={`mt-2 text-[10px] font-bold uppercase tracking-[0.1em] ${
                      service.configured ? "text-emerald-700" : "text-[var(--mi-text-soft)]"
                    }`}
                  >
                    {service.configured ? "Ativo" : "Indisponível"}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
