-- Entitlements are derived from the latest active/trialing subscription plan.
-- Administrators and explicit per-user overrides remain supported.
create or replace function public.user_has_plan_feature(p_user_id uuid, p_feature_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_override boolean;
  v_override_exists boolean;
  v_plan_features text[];
begin
  select exists(select 1 from public.user_roles where user_id=p_user_id and role='admin') into v_admin;
  if v_admin then return true; end if;

  select allowed, true into v_override, v_override_exists
  from public.user_feature_access
  where user_id=p_user_id and feature_key=p_feature_key
  limit 1;
  if coalesce(v_override_exists,false) then return v_override; end if;

  select sp.feature_keys into v_plan_features
  from public.subscriptions s
  join public.subscription_plans sp on sp.id=s.plan_id and sp.is_active=true
  where s.user_id=p_user_id and s.status in ('active','trialing')
  order by s.created_at desc
  limit 1;

  if v_plan_features is null then
    return false;
  end if;
  return p_feature_key = any(v_plan_features);
end;
$$;

revoke all on function public.user_has_plan_feature(uuid,text) from public;
grant execute on function public.user_has_plan_feature(uuid,text) to authenticated;
