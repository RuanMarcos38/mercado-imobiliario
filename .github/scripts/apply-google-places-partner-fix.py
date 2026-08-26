from pathlib import Path

path = Path("src/lib/partner-search.functions.ts")
text = path.read_text()

old_type = '''type ProviderResult = {
  candidates: PartnerCandidate[];
  warning?: string;
};'''
new_type = '''type ProviderResult = {
  candidates: PartnerCandidate[];
  warning?: string;
  operational?: boolean;
};'''
if text.count(old_type) != 1:
    raise SystemExit("ProviderResult marker not found exactly once")
text = text.replace(old_type, new_type, 1)

marker = '''function googleCandidateId(placeId: string | null, name: string, index: number) {
  return `google:${placeId || `${name}:${index}`}`;
}
'''
helpers = '''function googlePlacesQueries(
  location: string,
  entityType: PartnerEntityType,
  specialty?: string,
) {
  const subjects =
    entityType === "imobiliaria"
      ? ["imobiliárias", "agência imobiliária"]
      : ["corretor de imóveis", "consultor imobiliário"];
  const queries = [
    ...(specialty ? subjects.map((subject) => `${subject} ${specialty} em ${location}`) : []),
    ...subjects.map((subject) => `${subject} em ${location}`),
  ];
  return [...new Set(queries)].slice(0, 3);
}

function googlePlacesFailureWarning(statuses: Set<number>, networkFailure: boolean) {
  if (statuses.has(403)) {
    return "Google Places recusou a consulta (403). Verifique se Places API (New), faturamento e restrições da chave estão habilitados no Google Cloud.";
  }
  if (statuses.has(429)) {
    return "Google Places atingiu o limite de consultas (429). Verifique a cota e o faturamento no Google Cloud.";
  }
  if (statuses.has(400)) {
    return "Google Places recusou a solicitação (400). A integração está configurada, mas a API não aceitou a consulta.";
  }
  if ([...statuses].some((status) => status >= 500)) {
    return "Google Places ficou temporariamente indisponível nesta busca. A pesquisa Web continuou normalmente.";
  }
  if (networkFailure) {
    return "Não foi possível concluir a conexão com o Google Places nesta busca. A pesquisa Web continuou normalmente.";
  }
  if (statuses.size) {
    return `Google Places não concluiu a consulta (HTTP ${[...statuses].sort((a, b) => a - b).join(", ")}).`;
  }
  return "Google Places não retornou resultados nesta busca.";
}

'''
if text.count(marker) != 1:
    raise SystemExit("googleCandidateId marker not found exactly once")
text = text.replace(marker, helpers + marker, 1)

start = text.index("async function searchGooglePlaces")
end = text.index("\nfunction webSearchJsonSchema", start)
new_search = '''async function searchGooglePlaces(input: z.infer<typeof searchSchema>): Promise<ProviderResult> {
  const apiKey = await googlePlacesApiKey();
  if (!apiKey) {
    return { candidates: [], warning: "Google Places não configurado.", operational: false };
  }

  const types: PartnerEntityType[] =
    input.entityType === "todos" ? ["imobiliaria", "corretor"] : [input.entityType];
  const candidates: PartnerCandidate[] = [];
  const perQuery = Math.max(5, Math.min(15, Math.ceil(input.limit / types.length)));
  const failedStatuses = new Set<number>();
  let successfulRequests = 0;
  let networkFailure = false;

  for (const entityType of types) {
    const queries = googlePlacesQueries(input.location, entityType, input.specialty);
    for (const [queryIndex, textQuery] of queries.entries()) {
      try {
        const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask":
              "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.primaryTypeDisplayName",
          },
          body: JSON.stringify({
            textQuery,
            pageSize: perQuery,
            languageCode: "pt-BR",
            regionCode: "BR",
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) {
          failedStatuses.add(response.status);
          continue;
        }
        successfulRequests += 1;
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        const places = Array.isArray(payload["places"])
          ? (payload["places"] as Record<string, unknown>[])
          : [];

        places.forEach((place, index) => {
          const displayName =
            place["displayName"] && typeof place["displayName"] === "object"
              ? String((place["displayName"] as Record<string, unknown>)["text"] ?? "")
              : "";
          if (!displayName.trim()) return;
          const phone = String(
            place["internationalPhoneNumber"] ?? place["nationalPhoneNumber"] ?? "",
          ).trim();
          const website = safeHttpUrl(place["websiteUri"]);
          const mapsUrl = safeHttpUrl(place["googleMapsUri"]);
          const sourceUrls = [website, mapsUrl].filter(Boolean) as string[];
          const primaryType =
            place["primaryTypeDisplayName"] && typeof place["primaryTypeDisplayName"] === "object"
              ? String((place["primaryTypeDisplayName"] as Record<string, unknown>)["text"] ?? "")
              : "";
          const address = String(place["formattedAddress"] ?? "").trim() || null;

          candidates.push(
            sanitizePartnerCandidate({
              id: googleCandidateId(
                typeof place["id"] === "string" ? (place["id"] as string) : null,
                displayName,
                queryIndex * perQuery + index,
              ),
              name: displayName,
              entityType,
              creciNumber: null,
              creciUf: null,
              creciType: entityType === "imobiliaria" ? "PJ" : "PF",
              creciStatus: "nao_localizado",
              phone: phone || null,
              email: null,
              website,
              address,
              city: null,
              state: null,
              specialties: primaryType ? [primaryType] : [],
              summary: null,
              sourceUrls,
              googleMapsUrl: mapsUrl,
              sourceProviders: ["Google Places"],
            }),
          );
        });

        if (candidates.length >= input.limit) break;
      } catch {
        networkFailure = true;
      }
    }
  }

  return {
    candidates,
    operational: successfulRequests > 0,
    warning:
      candidates.length > 0
        ? undefined
        : successfulRequests > 0
          ? "Google Places foi consultado com sucesso, mas não encontrou parceiros para os termos desta busca."
          : googlePlacesFailureWarning(failedStatuses, networkFailure),
  };
}
'''
text = text[:start] + new_search + text[end:]

old_provider = '''        googlePlaces: Boolean(googleKey),'''
new_provider = '''        googlePlaces: Boolean(googleKey) && google.operational === true,'''
if text.count(old_provider) != 1:
    raise SystemExit("provider status marker not found exactly once")
text = text.replace(old_provider, new_provider, 1)

path.write_text(text)
