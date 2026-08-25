import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bot,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  HardDrive,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  createSubscriberPortal,
  createSubscriptionCheckout,
  getMyBillingOverview,
  type BillingPlan,
} from "@/lib/billing.functions";

export const Route = createFileRoute("/_authenticated/assinatura")({
  component: SubscriptionPage,
  head: () => ({ title: "Planos e Assinatura | MercadoImobi" }),
});

const statusLabel: Record<string, string> = {
  trialing: "Período de teste",
  active: "Ativa",
  past_due: "Pagamento pendente",
  canceled: "Cancelada",
  unpaid: "Pagamento necessário",
};

// Exibe exatamente o valor mensal cadastrado no plano.
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

  const checkout = async (plan: BillingPlan, paymentMethod?: "PIX" | "BOLETO" | "CREDIT_CARD") => {
    if (!plan.selfService) {
      toast.info(
        "O plano Enterprise é contratado sob proposta. Solicite a ativação ao administrador.",
      );
      return;
    }
    const paymentWindow = window.open("about:blank", "_blank");
    if (!paymentWindow) {
      toast.error("Permita a abertura de pop-ups para abrir o pagamento em uma nova aba.");
      return;
    }
    paymentWindow.opener = null;
    try {
      const result = await checkoutFn({ data: { planId: plan.id, paymentMethod } });
      paymentWindow.location.replace(result.url);
    } catch (error) {
      paymentWindow.close();
      const message = String((error as Error)?.message ?? "");
      if (message.includes("ACTIVE_SUBSCRIPTION_USE_PORTAL")) {
        toast.info(
          "Sua assinatura já está ativa. Use o portal de cobrança para gerenciar a contratação.",
        );
        await portal();
        return;
      }
      toast.error(
        message.includes("STRIPE_NOT_CONFIGURED")
          ? "O checkout ainda precisa das credenciais de cobrança no servidor."
          : message.includes("PLAN_REQUIRES_COMMERCIAL")
            ? "Este plano é contratado diretamente com o administrador."
            : "Não foi possível abrir o pagamento agora.",
      );
    }
  };

  const portal = async () => {
    try {
      const result = await portalFn();
      window.location.assign(result.url);
    } catch {
      toast.error("O portal de cobrança estará disponível após a primeira assinatura paga.");
    }
  };

  return (
    <div className="min-h-screen bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1500px]">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">
              Planos MercadoImobi
            </p>
            <h1 className="mt-2 text-3xl font-black">
              Escolha a estrutura ideal para sua operação
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--mi-text-muted)]">
              Cada contratação libera automaticamente os módulos e limites correspondentes ao plano,
              preservando seus dados, CRM, conversas e configurações.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface)] px-5 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[var(--mi-text-soft)]">
              Status da conta
            </p>
            <p className="mt-1 text-sm font-black text-blue-600">
              {statusLabel[currentStatus] ?? "Aguardando contratação"}
            </p>
          </div>
        </div>

        <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_380px]">
          <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-6">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-600/10 text-blue-600">
                <CreditCard className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-black">Sua assinatura</h2>
                <p className="text-xs text-[var(--mi-text-muted)]">
                  Plano, período e cobrança recorrente vinculados à sua conta.
                </p>
              </div>
            </div>

            {overview.isLoading ? (
              <div className="mt-6 h-40 animate-pulse rounded-2xl bg-[var(--mi-bg-soft)]" />
            ) : (
              <div className="mt-6 grid gap-3 sm:grid-cols-4">
                <Metric
                  label="Plano atual"
                  value={subscription?.planName ?? "Sem plano definido"}
                />
                <Metric label="Situação" value={statusLabel[currentStatus] ?? "Sem assinatura"} />
                <Metric
                  label="Fim do período"
                  value={date(subscription?.currentPeriodEnd ?? subscription?.trialEnd)}
                />
                <Metric
                  label="Pagamento"
                  value={overview.data?.configured ? "Checkout disponível" : "Aguardando gateway"}
                />
              </div>
            )}

            {subscription?.stripeCustomerId && (
              <div className="mt-6">
                <Button variant="outline" onClick={() => void portal()}>
                  <ExternalLink className="mr-2 h-4 w-4" /> Gerenciar cobrança
                </Button>
              </div>
            )}

            {!overview.data?.configured && (
              <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-sm leading-6 text-[var(--mi-text-muted)]">
                Os planos e regras de acesso já estão cadastrados. A contratação online será
                habilitada assim que a chave do gateway estiver disponível no servidor.
              </div>
            )}
          </section>

          <aside className="rounded-[26px] border border-blue-500/20 bg-blue-600/[0.05] p-6">
            <div className="flex items-center gap-2 text-blue-600">
              <ShieldCheck className="h-5 w-5" />
              <h2 className="font-black">Liberação automática</h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--mi-text-muted)]">
              Depois da confirmação do pagamento, o MercadoImobi reconhece o plano contratado e
              mantém liberados somente os recursos incluídos nele. O administrador continua podendo
              conceder exceções individuais quando necessário.
            </p>
            <div className="mt-5 space-y-3 text-sm">
              {[
                "Dados isolados por usuário e organização",
                "Plano vinculado à assinatura",
                "Controle de módulos e limites",
                "Upgrade sem perder dados",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>

        <section className="mt-7">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-blue-600" />
                <h2 className="text-xl font-black">Planos disponíveis</h2>
              </div>
              <p className="mt-1 text-sm text-[var(--mi-text-muted)]">
                Valores mensais. A implantação é cobrada uma única vez na primeira contratação.
              </p>
            </div>
            <p className="text-xs font-bold text-[var(--mi-text-soft)]">
              Pro IA é o plano recomendado para corretores que querem automação completa.
            </p>
          </div>

          {overview.isLoading ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className="h-[520px] animate-pulse rounded-[24px] bg-[var(--mi-surface)]"
                />
              ))}
            </div>
          ) : (
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {(overview.data?.plans ?? []).map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  current={subscription?.planId === plan.id}
                  checkoutConfigured={Boolean(overview.data?.configured)}
                  billingProvider={overview.data?.provider ?? null}
                  onChoose={(paymentMethod) => void checkout(plan, paymentMethod)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="mt-7 rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-6">
          <h2 className="text-lg font-black">Como os planos são aplicados</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-4">
            <FlowStep
              number="01"
              title="Escolha"
              text="O usuário seleciona o plano ideal para sua operação."
            />
            <FlowStep
              number="02"
              title="Pagamento"
              text="O checkout registra usuário e plano na mesma contratação."
            />
            <FlowStep
              number="03"
              title="Reconhecimento"
              text="O webhook confirma a assinatura e vincula o plano à conta."
            />
            <FlowStep
              number="04"
              title="Liberação"
              text="Módulos e limites ficam disponíveis conforme os direitos do plano."
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  current,
  checkoutConfigured,
  billingProvider,
  onChoose,
}: {
  plan: BillingPlan;
  current: boolean;
  checkoutConfigured: boolean;
  billingProvider: "asaas" | "stripe" | null;
  onChoose: (paymentMethod?: "PIX" | "BOLETO" | "CREDIT_CARD") => void;
}) {
  return (
    <article
      className={`relative flex min-h-[520px] flex-col rounded-[24px] border p-5 transition ${
        plan.recommended
          ? "border-blue-500 bg-blue-600/[0.04] shadow-[0_16px_50px_rgba(37,99,235,0.12)]"
          : "border-[var(--mi-border)] bg-[var(--mi-surface)]"
      }`}
    >
      {(plan.badge || current) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {plan.badge && (
            <span className="rounded-full bg-blue-600 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.08em] text-white">
              {plan.badge}
            </span>
          )}
          {current && (
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.08em] text-emerald-700">
              Seu plano
            </span>
          )}
        </div>
      )}

      <h3 className="text-lg font-black">{plan.name}</h3>
      <p className="mt-1 min-h-10 text-xs leading-5 text-[var(--mi-text-muted)]">{plan.tagline}</p>
      <div className="mt-4">
        <p className="text-3xl font-black tracking-tight text-blue-600">
          {money(plan.priceMonthly)}
        </p>
        <p className="text-xs font-bold text-[var(--mi-text-soft)]">por mês</p>
        {plan.onboardingFee > 0 ? (
          <p className="mt-2 text-[10px] text-[var(--mi-text-muted)]">
            Implantação única: <strong>{money(plan.onboardingFee)}</strong>
          </p>
        ) : (
          <p className="mt-2 text-[10px] text-[var(--mi-text-muted)]">Implantação sob proposta</p>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-[10px]">
        <Limit icon={Users} label={`${plan.userLimit} usuário${plan.userLimit > 1 ? "s" : ""}`} />
        <Limit
          icon={MessageCircle}
          label={
            plan.whatsappConnections ? `${plan.whatsappConnections} WhatsApp` : "Sem WhatsApp IA"
          }
        />
        <Limit
          icon={Bot}
          label={
            plan.aiInteractionsMonthly
              ? `${plan.aiInteractionsMonthly.toLocaleString("pt-BR")} IA/mês`
              : "IA sob upgrade"
          }
        />
        <Limit icon={HardDrive} label={`${plan.storageGb} GB`} />
      </div>

      <div className="mt-5 flex-1 space-y-2.5">
        {plan.highlights.map((feature) => (
          <p key={feature} className="flex gap-2 text-xs leading-5 text-[var(--mi-text-muted)]">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            {feature}
          </p>
        ))}
      </div>

      {current ? (
        <Button className="mt-5 w-full" disabled>
          Plano atual
        </Button>
      ) : plan.selfService && billingProvider === "asaas" ? (
        <div className="mt-5 space-y-2">
          <p className="text-center text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
            Escolha a forma de pagamento
          </p>
          <Button
            className="w-full"
            variant={plan.recommended ? "default" : "outline"}
            disabled={!checkoutConfigured}
            onClick={() => onChoose("PIX")}
          >
            Pix (QR Code)
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              disabled={!checkoutConfigured}
              onClick={() => onChoose("BOLETO")}
            >
              Boleto
            </Button>
            <Button
              variant="outline"
              disabled={!checkoutConfigured}
              onClick={() => onChoose("CREDIT_CARD")}
            >
              Cartão
            </Button>
          </div>
          <p className="text-center text-[10px] leading-4 text-[var(--mi-text-soft)]">
            O pagamento abre em uma nova aba e o MercadoImobi permanece aberto.
          </p>
        </div>
      ) : (
        <Button
          className="mt-5 w-full"
          variant={plan.recommended ? "default" : "outline"}
          disabled={plan.selfService && !checkoutConfigured}
          onClick={() => onChoose()}
        >
          {plan.selfService ? "Contratar este plano" : "Solicitar Enterprise"}
        </Button>
      )}
    </article>
  );
}

function Limit({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-xl bg-[var(--mi-bg)] px-2 py-2 font-bold text-[var(--mi-text-muted)]">
      <Icon className="h-3.5 w-3.5 text-blue-600" />
      <span>{label}</span>
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

function FlowStep({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <div className="rounded-2xl bg-[var(--mi-bg)] p-4">
      <p className="text-[10px] font-black tracking-[0.15em] text-blue-600">{number}</p>
      <p className="mt-2 text-sm font-black">{title}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--mi-text-muted)]">{text}</p>
    </div>
  );
}
