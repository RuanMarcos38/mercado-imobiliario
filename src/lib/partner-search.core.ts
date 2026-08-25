export type PartnerEntityType = "corretor" | "imobiliaria";
export type PartnerCreciStatus = "verificado" | "informado" | "nao_localizado";

export type PartnerCandidate = {
  id: string;
  name: string;
  entityType: PartnerEntityType;
  creciNumber: string | null;
  creciUf: string | null;
  creciType: "PF" | "PJ" | null;
  creciStatus: PartnerCreciStatus;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  specialties: string[];
  summary: string | null;
  sourceUrls: string[];
  googleMapsUrl: string | null;
  sourceProviders: string[];
};

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function phoneDigits(value: string | null | undefined) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits.length >= 12 ? digits : "";
}

function websiteHost(value: string | null | undefined) {
  if (!value) return "";
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isOfficialCreciSource(value: string | null | undefined) {
  if (!value) return false;
  try {
    const host = new URL(value).hostname.replace(/^www\./, "").toLowerCase();
    if (host === "cofeci.gov.br" || host.endsWith(".cofeci.gov.br")) return true;
    return host.includes("creci") && (host.endsWith(".gov.br") || host.endsWith(".org.br"));
  } catch {
    return false;
  }
}

export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function sanitizePartnerCandidate(candidate: PartnerCandidate): PartnerCandidate {
  const sourceUrls = [...new Set(candidate.sourceUrls.map(safeHttpUrl).filter(Boolean) as string[])].slice(
    0,
    8,
  );
  const hasOfficialCreci = sourceUrls.some(isOfficialCreciSource);
  const creciStatus: PartnerCreciStatus = candidate.creciNumber
    ? hasOfficialCreci
      ? "verificado"
      : candidate.creciStatus === "nao_localizado"
        ? "informado"
        : candidate.creciStatus
    : "nao_localizado";

  return {
    ...candidate,
    name: candidate.name.trim(),
    phone: candidate.phone?.trim() || null,
    email: candidate.email?.trim().toLowerCase() || null,
    website: safeHttpUrl(candidate.website),
    googleMapsUrl: safeHttpUrl(candidate.googleMapsUrl),
    creciNumber: candidate.creciNumber?.trim() || null,
    creciUf: candidate.creciUf?.trim().toUpperCase() || null,
    creciStatus,
    sourceUrls,
    specialties: [...new Set(candidate.specialties.map((item) => item.trim()).filter(Boolean))].slice(0, 8),
    sourceProviders: [...new Set(candidate.sourceProviders.map((item) => item.trim()).filter(Boolean))],
  };
}

function mergeTwoPartners(a: PartnerCandidate, b: PartnerCandidate): PartnerCandidate {
  const betterCreci =
    a.creciStatus === "verificado" ? a : b.creciStatus === "verificado" ? b : a.creciNumber ? a : b;
  return sanitizePartnerCandidate({
    ...a,
    name: a.name.length >= b.name.length ? a.name : b.name,
    entityType: a.entityType === "imobiliaria" || b.entityType === "imobiliaria" ? "imobiliaria" : "corretor",
    creciNumber: betterCreci.creciNumber || a.creciNumber || b.creciNumber,
    creciUf: betterCreci.creciUf || a.creciUf || b.creciUf,
    creciType: betterCreci.creciType || a.creciType || b.creciType,
    creciStatus: betterCreci.creciStatus,
    phone: a.phone || b.phone,
    email: a.email || b.email,
    website: a.website || b.website,
    address: a.address || b.address,
    city: a.city || b.city,
    state: a.state || b.state,
    specialties: [...a.specialties, ...b.specialties],
    summary: a.summary || b.summary,
    sourceUrls: [...a.sourceUrls, ...b.sourceUrls],
    googleMapsUrl: a.googleMapsUrl || b.googleMapsUrl,
    sourceProviders: [...a.sourceProviders, ...b.sourceProviders],
  });
}

function partnerKey(candidate: PartnerCandidate) {
  const phone = phoneDigits(candidate.phone);
  if (phone) return `phone:${phone}`;
  const host = websiteHost(candidate.website);
  if (host) return `web:${host}`;
  const name = normalizeText(candidate.name);
  const city = normalizeText(candidate.city || candidate.address);
  return `name:${name}:${city}`;
}

export function partnerCompletenessScore(candidate: PartnerCandidate) {
  let score = 0;
  if (candidate.creciStatus === "verificado") score += 6;
  else if (candidate.creciNumber) score += 2;
  if (candidate.phone) score += 3;
  if (candidate.email) score += 3;
  if (candidate.website) score += 2;
  if (candidate.address) score += 1;
  if (candidate.googleMapsUrl) score += 1;
  if (candidate.sourceUrls.length >= 2) score += 2;
  return score;
}

export function dedupeAndRankPartners(candidates: PartnerCandidate[], limit = 24) {
  const merged = new Map<string, PartnerCandidate>();
  for (const raw of candidates) {
    if (!raw.name?.trim()) continue;
    const candidate = sanitizePartnerCandidate(raw);
    const key = partnerKey(candidate);
    const current = merged.get(key);
    merged.set(key, current ? mergeTwoPartners(current, candidate) : candidate);
  }

  return [...merged.values()]
    .sort((a, b) => partnerCompletenessScore(b) - partnerCompletenessScore(a) || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, Math.min(40, limit)));
}
