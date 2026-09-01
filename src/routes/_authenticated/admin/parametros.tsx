import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, CircleAlert, RefreshCw, Settings2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPlatformParameterOverview } from "@/lib/platform-parameters.functions";

export const Route = createFileRoute("/_authenticated/admin/parametros")({
  component: PlatformParametersPage,
  head: () => ({ title: "Parâmetros | Administração MercadoImobi" }),
});

function PlatformParametersPage() {
  const overviewFn = useServerFn(getPlatformParameterOverview);
  const overview = useQuery({
    queryKey: ["platform-parameter-overview"],
    queryFn: () => overviewFn(),
  });

  const groups = new Map<string, NonNullable<typeof overview.data>["parameters"]>();
  for (const parameter of overview.data?.parameters ?? []) {
    const current = groups.get(parameter.category) ?? [];
    current.push(parameter);
    groups.set(parameter.category, current);
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1500px]">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">
              Administração técnica
            </p>
            <h1 className="mt-2 text-3xl font-black">Parâmetros operacionais</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--mi-text-muted)]">
              Valores críticos foram centralizados para evitar números espalhados pelo código. A
              tela não exibe segredos: mostra somente parâmetros seguros e se cada integração está
              configurada.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void overview.refetch()}
            className="rounded-xl border-[var(--mi-border)]"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${overview.isFetching ? "animate-spin" : ""}`} />{" "}
            Atualizar
          </Button>
        </div>

        {overview.error ? (
          <div className="mt-6 rounded-2xl border border-rose-500/20 bg-rose-500/[0.05] p-5 text-sm text-rose-700">
            Não foi possível carregar os parâmetros. Esta área é exclusiva do administrador da
            plataforma.
          </div>
        ) : (
          <>
            <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <SummaryCard
                title="URL pública"
                value={overview.data?.baseUrl || "Carregando..."}
                detail="Base utilizada em webhooks, OAuth, cobrança e callbacks."
              />
              <SummaryCard
                title="Parâmetros centralizados"
                value={String(overview.data?.parameters.length ?? "—")}
                detail="Controles operacionais com fallback seguro."
              />
              <SummaryCard
                title="Integrações configuradas"
                value={
                  overview.data
                    ? `${overview.data.integrations.filter((item) => item.configured).length}/${overview.data.integrations.length}`
                    : "—"
                }
                detail="Somente presença de configuração; nenhum segredo é exibido."
              />
            </section>

            <section className="mt-6 rounded-[24px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 shadow-sm sm:p-6">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-blue-600" />
                <h2 className="font-black">Saúde de configuração</h2>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(overview.data?.integrations ?? []).map((integration) => (
                  <div
                    key={integration.key}
                    className="flex items-center gap-3 rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-bg)] p-4"
                  >
                    <span
                      className={`grid h-9 w-9 place-items-center rounded-full ${integration.configured ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"}`}
                    >
                      {integration.configured ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <CircleAlert className="h-4 w-4" />
                      )}
                    </span>
                    <div>
                      <p className="text-sm font-black">{integration.label}</p>
                      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--mi-text-soft)]">
                        {integration.configured ? "Configurado" : "Aguardando configuração"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {[...groups.entries()].map(([category, parameters]) => (
              <section
                key={category}
                className="mt-6 rounded-[24px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 shadow-sm sm:p-6"
              >
                <div className="flex items-center gap-2">
                  <Settings2 className="h-5 w-5 text-blue-600" />
                  <h2 className="font-black">{category}</h2>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-[var(--mi-border)] text-[10px] font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
                        <th className="px-3 py-3">Parâmetro</th>
                        <th className="px-3 py-3">Valor efetivo</th>
                        <th className="px-3 py-3">Origem</th>
                        <th className="px-3 py-3">Descrição</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parameters.map((parameter) => (
                        <tr
                          key={parameter.key}
                          className="border-b border-[var(--mi-border)] last:border-0"
                        >
                          <td className="px-3 py-3">
                            <p className="font-black">{parameter.label}</p>
                            <code className="mt-1 block text-[10px] text-[var(--mi-text-soft)]">
                              {parameter.key}
                            </code>
                          </td>
                          <td className="px-3 py-3 font-black text-blue-600">
                            {parameter.secret
                              ? parameter.value
                                ? "Configurado"
                                : "Não configurado"
                              : String(parameter.value)}
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${parameter.isDefault ? "bg-[var(--mi-bg)] text-[var(--mi-text-soft)]" : "bg-blue-500/10 text-blue-700"}`}
                            >
                              {parameter.isDefault ? "Padrão seguro" : "Personalizado"}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-xs leading-5 text-[var(--mi-text-muted)]">
                            {parameter.description}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}

            <p className="mt-6 text-xs leading-5 text-[var(--mi-text-soft)]">
              Alterações de parâmetros são feitas por variáveis de ambiente no EasyPanel e exigem
              redeploy. Isso evita que configurações críticas sejam modificadas acidentalmente por
              usuários comuns.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="rounded-[22px] border border-[var(--mi-border)] bg-[var(--mi-surface)] p-5 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-[0.13em] text-[var(--mi-text-soft)]">
        {title}
      </p>
      <p className="mt-3 break-all text-xl font-black">{value}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--mi-text-muted)]">{detail}</p>
    </div>
  );
}
