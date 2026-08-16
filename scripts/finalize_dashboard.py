from pathlib import Path

path = Path("src/routes/_authenticated/dashboard.tsx")
text = path.read_text(encoding="utf-8")

# Add the persisted favorites query directly after the saved searches query.
if "const favoriteProperties = useQuery" not in text:
    start = text.find('  const savedSearches = useQuery({')
    if start < 0:
        raise SystemExit("savedSearches query not found")
    end = text.find("\n  });", start)
    if end < 0:
        raise SystemExit("savedSearches query terminator not found")
    end += len("\n  });")
    block = '''\n\n  const favoriteProperties = useQuery({\n    queryKey: ["property-favorites", user?.id],\n    queryFn: () => listFavoritesFn(),\n    enabled: Boolean(user),\n  });'''
    text = text[:end] + block + text[end:]

# Replace browser-only favorites hydration with database-backed hydration.
legacy_marker = 'const raw = window.localStorage.getItem("mercadoimobi:favorites");'
if legacy_marker in text:
    marker_index = text.index(legacy_marker)
    start = text.rfind("  useEffect(() => {", 0, marker_index)
    end = text.find("\n  }, []);", marker_index)
    if start < 0 or end < 0:
        raise SystemExit("legacy favorites effect boundaries not found")
    end += len("\n  }, []);")
    replacement = '''  useEffect(() => {\n    if (favoriteProperties.data) {\n      setFavorites(new Set(favoriteProperties.data.map((item) => item.key)));\n    }\n  }, [favoriteProperties.data]);'''
    text = text[:start] + replacement + text[end:]

# Replace browser-only favorite mutation with authenticated database mutation.
legacy_toggle = "  const toggleFavorite = (id: string) => {"
if legacy_toggle in text:
    start = text.index(legacy_toggle)
    end = text.find("\n  const toggleCompare", start)
    if end < 0:
        raise SystemExit("toggleFavorite boundary not found")
    replacement = '''  const toggleFavorite = async (property: PropertySearchItem) => {\n    const key = getPropertyKey(property);\n    const nextFavorite = !favorites.has(key);\n    const previous = new Set(favorites);\n    const optimistic = new Set(favorites);\n    if (nextFavorite) optimistic.add(key);\n    else optimistic.delete(key);\n    setFavorites(optimistic);\n\n    try {\n      await setFavoriteFn({ data: { property, favorite: nextFavorite } });\n      await favoriteProperties.refetch();\n      toast.success(\n        nextFavorite ? "Imóvel salvo nos favoritos." : "Imóvel removido dos favoritos.",\n      );\n    } catch {\n      setFavorites(previous);\n      toast.error("Não foi possível atualizar seus favoritos agora.");\n    }\n  };\n'''
    text = text[:start] + replacement + text[end:]

# Make the top navigation open the favorites drawer.
favorites_label = "              Favoritos ({favorites.size})"
label_index = text.find(favorites_label)
if label_index >= 0:
    button_start = text.rfind("            <button", 0, label_index)
    button_end = text.find("            </button>", label_index)
    if button_start >= 0 and button_end >= 0:
        button_end += len("            </button>")
        replacement = '''            <button\n              onClick={() => setShowFavorites(true)}\n              className="transition hover:text-white"\n            >\n              Favoritos ({favorites.size})\n            </button>'''
        text = text[:button_start] + replacement + text[button_end:]

# Add rename/delete controls to saved searches.
if '<Pencil className="h-3.5 w-3.5" /> Renomear' not in text:
    start_marker = "              {(savedSearches.data ?? []).map((saved) => ("
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit("saved search list start not found")
    empty_marker = "              {!savedSearches.isLoading"
    end = text.find(empty_marker, start)
    if end < 0:
        raise SystemExit("saved search list end not found")
    replacement = '''              {(savedSearches.data ?? []).map((saved) => (\n                <div\n                  key={saved.id}\n                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-cyan-300/30 hover:bg-cyan-300/[0.04]"\n                >\n                  <button\n                    onClick={() => applySavedSearch(saved.criteria)}\n                    className="w-full text-left"\n                  >\n                    <span className="font-semibold">{saved.name}</span>\n                    <span className="mt-1 block text-xs text-slate-400">Abrir esta pesquisa</span>\n                  </button>\n                  <div className="mt-3 flex gap-2 border-t border-white/10 pt-3">\n                    <button\n                      onClick={() => void handleRenameSavedSearch(saved.id, saved.name)}\n                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/5"\n                    >\n                      <Pencil className="h-3.5 w-3.5" /> Renomear\n                    </button>\n                    <button\n                      onClick={() => void handleDeleteSavedSearch(saved.id, saved.name)}\n                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-400/10"\n                    >\n                      <Trash2 className="h-3.5 w-3.5" /> Excluir\n                    </button>\n                  </div>\n                </div>\n              ))}\n'''
    text = text[:start] + replacement + text[end:]

# Wire result cards to the same persistent favorite key.
text = text.replace(
    "favorite={favorites.has(property.id)}",
    "favorite={favorites.has(getPropertyKey(property))}",
)
text = text.replace(
    "onFavorite={() => toggleFavorite(property.id)}",
    "onFavorite={() => void toggleFavorite(property)}",
)

required = [
    "const favoriteProperties = useQuery",
    "const toggleFavorite = async (property: PropertySearchItem)",
    "onClick={() => setShowFavorites(true)}",
    '<Pencil className="h-3.5 w-3.5" /> Renomear',
    "onFavorite={() => void toggleFavorite(property)}",
]
for token in required:
    if token not in text:
        raise SystemExit(f"missing expected dashboard feature: {token}")

if "mercadoimobi:favorites" in text:
    raise SystemExit("legacy localStorage favorites still present")

path.write_text(text, encoding="utf-8")
print("dashboard finalized")
