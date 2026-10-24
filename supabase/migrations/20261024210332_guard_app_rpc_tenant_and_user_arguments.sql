-- Two app RPCs reviewed against their call sites and current definitions.
-- Preserve the existing API and business logic; reject foreign tenant/user input.
do $guard_user_feature$
declare d text;
begin
 select pg_get_functiondef('public.user_has_plan_feature(uuid,text)'::regprocedure) into d;
 if md5(d) <> 'd71020059f28bb49f797a5f1e9f66cd4' then raise exception 'Definition changed; review again'; end if;
 d := replace(d,E'
begin
',E'
begin
  if coalesce(auth.role(),'''') <> ''service_role'' and (auth.uid() is null or auth.uid() is distinct from p_user_id) then
    raise exception ''FORBIDDEN_USER'' using errcode = ''42501'';
  end if;
');
 execute d;
end $guard_user_feature$;
revoke all on function public.user_has_plan_feature(uuid,text) from public,anon;
grant execute on function public.user_has_plan_feature(uuid,text) to authenticated,service_role;
do $guard_crm_pipeline$
declare d text;
begin
 select pg_get_functiondef('public.crm_ensure_default_pipeline(uuid,uuid)'::regprocedure) into d;
 if md5(d) <> '6429f3c24b0ae06879a4652446bfa62b' then raise exception 'Definition changed; review again'; end if;
 d := replace(d,E'
begin
',E'
begin
  if pg_trigger_depth() = 0 and coalesce(auth.role(),'''') <> ''service_role'' then
    if auth.uid() is null or not exists (select 1 from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=auth.uid()) then
      raise exception ''FORBIDDEN_TENANT'' using errcode = ''42501'';
    end if;
    if p_user_id is not null and p_user_id is distinct from auth.uid() then
      raise exception ''FORBIDDEN_USER'' using errcode = ''42501'';
    end if;
  end if;
');
 execute d;
end $guard_crm_pipeline$;
revoke all on function public.crm_ensure_default_pipeline(uuid,uuid) from public,anon;
grant execute on function public.crm_ensure_default_pipeline(uuid,uuid) to authenticated,service_role;
notify pgrst,'reload schema';
