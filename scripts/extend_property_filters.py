from pathlib import Path

# -------------------- server search --------------------
path = Path("src/lib/property-search.functions.ts")
text = path.read_text(encoding="utf-8")

text = text.replace(
    '  city: z.string().trim().max(120).optional(),\n  state: z.string().trim().max(2).optional(),',
    '  city: z.string().trim().max(120).optional(),\n  neighborhood: z.string().trim().max(120).optional(),\n  state: z.string().trim().max(2).optional(),',
    1,
)
text = text.replace(
    '  bathrooms: z.number().int().nonnegative().optional(),\n  verifiedOnly:',
    '  bathrooms: z.number().int().nonnegative().optional(),\n  minArea: z.number().nonnegative().optional(),\n  maxArea: z.number().nonnegative().optional(),\n  sourcePortal: z.string().trim().max(120).optional(),\n  verifiedOnly:',
    1,
)
text = text.replace(
    '  sort: z.enum(["recent", "price_asc", "price_desc"]).optional().default("recent"),',
    '  sort: z.enum(["recent", "price_asc", "price_desc", "area_desc"]).optional().default("recent"),',
    1,
)

old_sort = '''  if (sort === "price_desc") {\n    return items.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));\n  }\n  return items.sort((a, b) => {'''
new_sort = '''  if (sort === "price_desc") {\n    return items.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));\n  }\n  if (sort === "area_desc") {\n    return items.sort((a, b) => (b.area_sqm ?? -1) - (a.area_sqm ?? -1));\n  }\n  return items.sort((a, b) => {'''
if old_sort in text:
    text = text.replace(old_sort, new_sort, 1)

city_match = '''  if (input.city) {\n    const city = normalizeSearchText(input.city);\n    const haystack = normalizeSearchText(\n      [item.location_city, item.location_address, item.title].filter(Boolean).join(" "),\n    );\n    if (!haystack.includes(city)) return false;\n  }\n'''
if city_match in text and "if (input.neighborhood)" not in text:
    text = text.replace(
        city_match,
        city_match
        + '''\n  if (input.neighborhood) {\n    const neighborhood = normalizeSearchText(input.neighborhood);\n    const haystack = normalizeSearchText(\n      [item.title, item.description, item.location_address].filter(Boolean).join(" "),\n    );\n    if (!haystack.includes(neighborhood)) return false;\n  }\n''',
        1,
    )

bath_match = '''  if (\n    typeof input.bathrooms === "number" &&\n    input.bathrooms > 0 &&\n    (item.bathrooms == null || item.bathrooms < input.bathrooms)\n  ) {\n    return false;\n  }\n  if (input.verifiedOnly && !item.is_verified) return false;'''
if bath_match in text:
    text = text.replace(
        bath_match,
        '''  if (\n    typeof input.bathrooms === "number" &&\n    input.bathrooms > 0 &&\n    (item.bathrooms == null || item.bathrooms < input.bathrooms)\n  ) {\n    return false;\n  }\n  if (typeof input.minArea === "number" && (item.area_sqm == null || item.area_sqm < input.minArea)) {\n    return false;\n  }\n  if (typeof input.maxArea === "number" && (item.area_sqm == null || item.area_sqm > input.maxArea)) {\n    return false;\n  }\n  if (input.sourcePortal) {\n    const source = normalizeSearchText(input.sourcePortal);\n    if (!normalizeSearchText(item.source_portal).includes(source)) return false;\n  }\n  if (input.verifiedOnly && !item.is_verified) return false;''',
        1,
    )

# Add database-level filters where real columns exist.
needle = '''    if (input.propertyType) {\n      indexQuery = indexQuery.eq("property_type", input.propertyType);\n      propertyQuery = propertyQuery.eq("property_type", input.propertyType);\n    }\n'''
if needle in text and 'input.sourcePortal' not in text[text.find('let indexQuery'):text.find('const [indexResult')]:
    text = text.replace(
        needle,
        needle
        + '''    if (input.neighborhood) {\n      const neighborhood = input.neighborhood.replace(/[(),]/g, " ").trim();\n      if (neighborhood) {\n        const expression = `title.ilike.%${neighborhood}%,description.ilike.%${neighborhood}%,location_address.ilike.%${neighborhood}%`;\n        indexQuery = indexQuery.or(expression);\n        propertyQuery = propertyQuery.or(expression);\n      }\n    }\n    if (input.sourcePortal) {\n      indexQuery = indexQuery.ilike("source_portal", `%${input.sourcePortal}%`);\n      propertyQuery = propertyQuery.ilike("source_portal", `%${input.sourcePortal}%`);\n    }\n''',
        1,
    )

needle = '''    if (typeof input.bathrooms === "number" && input.bathrooms > 0) {\n      indexQuery = indexQuery.gte("bathrooms", input.bathrooms);\n      propertyQuery = propertyQuery.gte("bathrooms", input.bathrooms);\n    }\n'''
if needle in text:
    text = text.replace(
        needle,
        needle
        + '''    if (typeof input.minArea === "number") {\n      indexQuery = indexQuery.gte("area_sqm", input.minArea);\n      propertyQuery = propertyQuery.gte("area_sqm", input.minArea);\n    }\n    if (typeof input.maxArea === "number") {\n      indexQuery = indexQuery.lte("area_sqm", input.maxArea);\n      propertyQuery = propertyQuery.lte("area_sqm", input.maxArea);\n    }\n''',
        1,
    )

sort_needle = '''    if (input.sort === "price_asc") {\n      indexQuery = indexQuery.order("price", { ascending: true });\n      propertyQuery = propertyQuery.order("price", { ascending: true });\n    } else if (input.sort === "price_desc") {\n      indexQuery = indexQuery.order("price", { ascending: false });\n      propertyQuery = propertyQuery.order("price", { ascending: false });\n    } else {'''
if sort_needle in text:
    text = text.replace(
        sort_needle,
        '''    if (input.sort === "price_asc") {\n      indexQuery = indexQuery.order("price", { ascending: true });\n      propertyQuery = propertyQuery.order("price", { ascending: true });\n    } else if (input.sort === "price_desc") {\n      indexQuery = indexQuery.order("price", { ascending: false });\n      propertyQuery = propertyQuery.order("price", { ascending: false });\n    } else if (input.sort === "area_desc") {\n      indexQuery = indexQuery.order("area_sqm", { ascending: false, nullsFirst: false });\n      propertyQuery = propertyQuery.order("area_sqm", { ascending: false, nullsFirst: false });\n    } else {''',
        1,
    )

path.write_text(text, encoding="utf-8")

# -------------------- dashboard --------------------
path = Path("src/routes/_authenticated/dashboard.tsx")
text = path.read_text(encoding="utf-8")

text = text.replace(
    '''interface FilterState {\n  city: string;\n  state: string;\n  propertyType: string;\n  minPrice: string;\n  maxPrice: string;\n  bedrooms: string;\n  bathrooms: string;\n  verifiedOnly: boolean;\n  sort: "recent" | "price_asc" | "price_desc";\n}''',
    '''interface FilterState {\n  city: string;\n  neighborhood: string;\n  state: string;\n  propertyType: string;\n  minPrice: string;\n  maxPrice: string;\n  bedrooms: string;\n  bathrooms: string;\n  minArea: string;\n  maxArea: string;\n  sourcePortal: string;\n  verifiedOnly: boolean;\n  sort: "recent" | "price_asc" | "price_desc" | "area_desc";\n}''',
    1,
)
text = text.replace(
    '''const initialFilters: FilterState = {\n  city: "",\n  state: "",\n  propertyType: "",\n  minPrice: "",\n  maxPrice: "",\n  bedrooms: "",\n  bathrooms: "",\n  verifiedOnly: false,\n  sort: "recent",\n};''',
    '''const initialFilters: FilterState = {\n  city: "",\n  neighborhood: "",\n  state: "",\n  propertyType: "",\n  minPrice: "",\n  maxPrice: "",\n  bedrooms: "",\n  bathrooms: "",\n  minArea: "",\n  maxArea: "",\n  sourcePortal: "",\n  verifiedOnly: false,\n  sort: "recent",\n};''',
    1,
)

text = text.replace(
    '''    city: source.city || undefined,\n    state: source.state || undefined,''',
    '''    city: source.city || undefined,\n    neighborhood: source.neighborhood || undefined,\n    state: source.state || undefined,''',
    1,
)
text = text.replace(
    '''    bathrooms: source.bathrooms ? Number(source.bathrooms) : undefined,\n    verifiedOnly:''',
    '''    bathrooms: source.bathrooms ? Number(source.bathrooms) : undefined,\n    minArea: source.minArea ? Number(source.minArea) : undefined,\n    maxArea: source.maxArea ? Number(source.maxArea) : undefined,\n    sourcePortal: source.sourcePortal || undefined,\n    verifiedOnly:''',
    1,
)

text = text.replace(
    '''      city: source.city ?? "",\n      state: source.state ?? "",''',
    '''      city: source.city ?? "",\n      neighborhood: source.neighborhood ?? "",\n      state: source.state ?? "",''',
    1,
)
text = text.replace(
    '''      bathrooms: typeof source.bathrooms === "number" ? String(source.bathrooms) : "",\n      verifiedOnly:''',
    '''      bathrooms: typeof source.bathrooms === "number" ? String(source.bathrooms) : "",\n      minArea: typeof source.minArea === "number" ? String(source.minArea) : "",\n      maxArea: typeof source.maxArea === "number" ? String(source.maxArea) : "",\n      sourcePortal: source.sourcePortal ?? "",\n      verifiedOnly:''',
    1,
)

# Add neighborhood to the main search row before state.
state_field = '''                <SearchField label="Estado">'''
if state_field in text and 'label="Bairro"' not in text:
    neighborhood = '''                <SearchField label="Bairro">\n                  <input\n                    value={filters.neighborhood}\n                    onChange={(event) =>\n                      setFilters((current) => ({ ...current, neighborhood: event.target.value }))\n                    }\n                    placeholder="Ex.: Centro"\n                    className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"\n                  />\n                </SearchField>\n\n'''
    text = text.replace(state_field, neighborhood + state_field, 1)
    text = text.replace(
        'className="grid gap-3 lg:grid-cols-[1.55fr_.7fr_.8fr_.8fr_auto]"',
        'className="grid gap-3 lg:grid-cols-[1.4fr_1fr_.65fr_.8fr_.8fr_auto]"',
        1,
    )

# Expand advanced filters from 6 to 9 columns and add area/source.
text = text.replace(
    'className="mt-3 grid gap-3 border-t border-white/10 pt-3 sm:grid-cols-2 lg:grid-cols-6"',
    'className="mt-3 grid gap-3 border-t border-white/10 pt-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-9"',
    1,
)

bath_block = '''                <MiniSelect\n                  label="Banheiros"\n                  value={filters.bathrooms}\n                  options={["1", "2", "3", "4"]}\n                  onChange={(value) => setFilters((current) => ({ ...current, bathrooms: value }))}\n                />\n'''
if bath_block in text and 'label="Área mínima"' not in text:
    extras = '''                <MiniField\n                  label="Área mínima"\n                  value={filters.minArea}\n                  type="number"\n                  onChange={(value) => setFilters((current) => ({ ...current, minArea: value }))}\n                />\n                <MiniField\n                  label="Área máxima"\n                  value={filters.maxArea}\n                  type="number"\n                  onChange={(value) => setFilters((current) => ({ ...current, maxArea: value }))}\n                />\n                <MiniSelect\n                  label="Fonte"\n                  value={filters.sourcePortal}\n                  options={[["Imóveis CAIXA", "Imóveis CAIXA"]]}\n                  onChange={(value) => setFilters((current) => ({ ...current, sourcePortal: value }))}\n                />\n'''
    text = text.replace(bath_block, bath_block + extras, 1)

text = text.replace(
    '''                    ["price_desc", "Maior preço"],\n                  ]}''',
    '''                    ["price_desc", "Maior preço"],\n                    ["area_desc", "Maior área"],\n                  ]}''',
    1,
)

# Put an explicit clear-filters button next to save search if it is not already present in normal state.
if '>Limpar filtros<' not in text:
    save_button_start = text.find('                <button\n                  onClick={() => void handleSaveSearch()}')
    if save_button_start >= 0:
        clear_button = '''                <button\n                  onClick={() => {\n                    setFilters(initialFilters);\n                    void runSearch(initialFilters);\n                  }}\n                  className="flex min-h-12 items-center justify-center rounded-xl border border-white/10 px-3 text-sm font-semibold text-slate-300 transition hover:bg-white/5"\n                >\n                  Limpar filtros\n                </button>\n'''
        text = text[:save_button_start] + clear_button + text[save_button_start:]

path.write_text(text, encoding="utf-8")

# Reproducible database indexes for frequently used search columns.
migration = Path("supabase/migrations/20260815211000_property_search_indexes.sql")
migration.write_text(
    '''create index if not exists idx_property_search_state_city\non public.property_search_index(location_state, location_city);\n\ncreate index if not exists idx_property_search_type\non public.property_search_index(property_type);\n\ncreate index if not exists idx_property_search_price\non public.property_search_index(price);\n\ncreate index if not exists idx_property_search_area\non public.property_search_index(area_sqm);\n\ncreate index if not exists idx_property_search_bed_bath\non public.property_search_index(bedrooms, bathrooms);\n\ncreate index if not exists idx_property_search_source\non public.property_search_index(source_portal);\n\ncreate index if not exists idx_property_search_scanned\non public.property_search_index(scanned_at desc);\n''',
    encoding="utf-8",
)

print("property filters extended")
