-- Keep CAIXA classification consistent on every hourly refresh.
create or replace function public.refresh_caixa_property_index()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_payload jsonb;
  v_source_count integer;
  v_staged integer;
  v_upserted integer;
  v_removed integer;
  v_generated_at text;
begin
  select ((extensions.http_get('https://raw.githubusercontent.com/RuanMarcos38/mercado-imobiliario/data-cache/caixa-properties.json')).content)::jsonb into v_payload;
  if v_payload is null or jsonb_typeof(v_payload->'items') <> 'array' then raise exception 'CAIXA snapshot is invalid'; end if;
  v_source_count := jsonb_array_length(v_payload->'items');
  v_generated_at := v_payload->>'generated_at';
  if v_source_count < 1000 then raise exception 'CAIXA snapshot is unexpectedly small: %', v_source_count; end if;

  create temporary table tmp_caixa_refresh on commit drop as
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
      when jsonb_typeof(item->'images')='array' and jsonb_array_length(item->'images')>0
        then array(select jsonb_array_elements_text(item->'images'))
      when nullif(item->'metadata'->>'official_id','') is not null
        then array['https://venda-imoveis.caixa.gov.br/fotos/F'||(item->'metadata'->>'official_id')||'21.jpg']::text[]
      else null::text[]
    end as images,
    item->>'source_url' as source_url,
    coalesce(nullif(item->>'source_portal',''),'Imóveis CAIXA') as source_portal,
    1.0::numeric as anti_fraud_score,
    true as is_verified,
    coalesce(nullif(item->>'scanned_at','')::timestamptz,now()) as scanned_at,
    coalesce(item->'metadata','{}'::jsonb) as metadata,
    'caixa'::text as listing_market,
    case when lower(coalesce(item->'metadata'->>'sale_mode','')) like '%leil%' then true else false end as is_auction,
    nullif(item->'metadata'->>'sale_mode','') as sale_mode,
    nullif(item->'metadata'->>'official_id','') as source_property_id,
    now() as last_seen_at
  from jsonb_array_elements(v_payload->'items') as item
  where item->>'source_url' like 'https://venda-imoveis.caixa.gov.br/%';

  select count(*) into v_staged from tmp_caixa_refresh;
  if v_staged < 1000 then raise exception 'CAIXA normalized snapshot is unexpectedly small: %', v_staged; end if;

  insert into public.property_search_index (
    title,description,price,location_city,location_state,location_address,
    property_type,bedrooms,bathrooms,area_sqm,images,source_url,source_portal,
    anti_fraud_score,is_verified,scanned_at,metadata,listing_market,is_auction,
    sale_mode,source_property_id,first_seen_at,last_seen_at
  )
  select
    title,description,price,location_city,location_state,location_address,
    property_type,bedrooms,bathrooms,area_sqm,images,source_url,source_portal,
    anti_fraud_score,is_verified,scanned_at,metadata,listing_market,is_auction,
    sale_mode,source_property_id,now(),last_seen_at
  from tmp_caixa_refresh
  on conflict (source_url) do update set
    title=excluded.title,
    description=excluded.description,
    price=excluded.price,
    location_city=excluded.location_city,
    location_state=excluded.location_state,
    location_address=excluded.location_address,
    property_type=excluded.property_type,
    bedrooms=excluded.bedrooms,
    bathrooms=excluded.bathrooms,
    area_sqm=excluded.area_sqm,
    images=excluded.images,
    source_portal=excluded.source_portal,
    anti_fraud_score=excluded.anti_fraud_score,
    is_verified=excluded.is_verified,
    scanned_at=excluded.scanned_at,
    metadata=excluded.metadata,
    listing_market='caixa',
    is_auction=excluded.is_auction,
    sale_mode=excluded.sale_mode,
    source_property_id=excluded.source_property_id,
    last_seen_at=excluded.last_seen_at;
  get diagnostics v_upserted = row_count;

  delete from public.property_search_index target
  where target.listing_market='caixa'
    and not exists(select 1 from tmp_caixa_refresh staged where staged.source_url=target.source_url);
  get diagnostics v_removed = row_count;

  return jsonb_build_object(
    'ok',true,
    'source_count',v_source_count,
    'staged',v_staged,
    'upserted',v_upserted,
    'removed',v_removed,
    'snapshot_generated_at',v_generated_at,
    'refreshed_at',now()
  );
end;
$$;

revoke all on function public.refresh_caixa_property_index() from public, anon, authenticated;
