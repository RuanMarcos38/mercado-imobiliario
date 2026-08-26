from pathlib import Path

functions = Path('src/lib/prospect-leads.functions.ts')
text = functions.read_text()

old = '''function searchPhrase(data: z.infer<typeof searchSchema>, network: SocialNetwork) {
  const intent =
    data.intent === "comprar"
      ? "quer comprar imóvel"
      : data.intent === "alugar"
        ? "quer alugar imóvel"
        : data.intent === "investir"
          ? "quer investir em imóveis"
          : "demonstra interesse real em comprar, alugar ou investir em imóveis";
  const location = data.location ? ` em ${data.location}` : "";
  const property = data.propertyType ? ` ${data.propertyType}` : "";
  return `site:${networkDomainHint(network)} ${data.query} ${intent}${property}${location}`.trim();
}
'''
new = '''const BRAZIL_NATIONAL_SCOPE = "Brasil — todo território nacional";
const BRAZIL_REGIONS = "Norte, Nordeste, Centro-Oeste, Sudeste e Sul";
const BRAZIL_UFS =
  "AC, AL, AP, AM, BA, CE, DF, ES, GO, MA, MT, MS, MG, PA, PB, PR, PE, PI, RJ, RN, RS, RO, RR, SC, SP, SE e TO";

export function isBrazilNationalScope(location?: string | null) {
  const normalized = String(location ?? "")
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!normalized) return true;
  return [
    "brasil",
    "brasil inteiro",
    "todo brasil",
    "todo o brasil",
    "territorio nacional",
    "todo territorio nacional",
    "brasil - todo territorio nacional",
    "brasil — todo territorio nacional",
  ].includes(normalized);
}

export function buildProspectSearchPhrase(
  data: z.infer<typeof searchSchema>,
  network: SocialNetwork,
) {
  const intent =
    data.intent === "comprar"
      ? "quer comprar imóvel"
      : data.intent === "alugar"
        ? "quer alugar imóvel"
        : data.intent === "investir"
          ? "quer investir em imóveis"
          : "demonstra interesse real em comprar, alugar ou investir em imóveis";
  const national = isBrazilNationalScope(data.location);
  const location = national
    ? " no Brasil"
    : data.location
      ? ` em ${data.location}`
      : " no Brasil";
  const property = data.propertyType ? ` ${data.propertyType}` : "";
  return `site:${networkDomainHint(network)} ${data.query} ${intent}${property}${location}`.trim();
}
'''
if text.count(old) != 1:
    raise SystemExit('searchPhrase marker not found exactly once')
text = text.replace(old, new, 1)
text = text.replace('  const query = searchPhrase(data, network);', '  const query = buildProspectSearchPhrase(data, network);', 1)
marker = '    `Pesquise exclusivamente sinais públicos na rede social ${network}.`,\n'
addition = '''    `Pesquise exclusivamente sinais públicos na rede social ${network}.`,
    isBrazilNationalScope(data.location)
      ? `A abrangência é NACIONAL: pesquise em todo o Brasil, cobrindo as cinco regiões (${BRAZIL_REGIONS}) e os 26 estados + Distrito Federal (${BRAZIL_UFS}). Não concentre os resultados apenas em grandes capitais ou em SP/RJ; quando houver sinais confiáveis, diversifique geograficamente.`
      : `A busca está filtrada para ${data.location}. Mantenha os resultados compatíveis com essa localização.`,
'''
if text.count(marker) != 1:
    raise SystemExit('instruction marker not found exactly once')
text = text.replace(marker, addition, 1)
text = text.replace(
    '    const assistantMessage = leads.length\n      ? `Encontrei ${leads.length} sinais públicos compatíveis com a busca, sendo ${hot} classificados como quentes. ${operationalNetworks} de ${results.length} redes selecionadas responderam à varredura pública. Revise a evidência e a fonte antes de qualquer abordagem.`\n      : `Não encontrei sinais públicos suficientemente confiáveis nesta tentativa. ${operationalNetworks} de ${results.length} redes selecionadas responderam; tente ampliar a localização, o tipo de imóvel ou os termos de intenção.`;',
    '''    const national = isBrazilNationalScope(data.location);
    const coverage = national ? "em todo o território nacional" : `em ${data.location}`;
    const assistantMessage = leads.length
      ? `Encontrei ${leads.length} sinais públicos compatíveis com a busca ${coverage}, sendo ${hot} classificados como quentes. ${operationalNetworks} de ${results.length} redes selecionadas responderam à varredura pública. Revise a evidência e a fonte antes de qualquer abordagem.`
      : `Não encontrei sinais públicos suficientemente confiáveis nesta tentativa ${coverage}. ${operationalNetworks} de ${results.length} redes selecionadas responderam; tente ampliar o tipo de imóvel ou os termos de intenção.`;''',
    1,
)
functions.write_text(text)

route = Path('src/routes/_authenticated/prospectos.tsx')
text = route.read_text()
replacements = [
    ('  const [location, setLocation] = useState("Joinville, SC");', '  const [location, setLocation] = useState("Brasil — todo território nacional");'),
    ('              Localize sinais públicos de intenção de compra, aluguel ou investimento em imóveis. O\n              sistema prioriza pedidos explícitos, perguntas de preço, financiamento, entrada,\n              localização e visita, sempre mantendo a fonte para conferência.', '              Localize sinais públicos de intenção de compra, aluguel ou investimento em imóveis em todo o Brasil. O\n              radar nasce com cobertura nacional — Norte, Nordeste, Centro-Oeste, Sudeste e Sul — e\n              permite refinar por cidade ou região quando necessário, sempre mantendo a fonte para conferência.'),
    ('              Descreva em linguagem natural quem você quer encontrar e refine por região, intenção e\n              tipo de imóvel.', '              Descreva em linguagem natural quem você quer encontrar. Por padrão, a varredura cobre todo o\n              território nacional; use o campo de localização somente quando quiser restringir a busca.'),
    ('                <Field label="Cidade / região">', '                <Field label="Cobertura nacional / filtro de região">'),
    ('                    placeholder="Ex.: Joinville, SC"', '                    placeholder="Brasil — todo território nacional"'),
    ('                    Nenhum sinal público suficientemente confiável foi localizado nesta tentativa.\n                    Amplie os termos ou a região e pesquise novamente.', '                    Nenhum sinal público suficientemente confiável foi localizado nesta tentativa.\n                    Amplie os termos e pesquise novamente; a cobertura padrão já considera todo o Brasil.'),
]
for old, new in replacements:
    if text.count(old) != 1:
        raise SystemExit(f'route marker not found exactly once: {old[:70]}')
    text = text.replace(old, new, 1)
route.write_text(text)

tests = Path('tests/prospect-leads.test.ts')
text = tests.read_text()
text = text.replace(
    'import {\n  dedupeAndRankProspectLeads,',
    'import { buildProspectSearchPhrase, isBrazilNationalScope } from "@/lib/prospect-leads.functions";\nimport {\n  dedupeAndRankProspectLeads,',
    1,
)
insert = '''\n  it("treats the default scope as nationwide Brazil", () => {
    expect(isBrazilNationalScope(undefined)).toBe(true);
    expect(isBrazilNationalScope("Brasil — todo território nacional")).toBe(true);
    expect(isBrazilNationalScope("Joinville, SC")).toBe(false);
  });

  it("builds a nationwide social search when Brazil scope is selected", () => {
    const phrase = buildProspectSearchPhrase(
      {
        query: "procura apartamento com financiamento",
        location: "Brasil — todo território nacional",
        intent: "comprar",
        propertyType: "apartamento",
        networks: ["instagram"],
        limit: 20,
      },
      "instagram",
    );
    expect(phrase).toContain("site:instagram.com");
    expect(phrase).toContain("no Brasil");
    expect(phrase).not.toContain("Joinville");
  });
'''
needle = 'describe("prospect lead privacy and quality", () => {\n'
if text.count(needle) != 1:
    raise SystemExit('test describe marker not found exactly once')
text = text.replace(needle, needle + insert, 1)
tests.write_text(text)
