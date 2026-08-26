from pathlib import Path

path = Path('src/lib/prospect-leads.functions.ts')
text = path.read_text()

replacements = [
("const BRAZIL_REGIONS = \"Norte, Nordeste, Centro-Oeste, Sudeste e Sul\";\nconst BRAZIL_UFS =",
 "const BRAZIL_REGIONS = \"Norte, Nordeste, Centro-Oeste, Sudeste e Sul\";\nconst BRAZIL_SEARCH_REGIONS = [\n  \"Região Norte\",\n  \"Região Nordeste\",\n  \"Região Centro-Oeste\",\n  \"Região Sudeste\",\n  \"Região Sul\",\n] as const;\nconst BRAZIL_UFS ="),
("export function buildProspectSearchPhrase(\n  data: z.infer<typeof searchSchema>,\n  network: SocialNetwork,\n) {",
 "export function buildProspectSearchPhrase(\n  data: z.infer<typeof searchSchema>,\n  network: SocialNetwork,\n  regionalFocus?: string,\n) {"),
("  const national = isBrazilNationalScope(data.location);\n  const location = national ? \" no Brasil\" : data.location ? ` em ${data.location}` : \" no Brasil\";",
 "  const national = isBrazilNationalScope(data.location);\n  const location = national\n    ? regionalFocus\n      ? ` em ${regionalFocus}, Brasil`\n      : ` no Brasil, com cobertura nas regiões ${BRAZIL_REGIONS}`\n    : data.location\n      ? ` em ${data.location}`\n      : \" no Brasil\";"),
("async function callNetworkSearch(\n  config: NonNullable<ReturnType<typeof openAiConfig>>,\n  data: z.infer<typeof searchSchema>,\n  network: SocialNetwork,\n  maxItems: number,\n) {\n  const query = buildProspectSearchPhrase(data, network);",
 "async function callNetworkSearch(\n  config: NonNullable<ReturnType<typeof openAiConfig>>,\n  data: z.infer<typeof searchSchema>,\n  network: SocialNetwork,\n  maxItems: number,\n  regionalFocus?: string,\n) {\n  const query = buildProspectSearchPhrase(data, network, regionalFocus);"),
("    isBrazilNationalScope(data.location)\n      ? `A abrangência é NACIONAL: pesquise em todo o Brasil, cobrindo as cinco regiões (${BRAZIL_REGIONS}) e os 26 estados + Distrito Federal (${BRAZIL_UFS}). Não concentre os resultados apenas em grandes capitais ou em SP/RJ; quando houver sinais confiáveis, diversifique geograficamente.`",
 "    isBrazilNationalScope(data.location)\n      ? regionalFocus\n        ? `Este é um passe complementar da cobertura NACIONAL com foco em ${regionalFocus}. Procure também cidades do interior e não apenas capitais, sempre mantendo sinais públicos confiáveis.`\n        : `A abrangência é NACIONAL: pesquise em todo o Brasil, cobrindo as cinco regiões (${BRAZIL_REGIONS}) e os 26 estados + Distrito Federal (${BRAZIL_UFS}). Não concentre os resultados apenas em grandes capitais ou em SP/RJ; quando houver sinais confiáveis, diversifique geograficamente.`"),
("async function searchNetwork(\n  config: NonNullable<ReturnType<typeof openAiConfig>>,\n  data: z.infer<typeof searchSchema>,\n  network: SocialNetwork,\n  maxItems: number,\n): Promise<NetworkResult> {\n  try {\n    const payload = await callNetworkSearch(config, data, network, maxItems);",
 "async function searchNetwork(\n  config: NonNullable<ReturnType<typeof openAiConfig>>,\n  data: z.infer<typeof searchSchema>,\n  network: SocialNetwork,\n  maxItems: number,\n  regionalFocus?: string,\n): Promise<NetworkResult> {\n  try {\n    const payload = await callNetworkSearch(config, data, network, maxItems, regionalFocus);"),
("          id: `${network}:${index}:${profileUrl}`,\n",
 "          id: `${network}:${regionalFocus ?? 'nacional'}:${index}:${profileUrl}`,\n"),
("    const perNetwork = Math.max(2, Math.min(5, Math.ceil(data.limit / data.networks.length)));\n    const results: NetworkResult[] = [];\n    for (let index = 0; index < data.networks.length; index += 4) {\n      const batch = data.networks.slice(index, index + 4);\n      const batchResults = await Promise.all(\n        batch.map((network) => searchNetwork(config, data, network, perNetwork)),\n      );\n      results.push(...batchResults);\n    }",
 "    const national = isBrazilNationalScope(data.location);\n    const searchTasks: Array<{ network: SocialNetwork; regionalFocus?: string }> = data.networks.map(\n      (network) => ({ network }),\n    );\n    if (national) {\n      BRAZIL_SEARCH_REGIONS.forEach((regionalFocus, index) => {\n        searchTasks.push({\n          network: data.networks[index % data.networks.length]!,\n          regionalFocus,\n        });\n      });\n    }\n\n    const perNetwork = Math.max(2, Math.min(5, Math.ceil(data.limit / searchTasks.length)));\n    const results: NetworkResult[] = [];\n    for (let index = 0; index < searchTasks.length; index += 4) {\n      const batch = searchTasks.slice(index, index + 4);\n      const batchResults = await Promise.all(\n        batch.map((task) =>\n          searchNetwork(config, data, task.network, perNetwork, task.regionalFocus),\n        ),\n      );\n      results.push(...batchResults);\n    }"),
("    const hot = leads.filter((lead) => lead.intentStage === \"quente\").length;\n    const operationalNetworks = results.filter((result) => result.operational).length;\n    const national = isBrazilNationalScope(data.location);\n    const coverage = national ? \"em todo o território nacional\" : `em ${data.location}`;",
 "    const hot = leads.filter((lead) => lead.intentStage === \"quente\").length;\n    const networkSummary = data.networks.map((network) => {\n      const matching = results.filter((result) => result.network === network);\n      return {\n        network,\n        operational: matching.some((result) => result.operational),\n        found: matching.reduce((total, result) => total + result.leads.length, 0),\n      };\n    });\n    const operationalNetworks = networkSummary.filter((result) => result.operational).length;\n    const coverage = national\n      ? \"em todo o território nacional, com passes complementares nas 5 regiões do Brasil\"\n      : `em ${data.location}`;"),
("      networks: results.map((result) => ({\n        network: result.network,\n        operational: result.operational,\n        found: result.leads.length,\n      })),",
 "      networks: networkSummary,"),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected marker once, found {count}: {old[:120]!r}')
    text = text.replace(old, new, 1)

path.write_text(text)

test_path = Path('tests/prospect-leads.test.ts')
test = test_path.read_text()
old = '''    expect(phrase).toContain("site:instagram.com");\n    expect(phrase).toContain("no Brasil");\n    expect(phrase).not.toContain("Joinville");\n  });'''
new = '''    expect(phrase).toContain("site:instagram.com");\n    expect(phrase).toContain("no Brasil");\n    expect(phrase).toContain("Norte, Nordeste, Centro-Oeste, Sudeste e Sul");\n    expect(phrase).not.toContain("Joinville");\n\n    const regionalPass = buildProspectSearchPhrase(\n      {\n        query: "procura apartamento com financiamento",\n        location: "Brasil — todo território nacional",\n        intent: "comprar",\n        propertyType: "apartamento",\n        networks: ["instagram"],\n        limit: 20,\n      },\n      "instagram",\n      "Região Norte",\n    );\n    expect(regionalPass).toContain("Região Norte, Brasil");\n  });'''
if test.count(old) != 1:
    raise SystemExit('Expected nationwide test marker once')
test_path.write_text(test.replace(old, new, 1))
