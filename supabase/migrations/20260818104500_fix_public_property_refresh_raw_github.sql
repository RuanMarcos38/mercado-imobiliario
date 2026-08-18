-- Fix the production public discovery refresh: GitHub contents API can rate-limit
-- unauthenticated database requests, while the raw cache is directly readable.
-- Also guard crawler numeric fields against malformed analytics/IDs being parsed as rooms.
create or replace function public.safe_small_property_integer(p_text text, p_max integer default 1000)
returns integer language sql immutable as $$
  select case when p_text ~ '^[0-9]+([.]0+)?$' and p_text::numeric between 0 and p_max
    then p_text::numeric::integer else null end
$$;

create or replace function public.refresh_public_property_index()
returns jsonb language plpgsql security definer set search_path to 'public','extensions' as $function$
declare
  v_payload jsonb; v_source_count integer:=0; v_staged integer:=0;
  v_upserted integer:=0; v_removed integer:=0; v_generated_at text; v_url text;
begin
  v_url := 'https://raw.githubusercontent.com/RuanMarcos38/mercado-imobiliario/public-data-cache/public-properties.json?ts=' || floor(extract(epoch from clock_timestamp()))::bigint::text;
  select ((extensions.http_get(v_url)).content)::jsonb into v_payload;
  if v_payload is null or jsonb_typeof(v_payload->'items') <> 'array' then
    raise exception 'Public property snapshot is invalid';
  end if;
  select count(*) into v_source_count from jsonb_object_keys(coalesce(v_payload->'sources','{}'::jsonb));
  v_generated_at := v_payload->>'generated_at';

  create temporary table tmp_public_property_refresh on commit drop as
  select item->>'title' title, nullif(item->>'description','') description,
    case when nullif(item->>'price','')::numeric >= 10000 then nullif(item->>'price','')::numeric else null::numeric end price,
    nullif(item->>'location_city','') location_city, nullif(item->>'location_state','') location_state,
    nullif(item->>'location_address','') location_address, nullif(item->>'property_type','') property_type,
    public.safe_small_property_integer(item->>'bedrooms',100) bedrooms,
    public.safe_small_property_integer(item->>'bathrooms',100) bathrooms,
    case when nullif(item->>'area_sqm','')::numeric between 1 and 10000000 then nullif(item->>'area_sqm','')::numeric else null::numeric end area_sqm,
    case when jsonb_typeof(item->'images')='array' then array(select jsonb_array_elements_text(item->'images')) else null::text[] end images,
    item->>'source_url' source_url,
    coalesce(nullif(item->>'source_portal',''),nullif(item->>'source_code',''),'Descoberta pública') source_portal,
    0.80::numeric anti_fraud_score, coalesce((item->>'is_verified')::boolean,false) is_verified,
    coalesce(nullif(item->'metadata'->>'checked_at','')::timestamptz,nullif(v_generated_at,'')::timestamptz,now()) scanned_at,
    coalesce(item->'metadata','{}'::jsonb)||jsonb_build_object('public_discovery',true,'source_code',item->>'source_code') metadata,
    'market'::text listing_market,false is_auction,null::text sale_mode,
    nullif(item->>'source_property_id','') source_property_id,nullif(item->>'contact_name','') contact_name,
    nullif(item->>'contact_phone','') contact_phone,nullif(item->>'contact_whatsapp','') contact_whatsapp,
    nullif(item->>'contact_email','') contact_email,now() last_seen_at
  from jsonb_array_elements(v_payload->'items') item
  where nullif(item->>'source_url','') is not null and nullif(item->>'title','') is not null;
  select count(*) into v_staged from tmp_public_property_refresh;

  insert into public.property_search_index(title,description,price,location_city,location_state,location_address,property_type,bedrooms,bathrooms,area_sqm,images,source_url,source_portal,anti_fraud_score,is_verified,scanned_at,metadata,listing_market,is_auction,sale_mode,source_property_id,contact_name,contact_phone,contact_whatsapp,contact_email,first_seen_at,last_seen_at)
  select title,description,price,location_city,location_state,location_address,property_type,bedrooms,bathrooms,area_sqm,images,source_url,source_portal,anti_fraud_score,is_verified,scanned_at,metadata,listing_market,is_auction,sale_mode,source_property_id,contact_name,contact_phone,contact_whatsapp,contact_email,now(),last_seen_at from tmp_public_property_refresh
  on conflict(source_url) do update set title=excluded.title,description=excluded.description,price=excluded.price,
    location_city=coalesce(excluded.location_city,property_search_index.location_city),location_state=coalesce(excluded.location_state,property_search_index.location_state),location_address=coalesce(excluded.location_address,property_search_index.location_address),property_type=coalesce(excluded.property_type,property_search_index.property_type),bedrooms=coalesce(excluded.bedrooms,property_search_index.bedrooms),bathrooms=coalesce(excluded.bathrooms,property_search_index.bathrooms),area_sqm=coalesce(excluded.area_sqm,property_search_index.area_sqm),images=case when coalesce(array_length(excluded.images,1),0)>0 then excluded.images else property_search_index.images end,source_portal=excluded.source_portal,anti_fraud_score=greatest(property_search_index.anti_fraud_score,excluded.anti_fraud_score),is_verified=property_search_index.is_verified or excluded.is_verified,scanned_at=excluded.scanned_at,metadata=property_search_index.metadata||excluded.metadata,listing_market='market',is_auction=false,source_property_id=coalesce(excluded.source_property_id,property_search_index.source_property_id),contact_name=coalesce(excluded.contact_name,property_search_index.contact_name),contact_phone=coalesce(excluded.contact_phone,property_search_index.contact_phone),contact_whatsapp=coalesce(excluded.contact_whatsapp,property_search_index.contact_whatsapp),contact_email=coalesce(excluded.contact_email,property_search_index.contact_email),last_seen_at=excluded.last_seen_at;
  get diagnostics v_upserted=row_count;
  delete from public.property_search_index target where target.listing_market='market' and coalesce(target.metadata->>'public_discovery','false')='true' and not exists(select 1 from tmp_public_property_refresh staged where staged.source_url=target.source_url);
  get diagnostics v_removed=row_count;
  return jsonb_build_object('ok',true,'sources',v_source_count,'staged',v_staged,'upserted',v_upserted,'removed',v_removed,'snapshot_generated_at',v_generated_at,'refreshed_at',now());
end;$function$;
revoke all on function public.refresh_public_property_index() from public,anon,authenticated;
grant execute on function public.refresh_public_property_index() to service_role,postgres;
