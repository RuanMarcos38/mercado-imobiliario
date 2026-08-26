from pathlib import Path

path = Path("src/routes/_authenticated.tsx")
text = path.read_text()

replacements = [
    (
        "  Sparkles,\n  TrendingUp,",
        "  Sparkles,\n  Target,\n  TrendingUp,",
    ),
    (
        '  ["/parcerias", "buscar"],\n  ["/leiloes", "leiloes"],',
        '  ["/parcerias", "buscar"],\n  ["/prospectos", "buscar"],\n  ["/leiloes", "leiloes"],',
    ),
    (
        '  { to: "/parcerias", label: "Parcerias imobiliárias", icon: Handshake, feature: "buscar" },\n  { to: "/afiliados", label: "Afiliados / Wallet", icon: WalletCards, feature: "afiliados" },',
        '  { to: "/parcerias", label: "Parcerias imobiliárias", icon: Handshake, feature: "buscar" },\n  { to: "/prospectos", label: "Prospecção IA", icon: Target, feature: "buscar" },\n  { to: "/afiliados", label: "Afiliados / Wallet", icon: WalletCards, feature: "afiliados" },',
    ),
]

for old, new in replacements:
    if text.count(old) != 1:
        raise SystemExit(f"Expected marker exactly once: {old[:80]}")
    text = text.replace(old, new, 1)

path.write_text(text)
