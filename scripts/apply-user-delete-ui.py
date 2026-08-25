from pathlib import Path

path = Path("src/routes/_authenticated/admin/usuarios.tsx")
text = path.read_text(encoding="utf-8")

replacements = [
    (
        "  ShieldCheck,\n  Users,\n} from \"lucide-react\";",
        "  ShieldCheck,\n  Trash2,\n  Users,\n} from \"lucide-react\";",
    ),
    (
        'import { getAdminRealtimeUsage, listAdminActivityLogs } from "@/lib/user-activity.functions";',
        'import { getAdminRealtimeUsage, listAdminActivityLogs } from "@/lib/user-activity.functions";\nimport { deletePlatformUser } from "@/lib/platform-user-delete.functions";',
    ),
    (
        "  const updateFn = useServerFn(updatePlatformUser);\n  const usageFn = useServerFn(getAdminRealtimeUsage);",
        "  const updateFn = useServerFn(updatePlatformUser);\n  const deleteFn = useServerFn(deletePlatformUser);\n  const usageFn = useServerFn(getAdminRealtimeUsage);",
    ),
    (
        "  const [refreshing, setRefreshing] = useState(false);\n  const [form, setForm] = useState({",
        "  const [refreshing, setRefreshing] = useState(false);\n  const [deleteTarget, setDeleteTarget] = useState<PlatformUser | null>(null);\n  const [deleting, setDeleting] = useState(false);\n  const [form, setForm] = useState({",
    ),
    (
        '  if (users.error && String(users.error).includes("FORBIDDEN_ADMIN")) {',
        '''  const removeUser = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteFn({ data: { userId: deleteTarget.id } });
      toast.success("Usuário excluído com segurança.");
      setDeleteTarget(null);
      await Promise.all([users.refetch(), usage.refetch(), activity.refetch()]);
    } catch (error) {
      const message = String((error as Error)?.message ?? "");
      if (message.includes("CANNOT_DELETE_SELF")) {
        toast.error("O administrador conectado não pode excluir a própria conta.");
      } else if (message.includes("CANNOT_DELETE_ADMIN")) {
        toast.error("Contas de administrador global não podem ser excluídas por esta tela.");
      } else if (message.includes("OWNER_HAS_MEMBERS")) {
        toast.error("Este usuário é proprietário de uma organização com outros membros. Remova ou transfira os membros antes de excluir.");
      } else if (message.includes("BILLING_CANCEL_REQUIRED")) {
        toast.error("A assinatura precisa ser cancelada no gateway antes da exclusão.");
      } else {
        toast.error(message || "Não foi possível excluir o usuário.");
      }
    } finally {
      setDeleting(false);
    }
  };

  if (users.error && String(users.error).includes("FORBIDDEN_ADMIN")) {''',
    ),
    (
        '''                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void sendPasswordReset(user)}
                          title="Enviar redefinição de senha"
                        >
                          <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Senha
                        </Button>''',
        '''                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void sendPasswordReset(user)}
                          title="Enviar redefinição de senha"
                        >
                          <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Senha
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={user.roles.includes("admin")}
                          onClick={() => setDeleteTarget(user)}
                          title={
                            user.roles.includes("admin")
                              ? "Administrador global protegido"
                              : "Excluir usuário permanentemente"
                          }
                          className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Excluir
                        </Button>''',
    ),
    (
        "      </Dialog>\n    </div>\n  );",
        '''      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(next) => {
          if (!next && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Excluir usuário</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm leading-6 text-[var(--mi-text-muted)]">
            <p>
              Você está prestes a excluir permanentemente
              <strong className="text-[var(--mi-text)]"> {deleteTarget?.fullName || deleteTarget?.email}</strong>.
            </p>
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
              Esta ação remove o login e não pode ser desfeita. Contas de administrador global são
              protegidas. Se o usuário for proprietário de uma organização com outros membros, a
              plataforma bloqueará a exclusão para evitar perda acidental de dados.
            </div>
            {deleteTarget?.memberRole === "owner" && (
              <p className="text-xs">
                Como proprietário de uma conta individual, os dados isolados pertencentes somente a
                essa organização também poderão ser removidos. Isso não afeta outros usuários ou
                outros projetos.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancelar
            </Button>
            <Button
              onClick={() => void removeUser()}
              disabled={deleting}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {deleting ? "Excluindo..." : "Excluir definitivamente"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );''',
    ),
]

for old, new in replacements:
    if old not in text:
        raise SystemExit(f"Trecho esperado não encontrado: {old[:80]!r}")
    text = text.replace(old, new, 1)

path.write_text(text, encoding="utf-8")
