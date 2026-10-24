-- Reviewed view: exposes global contatos names, phones, income and FGTS; no tenant predicate and no application view references. Keep server reads only, enforce underlying RLS for any future grants.
alter view public.leads_para_atendimento set (security_invoker=true);
revoke all on public.leads_para_atendimento from public,anon,authenticated;
grant select on public.leads_para_atendimento to service_role;
-- Six reviewed helpers only use built-in functions/public row types; freeze their search path without changing bodies or grants.
alter function public.set_updated_at() set search_path=public,pg_temp;
alter function public.ia_touch_updated_at() set search_path=public,pg_temp;
alter function public.sdr_missing_fields(public.sdr_contacts) set search_path=public,pg_temp;
alter function public.property_listing_is_real_estate(text,text,text,text) set search_path=public,pg_temp;
alter function public.safe_small_property_integer(text,integer) set search_path=public,pg_temp;
alter function public.affiliate_code_for_user(uuid) set search_path=public,pg_temp;
notify pgrst,'reload schema';
