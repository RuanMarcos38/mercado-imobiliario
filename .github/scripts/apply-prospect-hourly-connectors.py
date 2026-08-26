from pathlib import Path

fn = Path('src/lib/prospect-leads.functions.ts')
text = fn.read_text()

schema_marker = 'const searchSchema = z.object({\n'
if text.count(schema_marker) != 1:
    raise SystemExit('searchSchema marker not unique')

schema_end = '  limit: z.number().int().min(5).max(30).default(20),\n});\n'
if text.count(schema_end) != 1:
    raise SystemExit('searchSchema end not unique')
text = text.replace(schema_end, schema_end + '\nexport type ProspectSearchInput = z.infer<typeof searchSchema>;\n', 1)

start = text.index('export const searchHotRealEstateProspects = createServerFn({ method: "POST" })')
old_tail = text[start:]
new_tail = '''export async function runPublicProspectSearch(\n  data: ProspectSearchInput,\n): Promise<ProspectSearchResponse> {\n  const config = openAiConfig();\n  if (!config) throw new Error("PROSPECT_AI_NOT_CONFIGURED");\n\n  const national = isBrazilNationalScope(data.location);\n  const searchTasks: Array<{ network: SocialNetwork; regionalFocus?: string }> =\n    data.networks.map((network) => ({ network }));\n  if (national) {\n    BRAZIL_SEARCH_REGIONS.forEach((regionalFocus, index) => {\n      searchTasks.push({\n        network: data.networks[index % data.networks.length]!,\n        regionalFocus,\n      });\n    });\n  }\n\n  const perNetwork = Math.max(2, Math.min(5, Math.ceil(data.limit / searchTasks.length)));\n  const results: NetworkResult[] = [];\n  for (let index = 0; index < searchTasks.length; index += 4) {\n    const batch = searchTasks.slice(index, index + 4);\n    const batchResults = await Promise.all(\n      batch.map((task) =>\n        searchNetwork(config, data, task.network, perNetwork, task.regionalFocus),\n      ),\n    );\n    results.push(...batchResults);\n  }\n\n  const leads = dedupeAndRankProspectLeads(\n    results.flatMap((result) => result.leads),\n    data.limit,\n  );\n  const hot = leads.filter((lead) => lead.intentStage === "quente").length;\n  const networkSummary = data.networks.map((network) => {\n    const matching = results.filter((result) => result.network === network);\n    return {\n      network,\n      operational: matching.some((result) => result.operational),\n      found: matching.reduce((total, result) => total + result.leads.length, 0),\n    };\n  });\n  const operationalNetworks = networkSummary.filter((result) => result.operational).length;\n  const coverage = national\n    ? "em todo o território nacional, com passes complementares nas 5 regiões do Brasil"\n    : `em ${data.location}`;\n  const assistantMessage = leads.length\n    ? `Encontrei ${leads.length} sinais públicos compatíveis com a busca ${coverage}, sendo ${hot} classificados como quentes. ${operationalNetworks} de ${networkSummary.length} redes selecionadas responderam à varredura pública. Revise a evidência e a fonte antes de qualquer abordagem.`\n    : `Não encontrei sinais públicos suficientemente confiáveis nesta tentativa ${coverage}. ${operationalNetworks} de ${networkSummary.length} redes selecionadas responderam; tente ampliar o tipo de imóvel ou os termos de intenção.`;\n\n  return {\n    leads,\n    networks: networkSummary,\n    warnings: results.map((result) => result.warning).filter(Boolean) as string[],\n    searchedAt: new Date().toISOString(),\n    assistantMessage,\n  };\n}\n\nexport const getProspectRadarSnapshot = createServerFn({ method: "GET" })\n  .middleware([requireSupabaseAuth])\n  .handler(async ({ context }) => {\n    await requireTenantId(context.supabase, context.userId);\n    const { getScheduledProspectRadarSnapshot } = await import("@/lib/prospect-radar.server");\n    return getScheduledProspectRadarSnapshot();\n  });\n\nexport const searchHotRealEstateProspects = createServerFn({ method: "POST" })\n  .middleware([requireSupabaseAuth])\n  .inputValidator((input: unknown) => searchSchema.parse(input))\n  .handler(async ({ data, context }): Promise<ProspectSearchResponse> => {\n    await requireTenantId(context.supabase, context.userId);\n    return runPublicProspectSearch(data);\n  });\n'''
text = text[:start] + new_tail
fn.write_text(text)

ui = Path('src/routes/_authenticated/prospectos.tsx')
text = ui.read_text()

text = text.replace(
    '  getProspectRadarStatus,\n  searchHotRealEstateProspects,',
    '  getProspectRadarSnapshot,\n  getProspectRadarStatus,\n  searchHotRealEstateProspects,',
    1,
)
text = text.replace(
    '  const statusFn = useServerFn(getProspectRadarStatus);\n  const searchFn = useServerFn(searchHotRealEstateProspects);\n  const status = useQuery({ queryKey: ["prospect-radar-status"], queryFn: () => statusFn() });',
    '  const statusFn = useServerFn(getProspectRadarStatus);\n  const snapshotFn = useServerFn(getProspectRadarSnapshot);\n  const searchFn = useServerFn(searchHotRealEstateProspects);\n  const status = useQuery({ queryKey: ["prospect-radar-status"], queryFn: () => statusFn() });\n  const snapshot = useQuery({\n    queryKey: ["prospect-radar-hourly-snapshot"],\n    queryFn: () => snapshotFn(),\n    refetchInterval: 60_000,\n  });',
    1,
)
text = text.replace(
    '  const hotCount = useMemo(\n    () => result?.leads.filter((lead) => lead.intentStage === "quente").length ?? 0,\n    [result],\n  );',
    '  const displayResult = result ?? snapshot.data?.result ?? null;\n  const hotCount = useMemo(\n    () => displayResult?.leads.filter((lead) => lead.intentStage === "quente").length ?? 0,\n    [displayResult],\n  );',
    1,
)
text = text.replace('value={result?.leads.length ?? 0}', 'value={displayResult?.leads.length ?? 0}', 1)
text = text.replace(
    'value={result?.networks.filter((network) => network.operational).length ?? 0}',
    'value={displayResult?.networks.filter((network) => network.operational).length ?? 0}',
    1,
)
text = text.replace(
    '            {!result && (',
    '            {snapshot.data && (\n              <div className="rounded-2xl border border-blue-300/25 bg-blue-300/[0.06] p-4">\n                <div className="flex flex-wrap items-center justify-between gap-2">\n                  <p className="text-xs font-black text-blue-700 dark:text-blue-200">\n                    Varredura automática nacional a cada 1 hora\n                  </p>\n                  <p className="text-[11px] text-[var(--mi-text-soft)]">\n                    Última: {new Date(snapshot.data.searchedAt).toLocaleString("pt-BR")}\n                  </p>\n                </div>\n                <div className="mt-3 flex flex-wrap gap-2">\n                  {snapshot.data.providers.map((provider) => (\n                    <span\n                      key={provider.provider}\n                      title={provider.detail}\n                      className={`rounded-full border px-3 py-1 text-[10px] font-black ${\n                        provider.operational\n                          ? "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-700 dark:text-emerald-200"\n                          : "border-amber-400/30 bg-amber-400/[0.08] text-amber-800 dark:text-amber-100"\n                      }`}\n                    >\n                      {provider.label}: {provider.operational ? "ativo" : "limitado"}\n                    </span>\n                  ))}\n                </div>\n              </div>\n            )}\n\n            {!displayResult && (',
    1,
)
text = text.replace('            {result && (', '            {displayResult && (', 1)
text = text.replace('<NetworkStatus networks={result.networks} />', '<NetworkStatus networks={displayResult.networks} />', 1)
text = text.replace('{result.warnings.length > 0 && (', '{displayResult.warnings.length > 0 && (', 1)
text = text.replace('{result.warnings.slice(0, 8).map((warning) => (', '{displayResult.warnings.slice(0, 8).map((warning) => (', 1)
text = text.replace('{result.leads.map((lead) => (', '{displayResult.leads.map((lead) => (', 1)
text = text.replace('{!result.leads.length && (', '{!displayResult.leads.length && (', 1)
ui.write_text(text)
