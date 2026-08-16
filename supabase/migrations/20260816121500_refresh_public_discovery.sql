create or replace function public.refresh_public_property_index()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_payload jsonb;
  v_generated_at timestamptz;
  v_staged integer := 0;
  v_upserted integer := 0;
  v_removed integer := 0;
  v_source record;
begin
  select ((extensions.http_get(
    'https://raw.githubusercontent.com/RuanMarcos38/mercado-imobiliario/public-data-cache/public-properties.json'
  )).content)::jsonb
  into v_payload;

  if v_payload is null or jsonb_typeof(v_payload->'items') <> 'array' then
    raise exception 'Public discovery snapshot is invalid';
  end if;

  v_generated_at := coalesce(nullif(v_payload->>'generated_at','')::timestamptz, now());

  create temporary table tmp_public_property_refresh on commit drop as
  select
    item->>'title' as title,
    nullif(item->>'description','') as description,
    nullif(item->>'price','')::numeric as price,
    nullif(item->>'location_city','') as location_city,
    nullif(item->>'location_state','') as location_state,
    nullif(item->>'location_address','') as location_address,
    nullif(item->>'property_type','') as property_type,
    nullif(item->>'bedrooms','')::integer as bedrooms,
    nullif(item->>'bathrooms','')::integer as bathrooms,
    nullif(item->>'area_sqm','')::numeric as area_sqm,
    case
      when jsonb_typeof(item->'images')='array'
        then array(select jsonb_array_elements_text(item->'images'))
      else null::text[]
    end as images,
    item->>'source_url' as source_url,
    coalesce(nullif(item->>'source_portal',''),'Descoberta Pública') as source_portal,
    false as is_verified,
    nullif(item->>'contact_name','') as contact_name,
    nullif(item->>'contact_phone','') as contact_phone,
    nullif(item->>'contact_whatsapp','') as contact_whatsapp,
    nullif(item->>'contact_email','') as contact_email,
    nullif(item->>'source_property_id','') as source_property_id,
    coalesce(item->'metadata','{}'::jsonb) || jsonb_build_object(
      'public_discovery', true,
      'source_code', item->>'source_code',
      'snapshot_generated_at', v_generated_at
    ) as metadata
  from jsonb_array_elements(v_payload->'items') as item
  where item->>'source_url' like 'http%'
    and nullif(item->>'title','') is not null;

  select count(*) into v_staged from tmp_public_property_refresh;

  insert into public.property_search_index (
    title, description, price, location_city, location_state, location_address,
    property_type, bedrooms, bathrooms, area_sqm, images,
    source_url, source_portal, anti_fraud_score, is_verified, scanned_at,
    metadata, listing_market, is_auction, sale_mode,
    contact_name, contact_phone, contact_whatsapp, contact_email,
    source_property_id, first_seen_at, last_seen_at
  )
  select
    title, description, price, location_city, location_state, location_address,
    property_type, bedrooms, bathrooms, area_sqm, images,
    source_url, source_portal, 0.65, is_verified, v_generated_at,
    metadata, 'market', false, 'Anúncio público',
    contact_name, contact_phone, contact_whatsapp, contact_email,
    source_property_id, v_generated_at, v_generated_at
  from tmp_public_property_refresh
  on conflict (source_url) do update set
    title = excluded.title,
    description = excluded.description,
    price = excluded.price,
    location_city = excluded.location_city,
    location_state = excluded.location_state,
    location_address = excluded.location_address,
    property_type = excluded.property_type,
    bedrooms = excluded.bedrooms,
    bathrooms = excluded.bathrooms,
    area_sqm = excluded.area_sqm,
    images = excluded.images,
    source_portal = excluded.source_portal,
    scanned_at = excluded.scanned_at,
    metadata = excluded.metadata,
    listing_market = 'market',
    is_auction = false,
    sale_mode = 'Anúncio público',
    contact_name = excluded.contact_name,
    contact_phone = excluded.contact_phone,
    contact_whatsapp = excluded.contact_whatsapp,
    contact_email = excluded.contact_email,
    source_property_id = excluded.source_property_id,
    first_seen_at = coalesce(property_search_index.first_seen_at, excluded.first_seen_at),
    last_seen_at = excluded.last_seen_at
  where coalesce(property_search_index.metadata->>'public_discovery','false') = 'true';
  get diagnostics v_upserted = row_count;

  if jsonb_typeof(v_payload->'removed_urls')='array' then
    delete from public.property_search_index target
    where coalesce(target.metadata->>'public_discovery','false')='true'
      and target.source_url in (
        select jsonb_array_elements_text(v_payload->'removed_urls')
      );
    get diagnostics v_removed = row_count;
  end if;

  if jsonb_typeof(v_payload->'sources')='object' then
    for v_source in
      select key as code, value as payload
      from jsonb_each(v_payload->'sources')
    loop
      update public.property_source_catalog
      set public_discovery_status = case
            when v_source.payload->>'status' in ('active','limited','blocked','error')
              then v_source.payload->>'status'
            else 'ready'
          end,
          public_discovery_count = coalesce(nullif(v_source.payload->>'found_count','')::integer,0),
          last_public_discovery_at = coalesce(nullif(v_source.payload->>'checked_at','')::timestamptz, v_generated_at),
          updated_at = now()
      where code = v_source.code;
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'generated_at', v_generated_at,
    'staged', v_staged,
    'upserted', v_upserted,
    'removed', v_removed,
    'refreshed_at', now()
  );
end;
$$;

revoke all on function public.refresh_public_property_index() from public, anon, authenticated;

DO $$
DECLARE
  existing_job bigint;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname='refresh-public-property-index'
  LIMIT 1;

  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;

  PERFORM cron.schedule(
    'refresh-public-property-index',
    '25 * * * *',
    'select public.refresh_public_property_index();'
  );
END;
$$;
