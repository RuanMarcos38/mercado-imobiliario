from pathlib import Path

path = Path("src/routes/_authenticated/dashboard.tsx")
text = path.read_text(encoding="utf-8")

marker = '''          <div className="flex items-center gap-2">\n            <Link\n              to="/settings/security"'''
if marker not in text:
    raise SystemExit("header action marker not found")

if 'title="Pesquisas salvas"' not in text:
    replacement = '''          <div className="flex items-center gap-2">\n            <button\n              onClick={() => setShowSaved(true)}\n              className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-slate-300 transition hover:bg-white/5 md:hidden"\n              title="Pesquisas salvas"\n            >\n              <Bookmark className="h-4 w-4" />\n            </button>\n            <button\n              onClick={() => setShowFavorites(true)}\n              className="relative grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-slate-300 transition hover:bg-white/5 md:hidden"\n              title="Favoritos"\n            >\n              <Heart className="h-4 w-4" />\n              {favorites.size > 0 && (\n                <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-cyan-300 px-1 text-[10px] font-black text-[#06101c]">\n                  {favorites.size > 9 ? "9+" : favorites.size}\n                </span>\n              )}\n            </button>\n            <Link\n              to="/settings/security"'''
    text = text.replace(marker, replacement, 1)

if 'title="Pesquisas salvas"' not in text or 'title="Favoritos"' not in text:
    raise SystemExit("mobile navigation controls were not added")

path.write_text(text, encoding="utf-8")
print("mobile search navigation fixed")
