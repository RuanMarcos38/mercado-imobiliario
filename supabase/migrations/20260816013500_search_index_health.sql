create or replace function public.search_index_health()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'count', count(*),
    'states', count(distinct location_state),
    'latest_update', max(scanned_at)
  )
  from public.property_search_index;
$$;

revoke all on function public.search_index_health() from public;
grant execute on function public.search_index_health() to anon, authenticated;
