-- Restore property search coverage for public discovery sources.
-- The previous 2-hour window hid valid listings between scheduled source refreshes.

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
    coalesce(p_source_url, '') ~* '^https://(venda-imoveis\.caixa\.gov\.br|([a-z0-9-]+\.)?zapimoveis\.com\.br|([a-z0-9-]+\.)?vivareal\.com\.br|([a-z0-9-]+\.)?olx\.com\.br|([a-z0-9-]+\.)?imovelweb\.com\.br|([a-z0-9-]+\.)?quintoandar\.com\.br|([a-z0-9-]+\.)?chavesnamao\.com\.br|([a-z0-9-]+\.)?netimoveis\.com|([a-z0-9-]+\.)?orulo\.com\.br|([a-z0-9-]+\.)?mrv\.com\.br|([a-z0-9-]+\.)?rogga\.com\.br|([a-z0-9-]+\.)?rottasconstrutora\.com\.br|([a-z0-9-]+\.)?inicioempreendimentos\.com\.br|([a-z0-9-]+\.)?ayoshii\.com\.br|([a-z0-9-]+\.)?tenda\.com\.br|([a-z0-9-]+\.)?curyconstrutora\.com\.br|([a-z0-9-]+\.)?cyrela\.com\.br|([a-z0-9-]+\.)?even\.com\.br|([a-z0-9-]+\.)?eztec\.com\.br|([a-z0-9-]+\.)?gafisa\.com\.br|([a-z0-9-]+\.)?grupodirecional\.com|([a-z0-9-]+\.)?direcional\.com\.br|([a-z0-9-]+\.)?rivaincorporadora\.com\.br|([a-z0-9-]+\.)?helbor\.com\.br|([a-z0-9-]+\.)?mouradubeux\.com\.br|([a-z0-9-]+\.)?patrimar\.com\.br|([a-z0-9-]+\.)?plaenge\.com\.br|([a-z0-9-]+\.)?planoeplano\.com\.br|([a-z0-9-]+\.)?canalpro\.grupozap\.com)/'
    and (
      nullif(trim(coalesce(p_property_type, '')), '') is not null
      or concat_ws(' ', p_title, p_description) ~* '(im[oó]vel|apartamento|casa|terreno|lote|sobrado|kitnet|studio|loft|cobertura|ch[aá]cara|s[ií]tio|fazenda|galp[aã]o|sala comercial|loja|pr[eé]dio|condom[ií]nio|empreendimento)'
    );
$function$;

drop policy if exists "authenticated read fresh real estate index"
  on public.property_search_index;

create policy "authenticated read fresh real estate index"
on public.property_search_index
for select
to authenticated
using (
  coalesce(last_seen_at, scanned_at) >= now() - interval '90 days'
  and public.property_listing_is_real_estate(source_url, title, description, property_type)
);

create or replace function public.search_index_health()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with params as (
    select now() - interval '90 days' as cutoff
  ),
  eligible as (
    select *
    from public.property_search_index, params
    where coalesce(last_seen_at, scanned_at) >= params.cutoff
      and public.property_listing_is_real_estate(source_url, title, description, property_type)
  ),
  fresh as (
    select
      count(*)::bigint as count,
      count(distinct upper(location_state)) filter (where location_state is not null)::bigint as states
    from eligible
  ),
  latest as (
    select max(coalesce(last_seen_at, scanned_at)) as latest_update
    from public.property_search_index
  ),
  stale as (
    select count(*)::bigint as stale_count
    from public.property_search_index, params
    where coalesce(last_seen_at, scanned_at) is null
       or coalesce(last_seen_at, scanned_at) < params.cutoff
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
    'freshness_sla_minutes', 129600
  )
  from fresh cross join latest cross join stale cross join non_property;
$function$;

revoke all on function public.search_index_health() from public;
grant execute on function public.search_index_health() to anon, authenticated, service_role;

create or replace function public.property_region_search_health(
  p_city text,
  p_state text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with eligible as (
    select *
    from public.property_search_index
    where coalesce(last_seen_at, scanned_at) >= now() - interval '90 days'
      and public.property_listing_is_real_estate(source_url, title, description, property_type)
      and (
        coalesce(location_city,'') ilike '%' || p_city || '%'
        or coalesce(location_address,'') ilike '%' || p_city || '%'
        or coalesce(title,'') ilike '%' || p_city || '%'
      )
      and (p_state is null or location_state is null or upper(location_state)=upper(p_state))
  )
  select jsonb_build_object(
    'city', p_city,
    'state', p_state,
    'total', count(*),
    'market', count(*) filter(where coalesce(listing_market, 'market') <> 'caixa'),
    'caixa', count(*) filter(where listing_market = 'caixa'),
    'sources', count(distinct source_portal),
    'market_sources', coalesce(
      jsonb_agg(distinct source_portal) filter(where coalesce(listing_market, 'market') <> 'caixa'),
      '[]'::jsonb
    )
  ) from eligible;
$function$;

revoke all on function public.property_region_search_health(text, text) from public, anon;
grant execute on function public.property_region_search_health(text, text) to authenticated, service_role, postgres;

drop function if exists public.location_market_evidence(text, text);

create or replace function public.location_market_evidence(
  p_city text,
  p_neighborhood text default null,
  p_state text default null
)
returns table (
  sample_size bigint,
  median_price numeric,
  median_price_per_sqm numeric,
  average_price numeric,
  p25_price numeric,
  p75_price numeric,
  recent_listings_90d bigint,
  source_count bigint,
  latest_seen_at timestamptz,
  scope text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with city_rows as (
    select
      price::numeric as price,
      area_sqm::numeric as area_sqm,
      coalesce(last_seen_at, scanned_at) as seen_at,
      source_portal,
      location_address,
      title,
      description
    from public.property_search_index
    where price is not null
      and price > 0
      and public.property_listing_is_real_estate(source_url, title, description, property_type)
      and (
        lower(trim(coalesce(location_city, ''))) = lower(trim(p_city))
        or coalesce(location_address, '') ilike '%' || trim(p_city) || '%'
        or coalesce(title, '') ilike '%' || trim(p_city) || '%'
      )
      and (
        nullif(trim(coalesce(p_state, '')), '') is null
        or location_state is null
        or upper(location_state) = upper(trim(p_state))
      )
  ),
  neighborhood_rows as (
    select *
    from city_rows
    where nullif(trim(coalesce(p_neighborhood, '')), '') is not null
      and concat_ws(' ', location_address, title, description) ilike '%' || trim(p_neighborhood) || '%'
  ),
  chosen as (
    select n.*, 'bairro'::text as scope from neighborhood_rows n
    where (select count(*) from neighborhood_rows) >= 3
    union all
    select c.*, 'cidade'::text as scope from city_rows c
    where (select count(*) from neighborhood_rows) < 3
  )
  select
    count(*)::bigint as sample_size,
    percentile_cont(0.5) within group (order by price)::numeric as median_price,
    percentile_cont(0.5) within group (order by price / nullif(area_sqm, 0))
      filter (where area_sqm > 10)::numeric as median_price_per_sqm,
    avg(price)::numeric as average_price,
    percentile_cont(0.25) within group (order by price)::numeric as p25_price,
    percentile_cont(0.75) within group (order by price)::numeric as p75_price,
    count(*) filter (where seen_at >= now() - interval '90 days')::bigint as recent_listings_90d,
    count(distinct source_portal)::bigint as source_count,
    max(seen_at) as latest_seen_at,
    coalesce(max(scope), 'cidade')::text as scope
  from chosen;
$function$;

revoke all on function public.location_market_evidence(text, text, text) from public, anon;
grant execute on function public.location_market_evidence(text, text, text) to authenticated, service_role, postgres;

comment on function public.location_market_evidence(text, text, text) is
  'Returns aggregated real-estate market evidence for location analysis, filtered by city, optional UF and optional bairro. Uses bairro when at least 3 matching listings exist, otherwise falls back to the municipality.';

notify pgrst, 'reload schema';
