create or replace function public.property_dashboard_stats()
returns jsonb language sql stable security invoker set search_path = ''
as $function$
select jsonb_build_object(
  'total_properties', count(*),
  'market_properties', count(*) filter (where coalesce(listing_market, 'market') <> 'caixa'),
  'caixa_properties', count(*) filter (where listing_market = 'caixa'),
  'auction_properties', count(*) filter (where is_auction is true),
  'new_last_24h', count(*) filter (where scanned_at >= now() - interval '24 hours'),
  'opportunities', count(*) filter (where case
    when (metadata->>'discount_percent') ~ '^[0-9]+([.,][0-9]+)?$'
    then replace(metadata->>'discount_percent', ',', '.')::numeric >= 15
    else false end),
  'active_sources', count(distinct nullif(source_portal, '')),
  'latest_scan', max(scanned_at)
)
from public.property_search_index
where last_seen_at >= now() - interval '2 hours'
  and (listing_market = 'caixa' or is_auction is true or price > 0
    or location_address is not null or location_city is not null
    or area_sqm > 0 or bedrooms > 0 or bathrooms > 0);
$function$;
revoke all on function public.property_dashboard_stats() from public, anon;
grant execute on function public.property_dashboard_stats() to authenticated, service_role;

