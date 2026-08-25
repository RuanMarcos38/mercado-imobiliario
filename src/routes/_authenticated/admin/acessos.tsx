import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getFeatureAccessAdmin, updateFeatureAccessAdmin } from "@/lib/feature-access.functions";

export const Route = createFileRoute("/_authenticated/admin/acessos")({
  component: FeatureAccessAdminPage,
  head: () => ({ title: "Acessos por usuário | MercadoImobi" }),
});

function FeatureAccessAdminPage() {
  const getAccess = useServerFn(getFeatureAccessAdmin);
  const updateAccess = useServerFn(updateFeatureAccessAdmin);
  const access = useQuery({ queryKey: ["feature-access-admin"], queryFn: () => getAccess() });
  const [search, setSearch] = useState("");
  const [updating, setUpdating] = useState("");

  const users = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return access.data?.users ?? [];
    return (access.data?.users ?? []).filter((user) =>
      [user.name, user.company, user.userType].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(query),
      ),
    );
  }, [access.data?.users, search]);

  if (access.isLoading) return <div className="p-8 text-sm">Carregando permissões...</div>;
  if (access.error || !access.data) {
    return (
      <div className="m-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
        Acesso administrativo indisponível. {String((access.error as Error)?.message ?? "")}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--mi-bg)] p-4 text-[var(--mi-text)] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1700px] space-y-5">
        <header>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">
            Administração
          </p>
          <h1 className="mt-2 text-3xl font-black">Acessos por usuário</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--mi-text-muted)]">
            Libere ou bloqueie módulos sem alterar os dados existentes. O padrão permanece liberado
            para todos; somente as exceções configuradas aqui restringem o acesso.
          </p>
        </header>

        <div className="flex h-11 max-w-xl items-center gap-2 rounded-xl border border-[var(--mi-border)] bg-[var(--mi-surface)] px-3">
          <Search className="h-4 w-4 text-[var(--mi-text-soft)]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar usuário, empresa ou perfil..."
            className="border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
        </div>

        <section className="overflow-hidden rounded-[26px] border border-[var(--mi-border)] bg-[var(--mi-surface)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1250px] text-left text-sm">
              <thead className="bg-[var(--mi-bg)] text-[10px] font-black uppercase tracking-[0.08em] text-[var(--mi-text-soft)]">
                <tr>
                  <th className="sticky left-0 z-10 min-w-64 bg-[var(--mi-bg)] px-4 py-3">
                    Usuário
                  </th>
                  {access.data.features.map((feature) => (
                    <th key={feature.key} className="min-w-36 px-3 py-3 text-center">
                      {feature.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-t border-[var(--mi-border)]">
                    <td className="sticky left-0 z-10 bg-[var(--mi-surface)] px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-500/10 text-blue-600">
                          <ShieldCheck className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="font-black">{user.name}</p>
                          <p className="mt-0.5 text-[10px] text-[var(--mi-text-soft)]">
                            {user.company || "Conta individual"} · {user.userType || "usuário"}
                          </p>
                        </div>
                      </div>
                    </td>
                    {access.data.features.map((feature) => {
                      const key = `${user.id}:${feature.key}`;
                      const allowed = user.access[feature.key] !== false;
                      return (
                        <td key={feature.key} className="px-3 py-3 text-center">
                          <Switch
                            checked={allowed}
                            disabled={updating === key}
                            onCheckedChange={async (next) => {
                              setUpdating(key);
                              try {
                                await updateAccess({
                                  data: { userId: user.id, featureKey: feature.key, allowed: next },
                                });
                                await access.refetch();
                                toast.success(
                                  `${feature.label}: ${next ? "liberado" : "bloqueado"}.`,
                                );
                              } catch (error) {
                                toast.error(
                                  error instanceof Error
                                    ? error.message
                                    : "Não foi possível alterar o acesso.",
                                );
                              } finally {
                                setUpdating("");
                              }
                            }}
                            aria-label={`${feature.label} para ${user.name}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
