create or replace function public.property_dashboard_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with index_stats as (
    select
      count(*)::bigint as total_indexed,
      count(*) filter (where listing_market = 'caixa')::bigint as caixa_total,
      count(*) filter (where is_auction = true)::bigint as auction_total,
      count(*) filter (where coalesce(listing_market,'market') <> 'caixa')::bigint as market_indexed,
      count(*) filter (where scanned_at >= now() - interval '24 hours')::bigint as new_indexed_24h,
      count(*) filter (
        where nullif(metadata->>'discount_percent','') is not null
          and (metadata->>'discount_percent') ~ '^[0-9]+([.,][0-9]+)?$'
          and replace(metadata->>'discount_percent', ',', '.')::numeric >= 15
      )::bigint as discount_opportunities,
      count(distinct nullif(source_portal,''))::bigint as active_sources,
      max(scanned_at) as latest_scan
    from public.property_search_index
  ),
  saved_stats as (
    select
      count(*)::bigint as saved_total,
      count(*) filter (where updated_at >= now() - interval '24 hours')::bigint as new_saved_24h
    from public.properties
  )
  select jsonb_build_object(
    'total_properties', i.total_indexed + s.saved_total,
    'market_properties', i.market_indexed + s.saved_total,
    'caixa_properties', i.caixa_total,
    'auction_properties', i.auction_total,
    'new_last_24h', i.new_indexed_24h + s.new_saved_24h,
    'opportunities', i.discount_opportunities,
    'active_sources', i.active_sources,
    'latest_scan', i.latest_scan
  )
  from index_stats i cross join saved_stats s;
$$;

revoke all on function public.property_dashboard_stats() from public, anon;
grant execute on function public.property_dashboard_stats() to authenticated;
