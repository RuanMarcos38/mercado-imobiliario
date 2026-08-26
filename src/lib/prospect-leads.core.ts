export const SOCIAL_NETWORKS = [
  "instagram",
  "facebook",
  "tiktok",
  "youtube",
  "x",
  "linkedin",
  "threads",
  "pinterest",
] as const;

export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
export type ProspectIntentStage = "quente" | "morno";
export type ProspectProfileType = "consumidor" | "profissional";

export type ProspectLead = {
  id: string;
  displayName: string;
  profileHandle: string | null;
  network: SocialNetwork;
  profileUrl: string;
  profileType: ProspectProfileType;
  publicPhone: string | null;
  publicEmail: string | null;
  publicWebsite: string | null;
  location: string | null;
  intentStage: ProspectIntentStage;
  intentScore: number;
  intentSignals: string[];
  evidence: string | null;
  publishedAt: string | null;
  sourceUrls: string[];
};

const NETWORK_HOSTS: Record<SocialNetwork, string[]> = {
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "fb.com"],
  tiktok: ["tiktok.com"],
  youtube: ["youtube.com", "youtu.be"],
  x: ["x.com", "twitter.com"],
  linkedin: ["linkedin.com"],
  threads: ["threads.net"],
  pinterest: ["pinterest.com", "pin.it"],
};

export function safePublicUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizedHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isNetworkUrl(value: string | null | undefined, network: SocialNetwork) {
  if (!value) return false;
  const host = normalizedHost(value);
  return NETWORK_HOSTS[network].some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function networkDomainHint(network: SocialNetwork) {
  return NETWORK_HOSTS[network][0];
}

function sanitizeEmail(value: string | null | undefined) {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!email || email.length > 180) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function sanitizePhone(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return raw.slice(0, 40);
}

function dedupeStrings(values: Array<string | null | undefined>, max = 8) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))].slice(
    0,
    max,
  );
}

function clampScore(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

export function sanitizeProspectLead(
  lead: ProspectLead & { contactIsProfessional?: boolean },
): ProspectLead | null {
  const profileUrl = safePublicUrl(lead.profileUrl);
  if (!profileUrl || !isNetworkUrl(profileUrl, lead.network)) return null;

  const sourceUrls = dedupeStrings(
    (lead.sourceUrls ?? []).map(safePublicUrl).filter(Boolean) as string[],
    8,
  );
  const contactAllowed = lead.profileType === "profissional" && lead.contactIsProfessional === true;
  const intentScore = clampScore(lead.intentScore);

  return {
    id: String(lead.id || `${lead.network}:${profileUrl}`),
    displayName: String(lead.displayName || lead.profileHandle || "Perfil público")
      .trim()
      .slice(0, 180),
    profileHandle: lead.profileHandle?.trim().slice(0, 120) || null,
    network: lead.network,
    profileUrl,
    profileType: lead.profileType === "profissional" ? "profissional" : "consumidor",
    publicPhone: contactAllowed ? sanitizePhone(lead.publicPhone) : null,
    publicEmail: contactAllowed ? sanitizeEmail(lead.publicEmail) : null,
    publicWebsite: contactAllowed ? safePublicUrl(lead.publicWebsite) : null,
    location: lead.location?.trim().slice(0, 160) || null,
    intentStage: intentScore >= 75 ? "quente" : "morno",
    intentScore,
    intentSignals: dedupeStrings(lead.intentSignals ?? [], 6),
    evidence: lead.evidence?.trim().slice(0, 700) || null,
    publishedAt: lead.publishedAt?.trim().slice(0, 80) || null,
    sourceUrls,
  };
}

function normalizedText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function leadKey(lead: ProspectLead) {
  const profile = safePublicUrl(lead.profileUrl);
  if (profile) return `profile:${profile.split("?")[0].replace(/\/$/, "")}`;
  return `name:${lead.network}:${normalizedText(lead.displayName)}:${normalizedText(lead.profileHandle)}`;
}

function mergeLead(a: ProspectLead, b: ProspectLead): ProspectLead {
  const better = b.intentScore > a.intentScore ? b : a;
  return {
    ...better,
    displayName: a.displayName.length >= b.displayName.length ? a.displayName : b.displayName,
    profileHandle: a.profileHandle || b.profileHandle,
    publicPhone: a.publicPhone || b.publicPhone,
    publicEmail: a.publicEmail || b.publicEmail,
    publicWebsite: a.publicWebsite || b.publicWebsite,
    location: a.location || b.location,
    intentStage: Math.max(a.intentScore, b.intentScore) >= 75 ? "quente" : "morno",
    intentScore: Math.max(a.intentScore, b.intentScore),
    intentSignals: dedupeStrings([...a.intentSignals, ...b.intentSignals], 6),
    evidence: better.evidence || a.evidence || b.evidence,
    publishedAt: better.publishedAt || a.publishedAt || b.publishedAt,
    sourceUrls: dedupeStrings([...a.sourceUrls, ...b.sourceUrls], 8),
  };
}

export function prospectLeadScore(lead: ProspectLead) {
  let score = lead.intentScore;
  if (lead.intentStage === "quente") score += 15;
  if (lead.evidence) score += 5;
  if (lead.publishedAt) score += 4;
  if (lead.profileUrl) score += 2;
  if (lead.publicPhone || lead.publicEmail) score += 2;
  return score;
}

export function dedupeAndRankProspectLeads(leads: ProspectLead[], limit = 20) {
  const merged = new Map<string, ProspectLead>();
  for (const raw of leads) {
    const clean = sanitizeProspectLead(raw);
    if (!clean || clean.intentScore < 45) continue;
    const key = leadKey(clean);
    const current = merged.get(key);
    merged.set(key, current ? mergeLead(current, clean) : clean);
  }
  return [...merged.values()]
    .sort((a, b) => prospectLeadScore(b) - prospectLeadScore(a))
    .slice(0, Math.max(1, Math.min(40, limit)));
}
