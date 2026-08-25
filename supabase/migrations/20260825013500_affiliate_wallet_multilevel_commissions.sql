create table if not exists public.affiliate_settings (
  id smallint primary key default 1 check (id = 1),
  direct_rate numeric(6,5) not null default 0.05000 check (direct_rate >= 0 and direct_rate <= 1),
  network_rate numeric(6,5) not null default 0.01000 check (network_rate >= 0 and network_rate <= 1),
  max_depth integer not null default 20 check (max_depth between 1 and 50),
  hold_days integer not null default 7 check (hold_days between 0 and 90),
  updated_at timestamptz not null default now()
);

insert into public.affiliate_settings (id, direct_rate, network_rate, max_depth, hold_days)
values (1, 0.05, 0.01, 20, 7)
on conflict (id) do nothing;

create table if not exists public.affiliate_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  referral_code text not null unique,
  sponsor_user_id uuid null references auth.users(id) on delete set null,
  is_active boolean not null default true,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_profiles_no_self_sponsor check (sponsor_user_id is null or sponsor_user_id <> user_id)
);

create index if not exists affiliate_profiles_sponsor_idx on public.affiliate_profiles(sponsor_user_id);

create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  beneficiary_user_id uuid not null references auth.users(id) on delete cascade,
  source_user_id uuid not null references auth.users(id) on delete cascade,
  source_payment_id text not null,
  level integer not null check (level between 1 and 50),
  rate numeric(6,5) not null check (rate >= 0 and rate <= 1),
  gross_amount numeric(14,2) not null check (gross_amount >= 0),
  commission_amount numeric(14,2) not null check (commission_amount >= 0),
  status text not null default 'pending' check (status in ('pending','available','paid','reversed')),
  available_at timestamptz not null,
  paid_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (source_payment_id, beneficiary_user_id, level)
);

create index if not exists affiliate_commissions_beneficiary_idx on public.affiliate_commissions(beneficiary_user_id, created_at desc);
create index if not exists affiliate_commissions_source_idx on public.affiliate_commissions(source_user_id, created_at desc);

alter table public.affiliate_settings enable row level security;
alter table public.affiliate_profiles enable row level security;
alter table public.affiliate_commissions enable row level security;

drop policy if exists affiliate_profiles_select_own on public.affiliate_profiles;
create policy affiliate_profiles_select_own on public.affiliate_profiles
for select to authenticated using (auth.uid() = user_id);

drop policy if exists affiliate_commissions_select_own on public.affiliate_commissions;
create policy affiliate_commissions_select_own on public.affiliate_commissions
for select to authenticated using (auth.uid() = beneficiary_user_id);

create or replace function public.affiliate_code_for_user(p_user_id uuid)
returns text
language sql
immutable
strict
as $$
  select 'MI-' || upper(substr(replace(p_user_id::text, '-', ''), 1, 16));
$$;

insert into public.affiliate_profiles (user_id, referral_code)
select u.id, public.affiliate_code_for_user(u.id)
from auth.users u
on conflict (user_id) do nothing;

create or replace function public.handle_affiliate_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral text;
  v_sponsor uuid;
begin
  v_referral := upper(nullif(trim(new.raw_user_meta_data ->> 'referral_code'), ''));
  if v_referral is not null then
    select ap.user_id
      into v_sponsor
    from public.affiliate_profiles ap
    where upper(ap.referral_code) = v_referral
      and ap.user_id <> new.id
      and ap.is_active = true
    limit 1;
  end if;

  insert into public.affiliate_profiles (user_id, referral_code, sponsor_user_id)
  values (new.id, public.affiliate_code_for_user(new.id), v_sponsor)
  on conflict (user_id) do update
    set sponsor_user_id = coalesce(public.affiliate_profiles.sponsor_user_id, excluded.sponsor_user_id),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_affiliate on auth.users;
create trigger on_auth_user_created_affiliate
after insert on auth.users
for each row execute function public.handle_affiliate_new_user();

create or replace function public.affiliate_set_sponsor(p_user_id uuid, p_referral_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sponsor uuid;
  v_existing uuid;
  v_cycle boolean := false;
begin
  if auth.role() <> 'service_role' and auth.uid() is distinct from p_user_id then
    raise exception 'FORBIDDEN';
  end if;

  select sponsor_user_id into v_existing
  from public.affiliate_profiles
  where user_id = p_user_id;

  if v_existing is not null then
    return false;
  end if;

  select user_id into v_sponsor
  from public.affiliate_profiles
  where upper(referral_code) = upper(trim(p_referral_code))
    and is_active = true
  limit 1;

  if v_sponsor is null then
    raise exception 'REFERRAL_CODE_NOT_FOUND';
  end if;
  if v_sponsor = p_user_id then
    raise exception 'SELF_REFERRAL_NOT_ALLOWED';
  end if;

  with recursive ancestors(user_id, sponsor_user_id, path) as (
    select ap.user_id, ap.sponsor_user_id, array[ap.user_id]
    from public.affiliate_profiles ap
    where ap.user_id = v_sponsor
    union all
    select ap.user_id, ap.sponsor_user_id, a.path || ap.user_id
    from ancestors a
    join public.affiliate_profiles ap on ap.user_id = a.sponsor_user_id
    where a.sponsor_user_id is not null
      and not ap.user_id = any(a.path)
  )
  select exists(select 1 from ancestors where user_id = p_user_id) into v_cycle;

  if v_cycle then
    raise exception 'AFFILIATE_CYCLE_NOT_ALLOWED';
  end if;

  update public.affiliate_profiles
  set sponsor_user_id = v_sponsor,
      updated_at = now()
  where user_id = p_user_id
    and sponsor_user_id is null;

  return found;
end;
$$;

create or replace function public.affiliate_network_stats(p_user_id uuid)
returns table(direct_count bigint, network_count bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and auth.uid() is distinct from p_user_id then
    raise exception 'FORBIDDEN';
  end if;

  return query
  with recursive network(user_id, depth, path) as (
    select ap.user_id, 1, array[p_user_id, ap.user_id]
    from public.affiliate_profiles ap
    where ap.sponsor_user_id = p_user_id
    union all
    select ap.user_id, n.depth + 1, n.path || ap.user_id
    from network n
    join public.affiliate_profiles ap on ap.sponsor_user_id = n.user_id
    where n.depth < 50
      and not ap.user_id = any(n.path)
  )
  select count(*) filter (where depth = 1), count(*) from network;
end;
$$;

create or replace function public.accrue_affiliate_commissions(
  p_source_user_id uuid,
  p_payment_id text,
  p_gross_amount numeric
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.affiliate_settings%rowtype;
  v_inserted integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;
  if p_source_user_id is null or nullif(trim(p_payment_id), '') is null or coalesce(p_gross_amount, 0) <= 0 then
    return 0;
  end if;

  select * into v_settings from public.affiliate_settings where id = 1;
  if not found then
    raise exception 'AFFILIATE_SETTINGS_NOT_FOUND';
  end if;

  with recursive chain(beneficiary_user_id, level, path) as (
    select ap.sponsor_user_id, 1, array[p_source_user_id, ap.sponsor_user_id]
    from public.affiliate_profiles ap
    where ap.user_id = p_source_user_id
      and ap.sponsor_user_id is not null
    union all
    select parent.sponsor_user_id, c.level + 1, c.path || parent.sponsor_user_id
    from chain c
    join public.affiliate_profiles parent on parent.user_id = c.beneficiary_user_id
    where c.level < v_settings.max_depth
      and parent.sponsor_user_id is not null
      and not parent.sponsor_user_id = any(c.path)
  )
  insert into public.affiliate_commissions (
    beneficiary_user_id,
    source_user_id,
    source_payment_id,
    level,
    rate,
    gross_amount,
    commission_amount,
    status,
    available_at
  )
  select
    c.beneficiary_user_id,
    p_source_user_id,
    p_payment_id,
    c.level,
    case when c.level = 1 then v_settings.direct_rate else v_settings.network_rate end,
    round(p_gross_amount, 2),
    round(p_gross_amount * (case when c.level = 1 then v_settings.direct_rate else v_settings.network_rate end), 2),
    'pending',
    now() + make_interval(days => v_settings.hold_days)
  from chain c
  join public.affiliate_profiles beneficiary on beneficiary.user_id = c.beneficiary_user_id
  where c.beneficiary_user_id is not null
    and beneficiary.is_active = true
  on conflict (source_payment_id, beneficiary_user_id, level) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.accrue_affiliate_commissions(uuid,text,numeric) from public, anon, authenticated;
grant execute on function public.accrue_affiliate_commissions(uuid,text,numeric) to service_role;
grant execute on function public.affiliate_set_sponsor(uuid,text) to authenticated, service_role;
grant execute on function public.affiliate_network_stats(uuid) to authenticated, service_role;
