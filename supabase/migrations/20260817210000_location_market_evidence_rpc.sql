create or replace function public.location_market_evidence(
  p_city text,
  p_neighborhood text default null
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
as $$
  with city_rows as (
    select
      price::numeric as price,
      area_sqm::numeric as area_sqm,
      coalesce(last_seen_at, scanned_at) as seen_at,
      source_portal,
      location_address
    from public.property_search_index
    where lower(trim(location_city)) = lower(trim(p_city))
      and price is not null
      and price > 0
      and public.property_listing_is_real_estate(source_url, title, description, property_type)
  ),
  neighborhood_rows as (
    select *
    from city_rows
    where nullif(trim(coalesce(p_neighborhood, '')), '') is not null
      and lower(coalesce(location_address, '')) like '%' || lower(trim(p_neighborhood)) || '%'
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
$$;

revoke all on function public.location_market_evidence(text, text) from public, anon;
grant execute on function public.location_market_evidence(text, text) to authenticated, service_role, postgres;

comment on function public.location_market_evidence(text, text) is
  'Returns only aggregated real-estate market evidence for location analysis. Uses bairro when at least 3 matching listings exist, otherwise falls back to the municipality. Does not expose listing rows.';
