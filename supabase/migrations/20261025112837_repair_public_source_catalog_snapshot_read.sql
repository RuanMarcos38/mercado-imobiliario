CREATE OR REPLACE FUNCTION public.refresh_public_property_source_catalog()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_payload jsonb;
  v_url text;
  v_source record;
  v_code text;
  v_status text;
  v_found integer;
  v_checked_at timestamptz;
  v_updated integer := 0;
begin
  v_url := 'https://raw.githubusercontent.com/RuanMarcos38/mercado-imobiliario/public-data-cache/public-properties.json?ts=' || floor(extract(epoch from clock_timestamp()))::bigint::text;
  select ((extensions.http_get(v_url)).content)::jsonb into v_payload;
  if v_payload is null or jsonb_typeof(v_payload->'sources') is distinct from 'object'
    or jsonb_typeof(v_payload->'items') is distinct from 'array' then
    raise exception 'Public source catalog snapshot is invalid';
  end if;

  for v_source in select key, value from jsonb_each(coalesce(v_payload->'sources','{}'::jsonb)) loop
    v_code := v_source.key;
    v_status := coalesce(nullif(v_source.value->>'status',''),'error');
    if v_status not in ('active','limited','blocked','error') then v_status := 'ready'; end if;
    v_found := coalesce(nullif(v_source.value->>'found_count','')::integer,0);
    v_checked_at := nullif(v_source.value->>'checked_at','')::timestamptz;

    update public.property_source_catalog
      set public_discovery_status=v_status,
          public_discovery_count=v_found,
          last_public_discovery_at=v_checked_at,
          status=case when v_status='active' then 'active' else 'ready' end,
          updated_at=now()
      where code=v_code;
    if found then v_updated := v_updated + 1; end if;
  end loop;

  update public.property_source_catalog c
  set public_discovery_count=x.cnt,
      last_public_discovery_at=coalesce(x.last_seen,c.last_public_discovery_at),
      status='active',public_discovery_status='active',updated_at=now()
  from (
    select metadata->>'source_code' code,count(*)::integer cnt,max(last_seen_at) last_seen
    from public.property_search_index
    where coalesce(metadata->>'public_discovery','false')='true'
    group by metadata->>'source_code'
  ) x
  where c.code=x.code;

  update public.property_source_catalog
    set public_discovery_count=(select count(*)::integer from public.property_search_index where listing_market='caixa'),
        last_public_discovery_at=(select max(last_seen_at) from public.property_search_index where listing_market='caixa'),
        status='active',public_discovery_status='active',updated_at=now()
    where code='caixa';

  return jsonb_build_object('ok',true,'updated_sources',v_updated,'snapshot_generated_at',v_payload->>'generated_at','refreshed_at',now());
end;
$function$
;
REVOKE ALL ON FUNCTION public.refresh_public_property_source_catalog() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_public_property_source_catalog() TO service_role, postgres;

