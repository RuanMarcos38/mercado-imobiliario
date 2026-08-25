import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const sponsorSchema = z.object({
  referralCode: z.string().trim().min(6).max(40),
});

export interface AffiliateCommissionItem {
  id: string;
  level: number;
  rate: number;
  grossAmount: number;
  commissionAmount: number;
  status: "pending" | "available" | "paid" | "reversed";
  availableAt: string;
  paidAt: string | null;
  createdAt: string;
  sourceName: string;
}

export interface AffiliateOverview {
  referralCode: string;
  sponsor: { name: string; referralCode: string } | null;
  directReferrals: number;
  networkReferrals: number;
  rates: { direct: number; network: number; maxDepth: number; holdDays: number };
  wallet: { total: number; available: number; pending: number; paid: number };
  commissions: AffiliateCommissionItem[];
}

async function ensureAffiliateProfile(db: any, userId: string) {
  const { data: profile, error } = await db
    .from("affiliate_profiles")
    .select("user_id,referral_code,sponsor_user_id,is_active")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (profile) return profile;

  const referralCode = `MI-${userId.replace(/-/g, "").slice(0, 16).toUpperCase()}`;
  const inserted = await db
    .from("affiliate_profiles")
    .insert({ user_id: userId, referral_code: referralCode })
    .select("user_id,referral_code,sponsor_user_id,is_active")
    .single();
  if (inserted.error) throw new Error(inserted.error.message);
  return inserted.data;
}

async function buildOverview(db: any, userId: string): Promise<AffiliateOverview> {
  const profile = await ensureAffiliateProfile(db, userId);
  const [
    { data: settings, error: settingsError },
    { data: commissions, error: commissionError },
    statsResult,
  ] = await Promise.all([
    db
      .from("affiliate_settings")
      .select("direct_rate,network_rate,max_depth,hold_days")
      .eq("id", 1)
      .single(),
    db
      .from("affiliate_commissions")
      .select(
        "id,source_user_id,level,rate,gross_amount,commission_amount,status,available_at,paid_at,created_at",
      )
      .eq("beneficiary_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200),
    db.rpc("affiliate_network_stats", { p_user_id: userId }),
  ]);

  if (settingsError) throw new Error(settingsError.message);
  if (commissionError) throw new Error(commissionError.message);
  if (statsResult.error) throw new Error(statsResult.error.message);

  const rows = commissions ?? [];
  const sourceIds = [
    ...new Set(rows.map((item: any) => String(item.source_user_id)).filter(Boolean)),
  ];
  const sourceNames = new Map<string, string>();
  if (sourceIds.length) {
    const { data: sources } = await db.from("profiles").select("id,full_name").in("id", sourceIds);
    for (const source of sources ?? []) {
      sourceNames.set(String(source.id), String(source.full_name || "Usuário indicado"));
    }
  }

  let sponsor: AffiliateOverview["sponsor"] = null;
  if (profile.sponsor_user_id) {
    const [{ data: sponsorProfile }, { data: sponsorAffiliate }] = await Promise.all([
      db.from("profiles").select("full_name").eq("id", profile.sponsor_user_id).maybeSingle(),
      db
        .from("affiliate_profiles")
        .select("referral_code")
        .eq("user_id", profile.sponsor_user_id)
        .maybeSingle(),
    ]);
    sponsor = {
      name: String(sponsorProfile?.full_name || "Afiliado indicador"),
      referralCode: String(sponsorAffiliate?.referral_code || ""),
    };
  }

  const now = Date.now();
  let total = 0;
  let available = 0;
  let pending = 0;
  let paid = 0;

  const items: AffiliateCommissionItem[] = rows.map((item: any) => {
    const amount = Number(item.commission_amount ?? 0);
    const rawStatus = String(item.status || "pending") as AffiliateCommissionItem["status"];
    const effectiveStatus: AffiliateCommissionItem["status"] =
      rawStatus === "pending" && new Date(item.available_at).getTime() <= now
        ? "available"
        : rawStatus;

    if (effectiveStatus !== "reversed") total += amount;
    if (effectiveStatus === "available") available += amount;
    else if (effectiveStatus === "pending") pending += amount;
    else if (effectiveStatus === "paid") paid += amount;

    return {
      id: String(item.id),
      level: Number(item.level),
      rate: Number(item.rate),
      grossAmount: Number(item.gross_amount),
      commissionAmount: amount,
      status: effectiveStatus,
      availableAt: String(item.available_at),
      paidAt: item.paid_at ? String(item.paid_at) : null,
      createdAt: String(item.created_at),
      sourceName: sourceNames.get(String(item.source_user_id)) || "Usuário indicado",
    };
  });

  const stats = Array.isArray(statsResult.data) ? statsResult.data[0] : statsResult.data;
  return {
    referralCode: String(profile.referral_code),
    sponsor,
    directReferrals: Number(stats?.direct_count ?? 0),
    networkReferrals: Number(stats?.network_count ?? 0),
    rates: {
      direct: Number(settings.direct_rate ?? 0.05),
      network: Number(settings.network_rate ?? 0.01),
      maxDepth: Number(settings.max_depth ?? 20),
      holdDays: Number(settings.hold_days ?? 7),
    },
    wallet: { total, available, pending, paid },
    commissions: items,
  };
}

export const getAffiliateOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AffiliateOverview> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return buildOverview(supabaseAdmin as any, context.userId);
  });

export const linkMyAffiliateSponsor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => sponsorSchema.parse(data))
  .handler(async ({ context, data }): Promise<AffiliateOverview> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    await ensureAffiliateProfile(db, context.userId);
    const result = await db.rpc("affiliate_set_sponsor", {
      p_user_id: context.userId,
      p_referral_code: data.referralCode,
    });
    if (result.error) {
      const message = String(result.error.message || "");
      if (message.includes("REFERRAL_CODE_NOT_FOUND"))
        throw new Error("Código de indicação não encontrado.");
      if (message.includes("SELF_REFERRAL_NOT_ALLOWED"))
        throw new Error("Você não pode indicar a própria conta.");
      if (message.includes("AFFILIATE_CYCLE_NOT_ALLOWED"))
        throw new Error("Essa indicação criaria um ciclo inválido na rede.");
      throw new Error(message || "Não foi possível vincular o indicador.");
    }
    if (result.data === false) throw new Error("Esta conta já possui um indicador vinculado.");
    return buildOverview(db, context.userId);
  });
