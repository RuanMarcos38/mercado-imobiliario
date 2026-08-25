import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Network, RefreshCw, UserPlus, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAffiliateOverview, linkMyAffiliateSponsor } from "@/lib/affiliate.functions";

export const Route = createFileRoute("/_authenticated/afiliados")({
  component: AffiliateWalletPage,
  head: () => ({ title: "Afiliados / Wallet | MercadoImobi" }),
});

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);

function AffiliateWalletPage() {
  const overviewFn = useServerFn(getAffiliateOverview);
  const sponsorFn = useServerFn(linkMyAffiliateSponsor);
  const [sponsorCode, setSponsorCode] = useState("");
  const [linking, setLinking] = useState(false);
  const overview = useQuery({ queryKey: ["affiliate-wallet"], queryFn: () => overviewFn() });

  const copyLink = async () => {
    if (!overview.data?.referralCode) return;
    const link = `${window.location.origin}/auth?ref=${encodeURIComponent(overview.data.referralCode)}`;
    await navigator.clipboard.writeText(link);
    toast.success("Link de indicação copiado.");
  };

  const linkSponsor = async () => {
    if (!sponsorCode.trim() || linking) return;
    setLinking(true);
    try {
      await sponsorFn({ data: { referralCode: sponsorCode.trim() } });
      setSponsorCode("");
      await overview.refetch();
      toast.success("Indicador vinculado à sua conta.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível vincular o indicador.",
      );
    } finally {
      setLinking(false);
    }
  };

  if (overview.isLoading) {
    return <div className="p-8 text-sm text-[var(--mi-text-muted)]">Carregando sua Wallet...</div>;
  }
  if (overview.error || !overview.data) {
    return (
      <div className="m-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
        Não foi possível carregar o programa de afiliados.{" "}
        {String((overview.error as Error)?.message ?? "")}
      </div>
    );
  }

  const data = overview.data;
  const referralLink = `${window.location.origin}/auth?ref=${encodeURIComponent(data.referralCode)}`;

  return (
    <div className="min-h-screen bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">
              Indicações
            </p>
            <h1 className="mt-2 text-3xl font-black">Afiliados / Wallet</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--mi-text-muted)]">
              Sua indicação direta recebe {Math.round(data.rates.direct * 100)}% e os níveis
              seguintes recebem {Math.round(data.rates.network * 100)}% por nível, até{" "}
              {data.rates.maxDepth} níveis. A comissão é calculada somente sobre assinaturas
              efetivamente pagas; cadastro ou recrutamento sem venda não gera comissão.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void overview.refetch()}
            disabled={overview.isFetching}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${overview.isFetching ? "animate-spin" : ""}`} />{" "}
            Atualizar
          </Button>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Saldo disponível" value={money(data.wallet.available)} />
          <Metric label="Em validação" value={money(data.wallet.pending)} />
          <Metric label="Total acumulado" value={money(data.wallet.total)} />
          <Metric label="Rede total" value={String(data.networkReferrals)} />
        </div>

        <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-500/10 text-blue-600">
              <WalletCards className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-black">Seu link de indicação</h2>
              <p className="mt-1 text-xs text-[var(--mi-text-muted)]">
                Código: <strong>{data.referralCode}</strong>
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Input readOnly value={referralLink} className="font-mono text-xs" />
                <Button onClick={() => void copyLink()}>
                  <Copy className="mr-2 h-4 w-4" /> Copiar link
                </Button>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
            <div className="mb-4 flex items-center gap-3">
              <Network className="h-5 w-5 text-blue-600" />
              <div>
                <h2 className="font-black">Sua rede</h2>
                <p className="text-xs text-[var(--mi-text-muted)]">
                  {data.directReferrals} indicação(ões) direta(s) · {data.networkReferrals}{" "}
                  pessoa(s) na rede
                </p>
              </div>
            </div>
            {data.sponsor ? (
              <div className="rounded-xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-4 text-sm">
                <p className="text-xs font-black uppercase tracking-[0.1em] text-[var(--mi-text-soft)]">
                  Seu indicador
                </p>
                <p className="mt-2 font-black">{data.sponsor.name}</p>
                <p className="mt-1 text-xs text-[var(--mi-text-muted)]">
                  {data.sponsor.referralCode}
                </p>
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border border-dashed border-[var(--mi-border)] p-4">
                <div className="flex items-center gap-2">
                  <UserPlus className="h-4 w-4 text-blue-600" />
                  <p className="text-sm font-black">Vincular quem indicou você</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={sponsorCode}
                    onChange={(event) => setSponsorCode(event.target.value)}
                    placeholder="Ex.: MI-..."
                  />
                  <Button
                    onClick={() => void linkSponsor()}
                    disabled={linking || !sponsorCode.trim()}
                  >
                    {linking ? "Vinculando..." : "Vincular"}
                  </Button>
                </div>
                <p className="text-[11px] text-[var(--mi-text-soft)]">
                  O indicador só pode ser definido uma vez e não pode ser a própria conta.
                </p>
              </div>
            )}
          </section>

          <section className="rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5">
            <h2 className="font-black">Regras da remuneração</h2>
            <div className="mt-4 space-y-3 text-sm text-[var(--mi-text-muted)]">
              <p>
                <strong className="text-[var(--mi-text)]">Nível 1:</strong>{" "}
                {Math.round(data.rates.direct * 100)}% sobre o valor pago pelo indicado direto.
              </p>
              <p>
                <strong className="text-[var(--mi-text)]">Níveis 2 a {data.rates.maxDepth}:</strong>{" "}
                {Math.round(data.rates.network * 100)}% por nível sobre vendas reais da rede.
              </p>
              <p>
                <strong className="text-[var(--mi-text)]">Validação:</strong> a comissão aparece
                imediatamente na Wallet e fica disponível após {data.rates.holdDays} dia(s).
              </p>
              <p>
                <strong className="text-[var(--mi-text)]">Sem pagamento por recrutamento:</strong>{" "}
                apenas faturas pagas geram remuneração.
              </p>
            </div>
          </section>
        </div>

        <section className="overflow-hidden rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)]">
          <div className="border-b border-[var(--mi-border)] p-4">
            <h2 className="font-black">Histórico de comissões</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-[var(--mi-bg)] text-[10px] font-black uppercase tracking-[0.1em] text-[var(--mi-text-soft)]">
                <tr>
                  <th className="px-4 py-3">Origem</th>
                  <th className="px-4 py-3">Nível</th>
                  <th className="px-4 py-3">Venda</th>
                  <th className="px-4 py-3">Percentual</th>
                  <th className="px-4 py-3">Comissão</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.commissions.map((item) => (
                  <tr key={item.id} className="border-t border-[var(--mi-border)]">
                    <td className="px-4 py-3">
                      <p className="font-bold">{item.sourceName}</p>
                      <p className="text-[10px] text-[var(--mi-text-soft)]">
                        {new Date(item.createdAt).toLocaleString("pt-BR")}
                      </p>
                    </td>
                    <td className="px-4 py-3">Nível {item.level}</td>
                    <td className="px-4 py-3">{money(item.grossAmount)}</td>
                    <td className="px-4 py-3">{(item.rate * 100).toFixed(0)}%</td>
                    <td className="px-4 py-3 font-black">{money(item.commissionAmount)}</td>
                    <td className="px-4 py-3">
                      <Status status={item.status} />
                    </td>
                  </tr>
                ))}
                {!data.commissions.length && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-12 text-center text-sm text-[var(--mi-text-muted)]"
                    >
                      Nenhuma comissão registrada ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function Status({ status }: { status: string }) {
  const label =
    status === "available"
      ? "Disponível"
      : status === "paid"
        ? "Pago"
        : status === "reversed"
          ? "Estornado"
          : "Em validação";
  const tone =
    status === "available"
      ? "bg-emerald-500/10 text-emerald-700"
      : status === "paid"
        ? "bg-blue-500/10 text-blue-700"
        : status === "reversed"
          ? "bg-rose-500/10 text-rose-700"
          : "bg-amber-500/10 text-amber-700";
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${tone}`}>{label}</span>;
}
