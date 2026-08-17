create or replace function public.property_listing_is_real_estate(
  p_source_url text,
  p_title text,
  p_description text,
  p_property_type text
)
returns boolean
language sql
immutable
as $function$
  select
    coalesce(p_source_url, '') ~* '^https://(venda-imoveis\.caixa\.gov\.br|([a-z0-9-]+\.)?zapimoveis\.com\.br|([a-z0-9-]+\.)?vivareal\.com\.br|([a-z0-9-]+\.)?olx\.com\.br|([a-z0-9-]+\.)?imovelweb\.com\.br|([a-z0-9-]+\.)?quintoandar\.com\.br|([a-z0-9-]+\.)?chavesnamao\.com\.br|([a-z0-9-]+\.)?netimoveis\.com|([a-z0-9-]+\.)?orulo\.com\.br|([a-z0-9-]+\.)?mrv\.com\.br|([a-z0-9-]+\.)?rogga\.com\.br|([a-z0-9-]+\.)?rottasconstrutora\.com\.br|([a-z0-9-]+\.)?inicioempreendimentos\.com\.br|([a-z0-9-]+\.)?ayoshii\.com\.br|([a-z0-9-]+\.)?tenda\.com\.br|([a-z0-9-]+\.)?curyconstrutora\.com\.br|([a-z0-9-]+\.)?cyrela\.com\.br|([a-z0-9-]+\.)?even\.com\.br|([a-z0-9-]+\.)?eztec\.com\.br|([a-z0-9-]+\.)?gafisa\.com\.br|([a-z0-9-]+\.)?grupodirecional\.com|([a-z0-9-]+\.)?helbor\.com\.br|([a-z0-9-]+\.)?mouradubeux\.com\.br|([a-z0-9-]+\.)?patrimar\.com\.br|([a-z0-9-]+\.)?plaenge\.com\.br|([a-z0-9-]+\.)?planoeplano\.com\.br|([a-z0-9-]+\.)?canalpro\.grupozap\.com)/'
    and (
      nullif(trim(coalesce(p_property_type, '')), '') is not null
      or concat_ws(' ', p_title, p_description) ~* '(im[oó]vel|apartamento|casa|terreno|lote|sobrado|kitnet|studio|loft|cobertura|ch[aá]cara|s[ií]tio|fazenda|galp[aã]o|sala comercial|loja|pr[eé]dio|condom[ií]nio|empreendimento)'
    );
$function$;

drop index if exists public.idx_property_search_health_real;
create index idx_property_search_health_real
  on public.property_search_index (last_seen_at desc, location_state)
  where public.property_listing_is_real_estate(source_url, title, description, property_type);

drop index if exists public.idx_property_search_health_nonreal;
create index idx_property_search_health_nonreal
  on public.property_search_index (id)
  where not public.property_listing_is_real_estate(source_url, title, description, property_type);

create or replace function public.search_index_health()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with params as (
    select now() - interval '2 hours' as cutoff
  ),
  fresh as (
    select count(*)::bigint as count,
           count(distinct upper(location_state)) filter (where location_state is not null)::bigint as states
    from public.property_search_index, params
    where last_seen_at >= params.cutoff
      and public.property_listing_is_real_estate(source_url, title, description, property_type)
  ),
  latest as (
    select max(last_seen_at) as latest_update
    from public.property_search_index
  ),
  stale as (
    select count(*)::bigint as stale_count
    from public.property_search_index, params
    where last_seen_at is null or last_seen_at < params.cutoff
  ),
  non_property as (
    select count(*)::bigint as non_property_count
    from public.property_search_index
    where not public.property_listing_is_real_estate(source_url, title, description, property_type)
  )
  select jsonb_build_object(
    'count', fresh.count,
    'states', fresh.states,
    'latest_update', latest.latest_update,
    'stale_count', stale.stale_count,
    'non_property_count', non_property.non_property_count,
    'freshness_sla_minutes', 120
  )
  from fresh cross join latest cross join stale cross join non_property;
$function$;

revoke all on function public.search_index_health() from public;
grant execute on function public.search_index_health() to anon, authenticated, service_role;
