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
        "  if (users.error && String(users.error).includes(\"FORBIDDEN_ADMIN\")) {",
        '''  const removeUser = async () => {\n    if (!deleteTarget) return;\n    setDeleting(true);\n    try {\n      await deleteFn({ data: { userId: deleteTarget.id } });\n      toast.success(\"Usuário excluído com segurança.\");\n      setDeleteTarget(null);\n      await Promise.all([users.refetch(), usage.refetch(), activity.refetch()]);\n    } catch (error) {\n      const message = String((error as Error)?.message ?? \"\");\n      if (message.includes(\"CANNOT_DELETE_SELF\")) {\n        toast.error(\"O administrador conectado não pode excluir a própria conta.\");\n      } else if (message.includes(\"CANNOT_DELETE_ADMIN\")) {\n        toast.error(\"Contas de administrador global não podem ser excluídas por esta tela.\");\n      } else if (message.includes(\"OWNER_HAS_MEMBERS\")) {\n        toast.error(\"Este usuário é proprietário de uma organização com outros membros. Remova ou transfira os membros antes de excluir.\");\n      } else if (message.includes(\"BILLING_CANCEL_REQUIRED\")) {\n        toast.error(\"A assinatura precisa ser cancelada no gateway antes da exclusão.\");\n      } else {\n        toast.error(message || \"Não foi possível excluir o usuário.\");\n      }\n    } finally {\n      setDeleting(false);\n    }\n  };\n\n  if (users.error && String(users.error).includes(\"FORBIDDEN_ADMIN\")) {''',
    ),
    (
        '''                        <Button\n                          size="sm"\n                          variant="outline"\n                          onClick={() => void sendPasswordReset(user)}\n                          title="Enviar redefinição de senha"\n                        >\n                          <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Senha\n                        </Button>''',
        '''                        <Button\n                          size="sm"\n                          variant="outline"\n                          onClick={() => void sendPasswordReset(user)}\n                          title="Enviar redefinição de senha"\n                        >\n                          <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Senha\n                        </Button>\n                        <Button\n                          size="sm"\n                          variant="outline"\n                          disabled={user.roles.includes("admin")}\n                          onClick={() => setDeleteTarget(user)}\n                          title={\n                            user.roles.includes("admin")\n                              ? "Administrador global protegido"\n                              : "Excluir usuário permanentemente"\n                          }\n                          className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"\n                        >\n                          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Excluir\n                        </Button>''',
    ),
    (
        "      </Dialog>\n    </div>\n  );",
        '''      </Dialog>\n\n      <Dialog\n        open={Boolean(deleteTarget)}\n        onOpenChange={(next) => {\n          if (!next && !deleting) setDeleteTarget(null);\n        }}\n      >\n        <DialogContent className="max-w-lg">\n          <DialogHeader>\n            <DialogTitle>Excluir usuário</DialogTitle>\n          </DialogHeader>\n          <div className="space-y-4 text-sm leading-6 text-[var(--mi-text-muted)]">\n            <p>\n              Você está prestes a excluir permanentemente\n              <strong className="text-[var(--mi-text)]"> {deleteTarget?.fullName || deleteTarget?.email}</strong>.\n            </p>\n            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">\n              Esta ação remove o login e não pode ser desfeita. Contas de administrador global são\n              protegidas. Se o usuário for proprietário de uma organização com outros membros, a\n              plataforma bloqueará a exclusão para evitar perda acidental de dados.\n            </div>\n            {deleteTarget?.memberRole === "owner" && (\n              <p className="text-xs">\n                Como proprietário de uma conta individual, os dados isolados pertencentes somente a\n                essa organização também poderão ser removidos. Isso não afeta outros usuários ou\n                outros projetos.\n              </p>\n            )}\n          </div>\n          <div className="flex justify-end gap-2 pt-2">\n            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>\n              Cancelar\n            </Button>\n            <Button\n              onClick={() => void removeUser()}\n              disabled={deleting}\n              className="bg-rose-600 text-white hover:bg-rose-700"\n            >\n              <Trash2 className="mr-2 h-4 w-4" />\n              {deleting ? "Excluindo..." : "Excluir definitivamente"}\n            </Button>\n          </div>\n        </DialogContent>\n      </Dialog>\n    </div>\n  );''',
    ),
]

for old, new in replacements:
    if old not in text:
        raise SystemExit(f"Trecho esperado não encontrado: {old[:80]!r}")
    text = text.replace(old, new, 1)

path.write_text(text, encoding="utf-8")
