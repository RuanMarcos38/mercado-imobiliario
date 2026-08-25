import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface AffiliateLiveMeta {
  isAdmin: boolean;
  liveUpdatedAt: string;
  lastCommissionAt: string | null;
  lastPayoutAt: string | null;
  nextReleaseAt: string | null;
  nextDailyCloseAt: string;
  nextControlAt: string;
  refreshSeconds: number;
}

export interface AffiliateAdminUserRow {
  userId: string;
  name: string;
  companyName: string | null;
  referralCode: string;
  isActive: boolean;
  joinedAt: string;
  directReferrals: number;
  commissionTotal: number;
  commissionPending: number;
  commissionAvailable: number;
  commissionPaid: number;
  lastCommissionAt: string | null;
  lastPayoutAt: string | null;
  nextReleaseAt: string | null;
}

export interface AffiliateAdminOverview {
  liveUpdatedAt: string;
  nextDailyCloseAt: string;
  nextControlAt: string;
  metrics: {
    grossRevenue: number;
    revenue24h: number;
    revenue30d: number;
    paymentsCount: number;
    commissionTotal: number;
    commissionPending: number;
    commissionAvailable: number;
    commissionPaid: number;
    affiliateCount: number;
    activeSubscribers: number;
    lastPaymentAt: string | null;
    lastCommissionAt: string | null;
  };
  snapshot: {
    snapshotAt: string;
    grossRevenue: number;
    revenue24h: number;
    revenue30d: number;
    commissionTotal: number;
    commissionPending: number;
    commissionAvailable: number;
    commissionPaid: number;
    affiliateCount: number;
    activeSubscribers: number;
  } | null;
  users: AffiliateAdminUserRow[];
  revenueDaily: Array<{ day: string; grossRevenue: number; paymentsCount: number }>;
  recentPayments: Array<{
    id: string;
    userId: string | null;
    userName: string;
    paymentId: string;
    grossAmount: number;
    paidAt: string;
  }>;
}

type AdminContext = { supabase: any; userId: string };

function nextUtcCycle(hours: number[], minute: number) {
  const now = new Date();
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    for (const hour of [...hours].sort((a, b) => a - b)) {
      const candidate = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() + dayOffset,
          hour,
          minute,
          0,
          0,
        ),
      );
      if (candidate.getTime() > now.getTime()) return candidate.toISOString();
    }
  }
  return new Date(now.getTime() + 86_400_000).toISOString();
}

const nextDailyClose = () => nextUtcCycle([3], 5);
const nextControl = () => nextUtcCycle([3, 15], 10);

async function requirePlatformAdmin(context: AdminContext) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("FORBIDDEN_ADMIN");
}

function firstRow(value: unknown): any {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

async function loadAllAffiliateRows(db: any) {
  const rows: any[] = [];
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const result = await db.rpc("affiliate_admin_user_rollup", {
      p_offset: offset,
      p_limit: 1000,
    });
    if (result.error) throw new Error(result.error.message);
    const page = Array.isArray(result.data) ? result.data : [];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

export const getAffiliateLiveMeta = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AffiliateLiveMeta> => {
    const db = context.supabase as any;
    const [{ data: role }, lastCommission, lastPayout, nextRelease] = await Promise.all([
      db
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .eq("role", "admin")
        .maybeSingle(),
      db
        .from("affiliate_commissions")
        .select("created_at")
        .eq("beneficiary_user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("affiliate_commissions")
        .select("paid_at")
        .eq("beneficiary_user_id", context.userId)
        .eq("status", "paid")
        .not("paid_at", "is", null)
        .order("paid_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("affiliate_commissions")
        .select("available_at")
        .eq("beneficiary_user_id", context.userId)
        .eq("status", "pending")
        .gt("available_at", new Date().toISOString())
        .order("available_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    return {
      isAdmin: Boolean(role),
      liveUpdatedAt: new Date().toISOString(),
      lastCommissionAt: lastCommission.data?.created_at
        ? String(lastCommission.data.created_at)
        : null,
      lastPayoutAt: lastPayout.data?.paid_at ? String(lastPayout.data.paid_at) : null,
      nextReleaseAt: nextRelease.data?.available_at ? String(nextRelease.data.available_at) : null,
      nextDailyCloseAt: nextDailyClose(),
      nextControlAt: nextControl(),
      refreshSeconds: 60,
    };
  });

export const getAffiliateAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AffiliateAdminOverview> => {
    await requirePlatformAdmin(context as AdminContext);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const [metricsResult, userRows, revenueResult, snapshotResult, paymentResult] =
      await Promise.all([
        db.rpc("affiliate_admin_live_metrics"),
        loadAllAffiliateRows(db),
        db.rpc("affiliate_admin_revenue_daily", { p_days: 14 }),
        db
          .from("affiliate_platform_snapshots")
          .select(
            "snapshot_at,gross_revenue,revenue_24h,revenue_30d,commission_total,commission_pending,commission_available,commission_paid,affiliate_count,active_subscribers",
          )
          .order("snapshot_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        db
          .from("platform_payment_events")
          .select("id,user_id,payment_id,gross_amount,paid_at")
          .order("paid_at", { ascending: false })
          .limit(50),
      ]);

    if (metricsResult.error) throw new Error(metricsResult.error.message);
    if (revenueResult.error) throw new Error(revenueResult.error.message);
    if (snapshotResult.error) throw new Error(snapshotResult.error.message);
    if (paymentResult.error) throw new Error(paymentResult.error.message);

    const profileIds = [
      ...new Set(
        [
          ...userRows.map((row: any) => String(row.user_id || "")),
          ...(paymentResult.data ?? []).map((row: any) => String(row.user_id || "")),
        ].filter(Boolean),
      ),
    ];
    const profiles = new Map<string, { name: string; companyName: string | null }>();

    for (let offset = 0; offset < profileIds.length; offset += 500) {
      const ids = profileIds.slice(offset, offset + 500);
      if (!ids.length) continue;
      const { data, error } = await db
        .from("profiles")
        .select("id,full_name,company_name")
        .in("id", ids);
      if (error) throw new Error(error.message);
      for (const profile of data ?? []) {
        profiles.set(String(profile.id), {
          name: String(profile.full_name || "Usuário"),
          companyName: profile.company_name ? String(profile.company_name) : null,
        });
      }
    }

    const metrics = firstRow(metricsResult.data) ?? {};
    const snapshot = snapshotResult.data;

    return {
      liveUpdatedAt: new Date().toISOString(),
      nextDailyCloseAt: nextDailyClose(),
      nextControlAt: nextControl(),
      metrics: {
        grossRevenue: Number(metrics.gross_revenue ?? 0),
        revenue24h: Number(metrics.revenue_24h ?? 0),
        revenue30d: Number(metrics.revenue_30d ?? 0),
        paymentsCount: Number(metrics.payments_count ?? 0),
        commissionTotal: Number(metrics.commission_total ?? 0),
        commissionPending: Number(metrics.commission_pending ?? 0),
        commissionAvailable: Number(metrics.commission_available ?? 0),
        commissionPaid: Number(metrics.commission_paid ?? 0),
        affiliateCount: Number(metrics.affiliate_count ?? 0),
        activeSubscribers: Number(metrics.active_subscribers ?? 0),
        lastPaymentAt: metrics.last_payment_at ? String(metrics.last_payment_at) : null,
        lastCommissionAt: metrics.last_commission_at ? String(metrics.last_commission_at) : null,
      },
      snapshot: snapshot
        ? {
            snapshotAt: String(snapshot.snapshot_at),
            grossRevenue: Number(snapshot.gross_revenue ?? 0),
            revenue24h: Number(snapshot.revenue_24h ?? 0),
            revenue30d: Number(snapshot.revenue_30d ?? 0),
            commissionTotal: Number(snapshot.commission_total ?? 0),
            commissionPending: Number(snapshot.commission_pending ?? 0),
            commissionAvailable: Number(snapshot.commission_available ?? 0),
            commissionPaid: Number(snapshot.commission_paid ?? 0),
            affiliateCount: Number(snapshot.affiliate_count ?? 0),
            activeSubscribers: Number(snapshot.active_subscribers ?? 0),
          }
        : null,
      users: userRows.map((row: any) => {
        const userId = String(row.user_id);
        const profile = profiles.get(userId);
        return {
          userId,
          name: profile?.name || "Usuário",
          companyName: profile?.companyName ?? null,
          referralCode: String(row.referral_code || ""),
          isActive: Boolean(row.is_active),
          joinedAt: String(row.joined_at),
          directReferrals: Number(row.direct_referrals ?? 0),
          commissionTotal: Number(row.commission_total ?? 0),
          commissionPending: Number(row.commission_pending ?? 0),
          commissionAvailable: Number(row.commission_available ?? 0),
          commissionPaid: Number(row.commission_paid ?? 0),
          lastCommissionAt: row.last_commission_at ? String(row.last_commission_at) : null,
          lastPayoutAt: row.last_payout_at ? String(row.last_payout_at) : null,
          nextReleaseAt: row.next_release_at ? String(row.next_release_at) : null,
        };
      }),
      revenueDaily: (revenueResult.data ?? []).map((row: any) => ({
        day: String(row.day),
        grossRevenue: Number(row.gross_revenue ?? 0),
        paymentsCount: Number(row.payments_count ?? 0),
      })),
      recentPayments: (paymentResult.data ?? []).map((row: any) => {
        const userId = row.user_id ? String(row.user_id) : null;
        return {
          id: String(row.id),
          userId,
          userName: userId ? profiles.get(userId)?.name || "Usuário" : "Conta não vinculada",
          paymentId: String(row.payment_id),
          grossAmount: Number(row.gross_amount ?? 0),
          paidAt: String(row.paid_at),
        };
      }),
    };
  });
