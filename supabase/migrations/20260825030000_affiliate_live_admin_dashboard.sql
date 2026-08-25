alter table public.subscriptions
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;

create index if not exists subscriptions_stripe_customer_idx
  on public.subscriptions(stripe_customer_id)
  where stripe_customer_id is not null;

create index if not exists subscriptions_stripe_subscription_idx
  on public.subscriptions(stripe_subscription_id)
  where stripe_subscription_id is not null;

create table if not exists public.platform_payment_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  provider text not null default 'stripe',
  payment_id text not null,
  gross_amount numeric(14,2) not null check (gross_amount >= 0),
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (provider, payment_id)
);

create index if not exists platform_payment_events_paid_at_idx
  on public.platform_payment_events(paid_at desc);

create index if not exists platform_payment_events_user_idx
  on public.platform_payment_events(user_id, paid_at desc)
  where user_id is not null;

alter table public.platform_payment_events enable row level security;
revoke all on table public.platform_payment_events from anon, authenticated;
grant select, insert, update, delete on table public.platform_payment_events to service_role;

create table if not exists public.affiliate_platform_snapshots (
  id bigserial primary key,
  snapshot_at timestamptz not null default now(),
  gross_revenue numeric(14,2) not null default 0,
  revenue_24h numeric(14,2) not null default 0,
  revenue_30d numeric(14,2) not null default 0,
  commission_total numeric(14,2) not null default 0,
  commission_pending numeric(14,2) not null default 0,
  commission_available numeric(14,2) not null default 0,
  commission_paid numeric(14,2) not null default 0,
  affiliate_count bigint not null default 0,
  active_subscribers bigint not null default 0,
  source text not null default '12h_control'
);

create index if not exists affiliate_platform_snapshots_at_idx
  on public.affiliate_platform_snapshots(snapshot_at desc);

alter table public.affiliate_platform_snapshots enable row level security;
revoke all on table public.affiliate_platform_snapshots from anon, authenticated;
grant select, insert, update, delete on table public.affiliate_platform_snapshots to service_role;
grant usage, select on sequence public.affiliate_platform_snapshots_id_seq to service_role;

insert into public.platform_payment_events (
  user_id,
  provider,
  payment_id,
  gross_amount,
  paid_at
)
select
  history.source_user_id,
  'stripe',
  history.source_payment_id,
  history.gross_amount,
  history.created_at
from (
  select distinct on (source_payment_id)
    source_user_id,
    source_payment_id,
    gross_amount,
    created_at
  from public.affiliate_commissions
  where nullif(trim(source_payment_id), '') is not null
  order by source_payment_id, created_at asc
) history
on conflict (provider, payment_id) do nothing;

create or replace function public.affiliate_admin_live_metrics()
returns table(
  gross_revenue numeric,
  revenue_24h numeric,
  revenue_30d numeric,
  payments_count bigint,
  commission_total numeric,
  commission_pending numeric,
  commission_available numeric,
  commission_paid numeric,
  affiliate_count bigint,
  active_subscribers bigint,
  last_payment_at timestamptz,
  last_commission_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with payment_metrics as (
    select
      coalesce(sum(gross_amount), 0)::numeric as gross_revenue,
      coalesce(sum(gross_amount) filter (where paid_at >= now() - interval '24 hours'), 0)::numeric as revenue_24h,
      coalesce(sum(gross_amount) filter (where paid_at >= now() - interval '30 days'), 0)::numeric as revenue_30d,
      count(*)::bigint as payments_count,
      max(paid_at) as last_payment_at
    from public.platform_payment_events
  ),
  commission_metrics as (
    select
      coalesce(sum(commission_amount) filter (where status <> 'reversed'), 0)::numeric as commission_total,
      coalesce(sum(commission_amount) filter (
        where status = 'pending' and available_at > now()
      ), 0)::numeric as commission_pending,
      coalesce(sum(commission_amount) filter (
        where status = 'available'
           or (status = 'pending' and available_at <= now())
      ), 0)::numeric as commission_available,
      coalesce(sum(commission_amount) filter (where status = 'paid'), 0)::numeric as commission_paid,
      max(created_at) as last_commission_at
    from public.affiliate_commissions
  ),
  affiliate_metrics as (
    select count(*) filter (where is_active)::bigint as affiliate_count
    from public.affiliate_profiles
  ),
  subscriber_metrics as (
    select count(distinct user_id) filter (
      where status in ('active', 'trialing')
    )::bigint as active_subscribers
    from public.subscriptions
  )
  select
    p.gross_revenue,
    p.revenue_24h,
    p.revenue_30d,
    p.payments_count,
    c.commission_total,
    c.commission_pending,
    c.commission_available,
    c.commission_paid,
    a.affiliate_count,
    s.active_subscribers,
    p.last_payment_at,
    c.last_commission_at
  from payment_metrics p
  cross join commission_metrics c
  cross join affiliate_metrics a
  cross join subscriber_metrics s;
$$;

create or replace function public.affiliate_admin_user_rollup(
  p_offset integer default 0,
  p_limit integer default 1000
)
returns table(
  user_id uuid,
  referral_code text,
  is_active boolean,
  joined_at timestamptz,
  direct_referrals bigint,
  commission_total numeric,
  commission_pending numeric,
  commission_available numeric,
  commission_paid numeric,
  last_commission_at timestamptz,
  last_payout_at timestamptz,
  next_release_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ap.user_id,
    ap.referral_code,
    ap.is_active,
    ap.joined_at,
    coalesce(network.direct_referrals, 0)::bigint,
    coalesce(wallet.commission_total, 0)::numeric,
    coalesce(wallet.commission_pending, 0)::numeric,
    coalesce(wallet.commission_available, 0)::numeric,
    coalesce(wallet.commission_paid, 0)::numeric,
    wallet.last_commission_at,
    wallet.last_payout_at,
    wallet.next_release_at
  from public.affiliate_profiles ap
  left join lateral (
    select count(*)::bigint as direct_referrals
    from public.affiliate_profiles child
    where child.sponsor_user_id = ap.user_id
  ) network on true
  left join lateral (
    select
      coalesce(sum(c.commission_amount) filter (where c.status <> 'reversed'), 0)::numeric as commission_total,
      coalesce(sum(c.commission_amount) filter (
        where c.status = 'pending' and c.available_at > now()
      ), 0)::numeric as commission_pending,
      coalesce(sum(c.commission_amount) filter (
        where c.status = 'available'
           or (c.status = 'pending' and c.available_at <= now())
      ), 0)::numeric as commission_available,
      coalesce(sum(c.commission_amount) filter (where c.status = 'paid'), 0)::numeric as commission_paid,
      max(c.created_at) as last_commission_at,
      max(c.paid_at) filter (where c.status = 'paid') as last_payout_at,
      min(c.available_at) filter (
        where c.status = 'pending' and c.available_at > now()
      ) as next_release_at
    from public.affiliate_commissions c
    where c.beneficiary_user_id = ap.user_id
  ) wallet on true
  order by ap.joined_at desc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;

create or replace function public.affiliate_admin_revenue_daily(p_days integer default 14)
returns table(
  day date,
  gross_revenue numeric,
  payments_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with limits as (
    select least(greatest(coalesce(p_days, 14), 1), 90) as days
  ),
  days as (
    select generate_series(
      current_date - ((select days from limits) - 1),
      current_date,
      interval '1 day'
    )::date as day
  )
  select
    d.day,
    coalesce(sum(p.gross_amount), 0)::numeric as gross_revenue,
    count(p.id)::bigint as payments_count
  from days d
  left join public.platform_payment_events p
    on p.paid_at >= d.day::timestamptz
   and p.paid_at < (d.day + 1)::timestamptz
  group by d.day
  order by d.day;
$$;

create or replace function public.refresh_affiliate_platform_snapshot()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  insert into public.affiliate_platform_snapshots (
    snapshot_at,
    gross_revenue,
    revenue_24h,
    revenue_30d,
    commission_total,
    commission_pending,
    commission_available,
    commission_paid,
    affiliate_count,
    active_subscribers,
    source
  )
  select
    now(),
    metrics.gross_revenue,
    metrics.revenue_24h,
    metrics.revenue_30d,
    metrics.commission_total,
    metrics.commission_pending,
    metrics.commission_available,
    metrics.commission_paid,
    metrics.affiliate_count,
    metrics.active_subscribers,
    '12h_control'
  from public.affiliate_admin_live_metrics() metrics
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.affiliate_commission_daily_maintenance()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  update public.affiliate_commissions
  set status = 'available'
  where status = 'pending'
    and available_at <= now();

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.affiliate_admin_live_metrics() from public, anon, authenticated;
revoke all on function public.affiliate_admin_user_rollup(integer, integer) from public, anon, authenticated;
revoke all on function public.affiliate_admin_revenue_daily(integer) from public, anon, authenticated;
revoke all on function public.refresh_affiliate_platform_snapshot() from public, anon, authenticated;
revoke all on function public.affiliate_commission_daily_maintenance() from public, anon, authenticated;

grant execute on function public.affiliate_admin_live_metrics() to service_role;
grant execute on function public.affiliate_admin_user_rollup(integer, integer) to service_role;
grant execute on function public.affiliate_admin_revenue_daily(integer) to service_role;
grant execute on function public.refresh_affiliate_platform_snapshot() to service_role;
grant execute on function public.affiliate_commission_daily_maintenance() to service_role;

select public.affiliate_commission_daily_maintenance();
select public.refresh_affiliate_platform_snapshot();

do $$
begin
  if to_regnamespace('cron') is null then
    return;
  end if;

  begin
    perform cron.unschedule(jobid)
    from cron.job
    where jobname in (
      'mercadoimobi-affiliate-maintenance-24h',
      'mercadoimobi-affiliate-control-12h'
    );

    perform cron.schedule(
      'mercadoimobi-affiliate-maintenance-24h',
      '5 3 * * *',
      'select public.affiliate_commission_daily_maintenance();'
    );

    perform cron.schedule(
      'mercadoimobi-affiliate-control-12h',
      '10 3,15 * * *',
      'select public.refresh_affiliate_platform_snapshot();'
    );
  exception
    when undefined_table or undefined_function or insufficient_privilege then
      null;
  end;
end;
$$;
