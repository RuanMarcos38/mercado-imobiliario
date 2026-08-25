import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { GitBranch, Plus, Save, Star, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createAttendanceDistributionList,
  deleteAttendanceDistributionList,
  getAttendanceDistributionWorkspace,
  setAttendanceDistributionMember,
  setDefaultAttendanceDistributionList,
  updateAttendanceDistributionList,
  type AttendanceDistributionList,
  type DistributionAlgorithm,
} from "@/lib/attendance-distribution.functions";

const ALGORITHM_LABELS: Record<DistributionAlgorithm, string> = {
  alphabetical: "Ordem alfabética",
  balanced: "Balanceamento por carga",
  round_robin: "Distribuição circular",
};

export function AttendanceDistributionPanel() {
  const workspaceFn = useServerFn(getAttendanceDistributionWorkspace);
  const createFn = useServerFn(createAttendanceDistributionList);
  const updateFn = useServerFn(updateAttendanceDistributionList);
  const memberFn = useServerFn(setAttendanceDistributionMember);
  const defaultFn = useServerFn(setDefaultAttendanceDistributionList);
  const deleteFn = useServerFn(deleteAttendanceDistributionList);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [algorithm, setAlgorithm] = useState<DistributionAlgorithm>("balanced");
  const [autoQueue, setAutoQueue] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const workspace = useQuery({
    queryKey: ["attendance-distribution-workspace"],
    queryFn: () => workspaceFn(),
    enabled: open,
  });

  const selected = useMemo(
    () => workspace.data?.lists.find((item) => item.id === selectedId) ?? null,
    [selectedId, workspace.data?.lists],
  );

  useEffect(() => {
    if (!workspace.data?.lists.length) return;
    if (selectedId && workspace.data.lists.some((item) => item.id === selectedId)) return;
    setSelectedId(
      (workspace.data.lists.find((item) => item.is_default) ?? workspace.data.lists[0]).id,
    );
  }, [selectedId, workspace.data?.lists]);

  useEffect(() => {
    if (!selected) return;
    setName(selected.name);
    setAlgorithm(selected.algorithm);
    setAutoQueue(selected.auto_queue);
    setIsActive(selected.is_active);
  }, [selected]);

  const refresh = async () => {
    await workspace.refetch();
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await updateFn({
        data: { listId: selected.id, name, algorithm, autoQueue, isActive },
      });
      await refresh();
      toast.success("Lista de distribuição atualizada.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível salvar a distribuição.",
      );
    } finally {
      setSaving(false);
    }
  };

  const createList = async () => {
    const newName = window.prompt("Nome da nova lista de distribuição:", "Nova distribuição");
    if (!newName?.trim()) return;
    try {
      const result = await createFn({
        data: { name: newName.trim(), algorithm: "balanced", autoQueue: true },
      });
      await refresh();
      setSelectedId(result.id);
      toast.success("Lista criada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar a lista.");
    }
  };

  const toggleMember = async (userId: string, enabled: boolean) => {
    if (!selected) return;
    try {
      await memberFn({ data: { listId: selected.id, userId, enabled } });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível alterar o usuário.");
    }
  };

  const makeDefault = async () => {
    if (!selected) return;
    try {
      await defaultFn({ data: { listId: selected.id } });
      await refresh();
      toast.success("Lista definida como padrão.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível definir a lista padrão.",
      );
    }
  };

  const removeList = async () => {
    if (!selected || selected.is_default) return;
    if (!window.confirm(`Excluir a lista “${selected.name}”?`)) return;
    try {
      await deleteFn({ data: { listId: selected.id } });
      setSelectedId("");
      await refresh();
      toast.success("Lista removida.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível excluir a lista.");
    }
  };

  const memberMap = new Map(
    (workspace.data?.members ?? [])
      .filter((member) => member.list_id === selectedId)
      .map((member) => [member.user_id, member]),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="h-10 w-full rounded-xl border-[var(--mi-border)] font-black"
        >
          <GitBranch className="mr-2 h-4 w-4" /> Distribuição automática
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Lista de distribuição do atendimento</DialogTitle>
        </DialogHeader>

        {workspace.isLoading ? (
          <div className="py-10 text-center text-sm text-[var(--mi-text-muted)]">
            Carregando distribuição...
          </div>
        ) : workspace.error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Não foi possível carregar a distribuição.{" "}
            {String((workspace.error as Error)?.message ?? "")}
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
            <aside className="rounded-2xl border border-[var(--mi-border)] bg-[var(--mi-surface-soft)] p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--mi-text-soft)]">
                  Listas
                </p>
                {workspace.data?.canManage && (
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    onClick={() => void createList()}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {(workspace.data?.lists ?? []).map((list) => (
                  <button
                    key={list.id}
                    type="button"
                    onClick={() => setSelectedId(list.id)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                      selectedId === list.id
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-[var(--mi-border)] bg-[var(--mi-surface)] hover:border-blue-300"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-black">{list.name}</span>
                      {list.is_default && (
                        <Star className="h-4 w-4 fill-amber-400 text-amber-500" />
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--mi-text-soft)]">
                      {ALGORITHM_LABELS[list.algorithm]}
                    </p>
                  </button>
                ))}
              </div>
            </aside>

            {selected ? (
              <section className="space-y-5">
                <div className="rounded-2xl border border-[var(--mi-border)] p-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Nome da lista</Label>
                      <Input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        disabled={!workspace.data?.canManage}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Algoritmo de distribuição</Label>
                      <select
                        value={algorithm}
                        onChange={(event) =>
                          setAlgorithm(event.target.value as DistributionAlgorithm)
                        }
                        disabled={!workspace.data?.canManage}
                        className="h-10 w-full rounded-md border border-[var(--mi-border)] bg-[var(--mi-surface)] px-3 text-sm"
                      >
                        <option value="alphabetical">Ordem alfabética</option>
                        <option value="balanced">Balanceamento por carga</option>
                        <option value="round_robin">Distribuição circular</option>
                      </select>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="flex items-center gap-3 rounded-xl border border-[var(--mi-border)] p-3 text-sm font-bold">
                      <input
                        type="checkbox"
                        checked={autoQueue}
                        onChange={(event) => setAutoQueue(event.target.checked)}
                        disabled={!workspace.data?.canManage}
                      />
                      Enviar novos contatos automaticamente para a fila
                    </label>
                    <label className="flex items-center gap-3 rounded-xl border border-[var(--mi-border)] p-3 text-sm font-bold">
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={(event) => setIsActive(event.target.checked)}
                        disabled={!workspace.data?.canManage}
                      />
                      Lista ativa
                    </label>
                  </div>
                  {workspace.data?.canManage && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button onClick={() => void save()} disabled={saving}>
                        <Save className="mr-2 h-4 w-4" /> {saving ? "Salvando..." : "Salvar"}
                      </Button>
                      {!selected.is_default && (
                        <Button variant="outline" onClick={() => void makeDefault()}>
                          <Star className="mr-2 h-4 w-4" /> Tornar padrão
                        </Button>
                      )}
                      {!selected.is_default && (
                        <Button variant="destructive" onClick={() => void removeList()}>
                          <Trash2 className="mr-2 h-4 w-4" /> Excluir
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-[var(--mi-border)] p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <UsersRound className="h-4 w-4 text-blue-600" />
                    <div>
                      <h3 className="font-black">Usuários da distribuição</h3>
                      <p className="text-xs text-[var(--mi-text-soft)]">
                        Ative quem poderá receber novos contatos automaticamente.
                      </p>
                    </div>
                  </div>
                  <div className="divide-y divide-[var(--mi-border)] rounded-xl border border-[var(--mi-border)]">
                    {(workspace.data?.users ?? []).map((user) => {
                      const member = memberMap.get(user.userId);
                      const enabled = member?.is_active ?? false;
                      return (
                        <div
                          key={user.userId}
                          className="flex items-center justify-between gap-4 px-4 py-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black">{user.name}</p>
                            <p className="text-xs text-[var(--mi-text-soft)]">
                              {user.role} · {member?.assigned_count ?? 0} distribuição(ões)
                            </p>
                          </div>
                          <label className="flex items-center gap-2 text-xs font-bold">
                            <input
                              type="checkbox"
                              checked={enabled}
                              disabled={!workspace.data?.canManage || !user.active}
                              onChange={(event) =>
                                void toggleMember(user.userId, event.target.checked)
                              }
                            />
                            {enabled ? "Ativo" : "Inativo"}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            ) : (
              <div className="rounded-2xl border border-dashed border-[var(--mi-border)] p-10 text-center text-sm text-[var(--mi-text-soft)]">
                Nenhuma lista de distribuição cadastrada.
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
