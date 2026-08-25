from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


path = Path("src/routes/_authenticated.tsx")
text = path.read_text(encoding="utf-8")

if 'to: "/parcerias"' in text or '["/parcerias",' in text:
    print("Partner navigation already present.")
    raise SystemExit(0)

text = replace_once(
    text,
    "  Gavel,\n  LayoutDashboard,",
    "  Gavel,\n  Handshake,\n  LayoutDashboard,",
    "Handshake icon import",
)

text = replace_once(
    text,
    '  ["/buscar", "buscar"],\n  ["/leiloes", "leiloes"],',
    '  ["/buscar", "buscar"],\n  ["/parcerias", "buscar"],\n  ["/leiloes", "leiloes"],',
    "partner route access",
)

text = replace_once(
    text,
    '  { to: "/crm", label: "CRM / Oportunidades", icon: Users, feature: "crm" },\n  { to: "/afiliados", label: "Afiliados / Wallet", icon: WalletCards, feature: "afiliados" },',
    '  { to: "/crm", label: "CRM / Oportunidades", icon: Users, feature: "crm" },\n  { to: "/parcerias", label: "Parcerias imobiliárias", icon: Handshake, feature: "buscar" },\n  { to: "/afiliados", label: "Afiliados / Wallet", icon: WalletCards, feature: "afiliados" },',
    "partner tool navigation",
)

path.write_text(text, encoding="utf-8")
print("Partner navigation patch applied.")
