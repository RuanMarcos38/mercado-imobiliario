import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, CreditCard, ExternalLink, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  createSubscriberPortal,
  createSubscriptionCheckout,
  getMyBillingOverview,
} from "@/lib/billing.functions";

export const Route = createFileRoute("/_authenticated/assinatura")({
  component: SubscriptionPage,
  head: () => ({ title: "Assinatura | MercadoImobi" }),
});

const statusLabel: Record<string, string> = {
  trialing: "Período de teste",
  active: "Ativa",
  past_due: "Pagamento pendente",
  canceled: "Cancelada",
  unpaid: "Pagamento necessário",
};

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function date(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(value));
}

function SubscriptionPage() {
  const overviewFn = useServerFn(getMyBillingOverview);
  const checkoutFn = useServerFn(createSubscriptionCheckout);
  const portalFn = useServerFn(createSubscriberPortal);
  const overview = useQuery({ queryKey: ["my-billing"], queryFn: () => overviewFn() });
  const subscription = overview.data?.subscription;
  const currentStatus = subscription?.status ?? "sem_assinatura";

  const checkout = async () => {
    try {
      const result = await checkoutFn();
      window.location.assign(result.url);
    } catch (error) {
      const message = String((error as Error)?.message ?? "");
      toast.error(
        message.includes("STRIPE_NOT_CONFIGURED")
          ? "O checkout ainda precisa das credenciais de cobrança no servidor."
          : "Não foi possível abrir o pagamento agora.",
      );
    }
  };

  const portal = async () => {
    try {
      const result = await portalFn();
      window.location.assign(result.url);
    } catch {
      toast.error("O portal de cobrança estará disponível após a primeira assinatura.");
    }
  };

  return (
    <div className="min-h-screen bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1200px]">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">
              Assinantes
            </p>
            <h1 className="mt-2 text-3xl font-black">Plano e acesso à plataforma</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--mi-text-muted)]">
              Acompanhe sua assinatura, período de acesso e cobrança sem sair do ambiente do
              MercadoImobi.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] px-5 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[var(--mi-text-soft)]">
              Status
            </p>
            <p className="mt-1 text-sm font-black text-blue-600">
              {statusLabel[currentStatus] ?? "Aguardando contratação"}
            </p>
          </div>
        </div>

        <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-6">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-600/10 text-blue-600">
                <CreditCard className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-black">Sua assinatura</h2>
                <p className="text-xs text-[var(--mi-text-muted)]">
                  Cobrança recorrente e controle de acesso.
                </p>
              </div>
            </div>

            {overview.isLoading ? (
              <div className="mt-6 h-40 animate-pulse rounded-2xl bg-[var(--mi-bg-soft)]" />
            ) : (
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <Metric label="Situação" value={statusLabel[currentStatus] ?? "Sem assinatura"} />
                <Metric
                  label="Fim do período"
                  value={date(subscription?.currentPeriodEnd ?? subscription?.trialEnd)}
                />
                <Metric
                  label="Gateway"
                  value={overview.data?.configured ? "Configurado" : "Aguardando configuração"}
                />
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => void checkout()} disabled={!overview.data?.configured}>
                <CreditCard className="mr-2 h-4 w-4" />
                {subscription?.status === "active" ? "Alterar/renovar plano" : "Assinar agora"}
              </Button>
              {subscription?.stripeCustomerId && (
                <Button variant="outline" onClick={() => void portal()}>
                  <ExternalLink className="mr-2 h-4 w-4" /> Gerenciar cobrança
                </Button>
              )}
            </div>

            {!overview.data?.configured && (
              <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-sm leading-6 text-[var(--mi-text-muted)]">
                A área de assinantes já está pronta. O botão de pagamento será habilitado quando as
                credenciais do gateway forem configuradas no EasyPanel.
              </div>
            )}
          </section>

          <aside className="rounded-[26px] border border-blue-500/20 bg-blue-600/[0.05] p-6">
            <div className="flex items-center gap-2 text-blue-600">
              <ShieldCheck className="h-5 w-5" />
              <h2 className="font-black">Acesso protegido</h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--mi-text-muted)]">
              A assinatura fica vinculada ao seu usuário. Dados de CRM, conversas, documentos e
              configurações continuam isolados da conta de outros assinantes.
            </p>
            <div className="mt-5 space-y-3 text-sm">
              {[
                "Ambiente individual por organização",
                "Cobrança recorrente",
                "Controle de status da conta",
                "Portal de autoatendimento",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>

        {(overview.data?.plans?.length ?? 0) > 0 && (
          <section className="mt-6 rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-6">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-blue-600" />
              <h2 className="font-black">Planos disponíveis</h2>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {overview.data?.plans.map((plan) => (
                <div key={plan.id} className="rounded-2xl border border-[var(--mi-border)] p-5">
                  <p className="font-black">{plan.name}</p>
                  <p className="mt-2 text-2xl font-black text-blue-600">
                    {money(plan.priceMonthly)}
                    <span className="text-xs font-medium text-[var(--mi-text-soft)]">/mês</span>
                  </p>
                  <div className="mt-4 space-y-2">
                    {plan.features.map((feature) => (
                      <p key={feature} className="flex gap-2 text-xs text-[var(--mi-text-muted)]">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />{" "}
                        {feature}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--mi-text-soft)]">
        {label}
      </p>
      <p className="mt-2 text-sm font-black">{value}</p>
    </div>
  );
}
