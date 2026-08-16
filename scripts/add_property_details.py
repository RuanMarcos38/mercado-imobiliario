from pathlib import Path

path = Path("src/routes/_authenticated/dashboard.tsx")
text = path.read_text(encoding="utf-8")

# State for the property detail drawer/modal.
if "const [selectedProperty, setSelectedProperty]" not in text:
    anchor = '  const [showFavorites, setShowFavorites] = useState(false);'
    if anchor not in text:
        raise SystemExit("favorites state anchor not found")
    text = text.replace(
        anchor,
        anchor + '\n  const [selectedProperty, setSelectedProperty] = useState<PropertySearchItem | null>(null);',
        1,
    )

# Wire details action into result cards.
card_call = '''                  onFavorite={() => void toggleFavorite(property)}\n                  onCompare={() => toggleCompare(property.id)}'''
if card_call in text and 'onDetails={() => setSelectedProperty(property)}' not in text:
    text = text.replace(
        card_call,
        card_call + '\n                  onDetails={() => setSelectedProperty(property)}',
        1,
    )

# Add details modal before comparison modal.
if "Detalhes do imóvel" not in text:
    anchor = '      {showCompare && ('
    if anchor not in text:
        raise SystemExit("comparison modal anchor not found")
    modal = '''      {selectedProperty && (\n        <div\n          className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-4 backdrop-blur-md sm:p-8"\n          onClick={() => setSelectedProperty(null)}\n        >\n          <div\n            className="mx-auto max-w-3xl rounded-[30px] border border-white/10 bg-[#0b1727] p-5 shadow-2xl sm:p-8"\n            onClick={(event) => event.stopPropagation()}\n          >\n            <div className="flex items-start justify-between gap-5">\n              <div>\n                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">\n                  Detalhes do imóvel\n                </p>\n                <h2 className="mt-2 text-2xl font-black leading-tight sm:text-3xl">\n                  {selectedProperty.title}\n                </h2>\n                <p className="mt-3 text-3xl font-black text-cyan-100">\n                  {formatPrice(selectedProperty.price)}\n                </p>\n              </div>\n              <button\n                onClick={() => setSelectedProperty(null)}\n                className="rounded-xl border border-white/10 p-2.5 text-slate-300 hover:bg-white/5"\n                title="Fechar"\n              >\n                <X className="h-5 w-5" />\n              </button>\n            </div>\n\n            <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">\n              {selectedProperty.property_type && (\n                <DetailBox label="Tipo" value={selectedProperty.property_type} />\n              )}\n              {selectedProperty.bedrooms != null && (\n                <DetailBox label="Quartos" value={String(selectedProperty.bedrooms)} />\n              )}\n              {selectedProperty.bathrooms != null && (\n                <DetailBox label="Banheiros" value={String(selectedProperty.bathrooms)} />\n              )}\n              {selectedProperty.area_sqm != null && (\n                <DetailBox label="Área" value={`${selectedProperty.area_sqm} m²`} />\n              )}\n              {selectedProperty.price != null &&\n                selectedProperty.area_sqm != null &&\n                selectedProperty.area_sqm > 0 && (\n                  <DetailBox\n                    label="Preço por m²"\n                    value={formatPrice(selectedProperty.price / selectedProperty.area_sqm)}\n                  />\n                )}\n              {selectedProperty.source_portal && (\n                <DetailBox label="Fonte" value={selectedProperty.source_portal} />\n              )}\n              {selectedProperty.updated_at && (\n                <DetailBox label="Atualização" value={formatRelative(selectedProperty.updated_at)} />\n              )}\n            </div>\n\n            {(selectedProperty.location_address ||\n              selectedProperty.location_city ||\n              selectedProperty.location_state) && (\n              <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">\n                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">\n                  Localização\n                </p>\n                <p className="mt-2 flex items-start gap-2 text-sm leading-relaxed text-slate-200">\n                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />\n                  {[\n                    selectedProperty.location_address,\n                    selectedProperty.location_city,\n                    selectedProperty.location_state,\n                  ]\n                    .filter(Boolean)\n                    .join(" — ")}\n                </p>\n              </div>\n            )}\n\n            {selectedProperty.description && (\n              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">\n                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">\n                  Informações do anúncio\n                </p>\n                <p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-300">\n                  {selectedProperty.description}\n                </p>\n              </div>\n            )}\n\n            <div className="mt-7 flex flex-col gap-3 sm:flex-row">\n              <button\n                onClick={() => void toggleFavorite(selectedProperty)}\n                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/10 px-5 text-sm font-semibold text-slate-200 hover:bg-white/5"\n              >\n                <Heart\n                  className={`h-4 w-4 ${\n                    favorites.has(getPropertyKey(selectedProperty)) ? "fill-current text-rose-300" : ""\n                  }`}\n                />\n                {favorites.has(getPropertyKey(selectedProperty))\n                  ? "Remover dos favoritos"\n                  : "Adicionar aos favoritos"}\n              </button>\n              {selectedProperty.source_url && (\n                <a\n                  href={selectedProperty.source_url}\n                  target="_blank"\n                  rel="noopener noreferrer"\n                  className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 text-sm font-black text-[#06101c] transition hover:bg-cyan-200"\n                >\n                  Ver anúncio original <ExternalLink className="h-4 w-4" />\n                </a>\n              )}\n            </div>\n          </div>\n        </div>\n      )}\n\n'''
    text = text.replace(anchor, modal + anchor, 1)

# Add onDetails prop to PropertyCard.
text = text.replace(
    '''  onFavorite,\n  onCompare,\n}: {\n  property: PropertySearchItem;\n  favorite: boolean;\n  comparing: boolean;\n  onFavorite: () => void;\n  onCompare: () => void;\n}) {''',
    '''  onFavorite,\n  onCompare,\n  onDetails,\n}: {\n  property: PropertySearchItem;\n  favorite: boolean;\n  comparing: boolean;\n  onFavorite: () => void;\n  onCompare: () => void;\n  onDetails: () => void;\n}) {''',
    1,
)

# Replace card action area with details + compare + source.
start_marker = '        <div className="mt-5 grid grid-cols-[auto_1fr] gap-2">'
start = text.find(start_marker)
if start >= 0 and 'onClick={onDetails}' not in text[start:start+2500]:
    end = text.find('        </div>\n      </CardContent>', start)
    if end < 0:
        raise SystemExit("property card action end not found")
    end += len('        </div>')
    actions = '''        <div className="mt-5 grid grid-cols-2 gap-2">\n          <button\n            onClick={onDetails}\n            className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 px-3 text-sm font-semibold text-slate-200 transition hover:bg-white/5"\n          >\n            Detalhes\n          </button>\n          <button\n            onClick={onCompare}\n            className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition ${comparing ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100" : "border-white/10 text-slate-300 hover:bg-white/5"}`}\n          >\n            {comparing ? <Check className="h-4 w-4" /> : <Scale className="h-4 w-4" />}\n            {comparing ? "Selecionado" : "Comparar"}\n          </button>\n          {property.source_url ? (\n            <a\n              href={property.source_url}\n              target="_blank"\n              rel="noopener noreferrer"\n              className="col-span-2 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-bold text-[#06101c] transition hover:bg-cyan-200"\n            >\n              Ver anúncio original <ExternalLink className="h-4 w-4" />\n            </a>\n          ) : (\n            <button\n              disabled\n              className="col-span-2 h-11 rounded-xl bg-white/5 text-sm font-semibold text-slate-500"\n            >\n              Fonte indisponível\n            </button>\n          )}\n        </div>'''
    text = text[:start] + actions + text[end:]

# Helper for the detail modal.
if "function DetailBox(" not in text:
    anchor = "function Feature({ icon, text }"
    pos = text.find(anchor)
    if pos < 0:
        raise SystemExit("Feature helper anchor not found")
    helper = '''function DetailBox({ label, value }: { label: string; value: string }) {\n  return (\n    <div className="rounded-2xl border border-white/10 bg-black/15 p-4">\n      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>\n      <p className="mt-1.5 text-sm font-semibold text-slate-100">{value}</p>\n    </div>\n  );\n}\n\n'''
    text = text[:pos] + helper + text[pos:]

required = [
    "Detalhes do imóvel",
    "onDetails={() => setSelectedProperty(property)}",
    "onClick={onDetails}",
    "function DetailBox(",
]
for token in required:
    if token not in text:
        raise SystemExit(f"missing property details feature: {token}")

path.write_text(text, encoding="utf-8")
print("property details added")
