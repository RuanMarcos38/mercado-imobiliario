create or replace function public.location_market_evidence(
  p_city text,
  p_neighborhood text,
  p_state text
)
returns table (
  indexed_listings bigint,
  priced_listings bigint,
  sample_size bigint,
  median_price numeric,
  median_price_per_sqm numeric,
  average_price numeric,
  p25_price numeric,
  p75_price numeric,
  recent_listings_90d bigint,
  source_count bigint,
  latest_seen_at timestamptz,
  pricing_scope text,
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
      location_address,
      title,
      description,
      property_type
    from public.property_search_index
    where lower(trim(location_city)) = lower(trim(p_city))
      and (
        nullif(trim(coalesce(p_state, '')), '') is null
        or upper(trim(coalesce(location_state, ''))) = upper(trim(p_state))
      )
      and public.property_listing_is_real_estate(source_url, title, description, property_type)
  ),
  neighborhood_rows as (
    select *
    from city_rows
    where nullif(trim(coalesce(p_neighborhood, '')), '') is not null
      and lower(
        coalesce(location_address, '') || ' ' ||
        coalesce(title, '') || ' ' ||
        coalesce(description, '')
      ) like '%' || lower(trim(p_neighborhood)) || '%'
  ),
  scope_decision as (
    select
      (
        (select count(*) from neighborhood_rows) >= 3
        and (select count(*) from neighborhood_rows where price is not null and price > 0) >= 2
      ) as use_neighborhood
  ),
  chosen as (
    select n.*, 'bairro'::text as scope
    from neighborhood_rows n, scope_decision d
    where d.use_neighborhood

    union all

    select c.*, 'cidade'::text as scope
    from city_rows c, scope_decision d
    where not d.use_neighborhood
  ),
  priced as (
    select *
    from chosen
    where price is not null and price > 0
  ),
  residential_priced as (
    select *
    from priced
    where lower(coalesce(property_type, '')) ~ '(apart|casa|sobrado|studio|kitnet|flat|loft|resid)'
  ),
  stats_rows as (
    select r.*
    from residential_priced r
    where (select count(*) from residential_priced) >= 5

    union all

    select p.*
    from priced p
    where (select count(*) from residential_priced) < 5
  )
  select
    (select count(*)::bigint from chosen) as indexed_listings,
    (select count(*)::bigint from priced) as priced_listings,
    count(*)::bigint as sample_size,
    percentile_cont(0.5) within group (order by price)::numeric as median_price,
    percentile_cont(0.5) within group (order by price / nullif(area_sqm, 0))
      filter (where area_sqm > 10)::numeric as median_price_per_sqm,
    avg(price)::numeric as average_price,
    percentile_cont(0.25) within group (order by price)::numeric as p25_price,
    percentile_cont(0.75) within group (order by price)::numeric as p75_price,
    (select count(*)::bigint from chosen where seen_at >= now() - interval '90 days') as recent_listings_90d,
    (select count(distinct source_portal)::bigint from chosen) as source_count,
    (select max(seen_at) from chosen) as latest_seen_at,
    case
      when (select count(*) from residential_priced) >= 5 then 'residencial'
      else 'todos'
    end::text as pricing_scope,
    coalesce((select max(scope) from chosen), 'cidade')::text as scope
  from stats_rows;
$$;

revoke all on function public.location_market_evidence(text, text, text) from public, anon;
grant execute on function public.location_market_evidence(text, text, text) to authenticated, service_role, postgres;

comment on function public.location_market_evidence(text, text, text) is
  'Aggregated live location evidence filtered by city and UF. Distinguishes all indexed listings from priced listings, matches bairro in address/title/description, and uses residential pricing when the sample is sufficient.';
