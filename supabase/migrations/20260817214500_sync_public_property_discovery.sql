create or replace function public.refresh_public_property_index()
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  v_payload jsonb;
  v_source_count integer := 0;
  v_staged integer := 0;
  v_upserted integer := 0;
  v_removed integer := 0;
  v_generated_at text;
begin
  select ((extensions.http_get('https://raw.githubusercontent.com/RuanMarcos38/mercado-imobiliario/public-data-cache/public-properties.json')).content)::jsonb
    into v_payload;

  if v_payload is null or jsonb_typeof(v_payload->'items') <> 'array' then
    raise exception 'Public property snapshot is invalid';
  end if;

  select count(*) into v_source_count
  from jsonb_object_keys(coalesce(v_payload->'sources','{}'::jsonb));
  v_generated_at := v_payload->>'generated_at';

  create temporary table tmp_public_property_refresh on commit drop as
  select
    item->>'title' as title,
    nullif(item->>'description','') as description,
    nullif(item->>'price','')::numeric as price,
    nullif(item->>'location_city','') as location_city,
    nullif(item->>'location_state','') as location_state,
    nullif(item->>'location_address','') as location_address,
    nullif(item->>'property_type','') as property_type,
    nullif(item->>'bedrooms','')::numeric::integer as bedrooms,
    nullif(item->>'bathrooms','')::numeric::integer as bathrooms,
    nullif(item->>'area_sqm','')::numeric as area_sqm,
    case when jsonb_typeof(item->'images')='array'
      then array(select jsonb_array_elements_text(item->'images'))
      else null::text[] end as images,
    item->>'source_url' as source_url,
    coalesce(nullif(item->>'source_portal',''), nullif(item->>'source_code',''), 'Descoberta pública') as source_portal,
    0.80::numeric as anti_fraud_score,
    coalesce((item->>'is_verified')::boolean, false) as is_verified,
    coalesce(
      nullif(item->'metadata'->>'checked_at','')::timestamptz,
      nullif(v_generated_at,'')::timestamptz,
      now()
    ) as scanned_at,
    coalesce(item->'metadata','{}'::jsonb)
      || jsonb_build_object('public_discovery', true, 'source_code', item->>'source_code') as metadata,
    'market'::text as listing_market,
    false as is_auction,
    null::text as sale_mode,
    nullif(item->>'source_property_id','') as source_property_id,
    nullif(item->>'contact_name','') as contact_name,
    nullif(item->>'contact_phone','') as contact_phone,
    nullif(item->>'contact_whatsapp','') as contact_whatsapp,
    nullif(item->>'contact_email','') as contact_email,
    now() as last_seen_at
  from jsonb_array_elements(v_payload->'items') item
  where nullif(item->>'source_url','') is not null
    and nullif(item->>'title','') is not null;

  select count(*) into v_staged from tmp_public_property_refresh;

  insert into public.property_search_index(
    title,description,price,location_city,location_state,location_address,property_type,
    bedrooms,bathrooms,area_sqm,images,source_url,source_portal,anti_fraud_score,is_verified,
    scanned_at,metadata,listing_market,is_auction,sale_mode,source_property_id,contact_name,
    contact_phone,contact_whatsapp,contact_email,first_seen_at,last_seen_at
  )
  select
    title,description,price,location_city,location_state,location_address,property_type,
    bedrooms,bathrooms,area_sqm,images,source_url,source_portal,anti_fraud_score,is_verified,
    scanned_at,metadata,listing_market,is_auction,sale_mode,source_property_id,contact_name,
    contact_phone,contact_whatsapp,contact_email,now(),last_seen_at
  from tmp_public_property_refresh
  on conflict(source_url) do update set
    title=excluded.title,
    description=excluded.description,
    price=excluded.price,
    location_city=coalesce(excluded.location_city, property_search_index.location_city),
    location_state=coalesce(excluded.location_state, property_search_index.location_state),
    location_address=coalesce(excluded.location_address, property_search_index.location_address),
    property_type=coalesce(excluded.property_type, property_search_index.property_type),
    bedrooms=coalesce(excluded.bedrooms, property_search_index.bedrooms),
    bathrooms=coalesce(excluded.bathrooms, property_search_index.bathrooms),
    area_sqm=coalesce(excluded.area_sqm, property_search_index.area_sqm),
    images=case
      when coalesce(array_length(excluded.images,1),0)>0 then excluded.images
      else property_search_index.images
    end,
    source_portal=excluded.source_portal,
    anti_fraud_score=greatest(property_search_index.anti_fraud_score, excluded.anti_fraud_score),
    is_verified=property_search_index.is_verified or excluded.is_verified,
    scanned_at=excluded.scanned_at,
    metadata=property_search_index.metadata || excluded.metadata,
    listing_market='market',
    is_auction=false,
    source_property_id=coalesce(excluded.source_property_id, property_search_index.source_property_id),
    contact_name=coalesce(excluded.contact_name, property_search_index.contact_name),
    contact_phone=coalesce(excluded.contact_phone, property_search_index.contact_phone),
    contact_whatsapp=coalesce(excluded.contact_whatsapp, property_search_index.contact_whatsapp),
    contact_email=coalesce(excluded.contact_email, property_search_index.contact_email),
    last_seen_at=excluded.last_seen_at;

  get diagnostics v_upserted = row_count;

  delete from public.property_search_index target
  where target.listing_market='market'
    and coalesce(target.metadata->>'public_discovery','false')='true'
    and not exists (
      select 1
      from tmp_public_property_refresh staged
      where staged.source_url=target.source_url
    );
  get diagnostics v_removed = row_count;

  return jsonb_build_object(
    'ok',true,
    'sources',v_source_count,
    'staged',v_staged,
    'upserted',v_upserted,
    'removed',v_removed,
    'snapshot_generated_at',v_generated_at,
    'refreshed_at',now()
  );
end;
$function$;

revoke all on function public.refresh_public_property_index() from public, anon, authenticated;
grant execute on function public.refresh_public_property_index() to service_role, postgres;

do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job
  where jobname='mercadoimobi-refresh-public-index'
  limit 1;

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    'mercadoimobi-refresh-public-index',
    '*/15 * * * *',
    $cron$select public.refresh_public_property_index();$cron$
  );
end $$;
