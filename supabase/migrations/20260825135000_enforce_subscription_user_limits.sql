-- Hard seat limits per commercial plan. Additive only: no existing data is removed or reassigned.

update public.subscription_plans
set user_limit = case slug
  when 'start' then 1
  when 'pro_ia' then 1
  when 'equipe' then 5
  when 'imobiliaria' then 15
  when 'enterprise' then 50
  else user_limit
end,
updated_at = now()
where slug in ('start','pro_ia','equipe','imobiliaria','enterprise');

create or replace function public.enforce_tenant_plan_user_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_user_id uuid;
  v_user_limit integer := 1;
  v_plan_name text := 'Plano atual';
  v_seats_used integer := 0;
begin
  -- Serializa alterações de assentos do mesmo tenant para evitar duas inclusões simultâneas ultrapassarem o limite.
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text, 0));

  select t.owner_user_id
    into v_owner_user_id
  from public.tenants t
  where t.id = new.tenant_id;

  if v_owner_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'TENANT_NOT_FOUND';
  end if;

  select sp.user_limit, sp.name
    into v_user_limit, v_plan_name
  from public.subscriptions s
  join public.subscription_plans sp on sp.id = s.plan_id
  where s.user_id = v_owner_user_id
    and s.status in ('active', 'trialing')
    and sp.is_active = true
  order by s.created_at desc
  limit 1;

  -- Conta sem assinatura ativa pode manter apenas o proprietário inicial.
  v_user_limit := coalesce(v_user_limit, 1);
  v_plan_name := coalesce(v_plan_name, 'Sem plano ativo');

  select count(*)::integer
    into v_seats_used
  from public.tenant_members tm
  where tm.tenant_id = new.tenant_id
    and (tg_op = 'INSERT' or tm.id <> new.id);

  if v_seats_used >= v_user_limit then
    raise exception using
      errcode = 'P0001',
      message = format(
        'PLAN_USER_LIMIT_REACHED|%s|%s|%s',
        v_plan_name,
        v_user_limit,
        v_seats_used
      );
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_tenant_plan_user_limit() from public;
revoke all on function public.enforce_tenant_plan_user_limit() from authenticated;

drop trigger if exists tenant_members_enforce_plan_user_limit on public.tenant_members;
create trigger tenant_members_enforce_plan_user_limit
before insert or update of tenant_id, user_id on public.tenant_members
for each row execute function public.enforce_tenant_plan_user_limit();

create or replace function public.get_my_tenant_user_capacity()
returns table (
  tenant_id uuid,
  plan_slug text,
  plan_name text,
  user_limit integer,
  seats_used integer,
  seats_available integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with my_tenant as (
    select tm.tenant_id
    from public.tenant_members tm
    where tm.user_id = auth.uid()
    order by tm.created_at
    limit 1
  ), tenant_owner as (
    select t.id as tenant_id, t.owner_user_id
    from public.tenants t
    join my_tenant mt on mt.tenant_id = t.id
  ), latest_plan as (
    select
      t.tenant_id,
      sp.slug as plan_slug,
      sp.name as plan_name,
      sp.user_limit
    from tenant_owner t
    left join lateral (
      select s.plan_id
      from public.subscriptions s
      where s.user_id = t.owner_user_id
        and s.status in ('active', 'trialing')
      order by s.created_at desc
      limit 1
    ) s on true
    left join public.subscription_plans sp on sp.id = s.plan_id and sp.is_active = true
  ), seat_count as (
    select mt.tenant_id, count(*)::integer as seats_used
    from my_tenant mt
    join public.tenant_members tm on tm.tenant_id = mt.tenant_id
    group by mt.tenant_id
  )
  select
    lp.tenant_id,
    coalesce(lp.plan_slug, 'sem_plano')::text,
    coalesce(lp.plan_name, 'Sem plano ativo')::text,
    coalesce(lp.user_limit, 1)::integer,
    coalesce(sc.seats_used, 0)::integer,
    greatest(coalesce(lp.user_limit, 1) - coalesce(sc.seats_used, 0), 0)::integer
  from latest_plan lp
  left join seat_count sc on sc.tenant_id = lp.tenant_id;
$$;

revoke all on function public.get_my_tenant_user_capacity() from public;
grant execute on function public.get_my_tenant_user_capacity() to authenticated;
