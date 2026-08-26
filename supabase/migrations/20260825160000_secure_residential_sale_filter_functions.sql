alter function public.is_residential_sale_listing(text,text,numeric,text,text,text,text,text,boolean,text)
  set search_path = public, pg_temp;
alter function public.residential_sale_rejection_reason(text,text,numeric,text,text,text,text,text,boolean,text)
  set search_path = public, pg_temp;
alter function public.guard_property_search_index_residential_sale()
  set search_path = public, pg_temp;

revoke all on function public.is_residential_sale_listing(text,text,numeric,text,text,text,text,text,boolean,text) from public, anon, authenticated;
revoke all on function public.residential_sale_rejection_reason(text,text,numeric,text,text,text,text,text,boolean,text) from public, anon, authenticated;
revoke all on function public.guard_property_search_index_residential_sale() from public, anon, authenticated;
