create schema if not exists extensions;
create extension if not exists http with schema extensions;

create table if not exists public.property_search_index (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  price numeric,
  location_city text,
  location_state text,
  location_address text,
  property_type text,
  bedrooms integer,
  bathrooms integer,
  area_sqm numeric,
  images text[],
  source_url text not null unique,
  source_portal text,
  anti_fraud_score numeric,
  is_verified boolean default false,
  scanned_at timestamptz default now(),
  metadata jsonb default '{}'::jsonb,
  listing_market text default 'market',
  is_auction boolean default false,
  sale_mode text,
  source_property_id text,
  contact_name text,
  contact_phone text,
  contact_whatsapp text,
  contact_email text,
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now()
);

alter table public.property_search_index enable row level security;
drop policy if exists "public read property search index" on public.property_search_index;
create policy "public read property search index"
on public.property_search_index for select to anon, authenticated using (true);

create index if not exists idx_property_search_state on public.property_search_index(location_state);
create index if not exists idx_property_search_city on public.property_search_index(location_city);
create index if not exists idx_property_search_price on public.property_search_index(price);
create index if not exists idx_property_search_scanned on public.property_search_index(scanned_at desc);
create index if not exists idx_property_search_market on public.property_search_index(listing_market,is_auction);

create or replace function public.search_index_health()
returns jsonb
language sql
security definer
stable
set search_path=public
as $$
  select jsonb_build_object(
    'count', count(*),
    'states', count(distinct upper(location_state)) filter (where location_state is not null),
    'latest_update', max(scanned_at)
  ) from public.property_search_index;
$$;
revoke all on function public.search_index_health() from public;
grant execute on function public.search_index_health() to anon, authenticated;

create or replace function public.refresh_caixa_property_index()
returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_payload jsonb; v_source_count integer; v_staged integer; v_upserted integer; v_removed integer; v_generated_at text;
begin
  select ((extensions.http_get('https://raw.githubusercontent.com/RuanMarcos38/mercado-imobiliario/data-cache/caixa-properties.json')).content)::jsonb into v_payload;
  if v_payload is null or jsonb_typeof(v_payload->'items') <> 'array' then raise exception 'CAIXA snapshot is invalid'; end if;
  v_source_count := jsonb_array_length(v_payload->'items');
  v_generated_at := v_payload->>'generated_at';
  if v_source_count < 1000 then raise exception 'CAIXA snapshot is unexpectedly small: %', v_source_count; end if;
  create temporary table tmp_caixa_refresh on commit drop as
  select item->>'title' title, nullif(item->>'description','') description, nullif(item->>'price','')::numeric price,
    nullif(item->>'location_city','') location_city, nullif(item->>'location_state','') location_state,
    nullif(item->>'location_address','') location_address, nullif(item->>'property_type','') property_type,
    nullif(item->>'bedrooms','')::integer bedrooms, nullif(item->>'bathrooms','')::integer bathrooms,
    nullif(item->>'area_sqm','')::numeric area_sqm,
    case when jsonb_typeof(item->'images')='array' and jsonb_array_length(item->'images')>0 then array(select jsonb_array_elements_text(item->'images'))
      when nullif(item->'metadata'->>'official_id','') is not null then array['https://venda-imoveis.caixa.gov.br/fotos/F'||(item->'metadata'->>'official_id')||'21.jpg']::text[] else null::text[] end images,
    item->>'source_url' source_url, coalesce(nullif(item->>'source_portal',''),'Imóveis CAIXA') source_portal,
    1.0::numeric anti_fraud_score, true is_verified, coalesce(nullif(item->>'scanned_at','')::timestamptz,now()) scanned_at,
    coalesce(item->'metadata','{}'::jsonb) metadata, 'caixa'::text listing_market,
    case when lower(coalesce(item->'metadata'->>'sale_mode','')) like '%leil%' then true else false end is_auction,
    nullif(item->'metadata'->>'sale_mode','') sale_mode, nullif(item->'metadata'->>'official_id','') source_property_id, now() last_seen_at
  from jsonb_array_elements(v_payload->'items') item where item->>'source_url' like 'https://venda-imoveis.caixa.gov.br/%';
  select count(*) into v_staged from tmp_caixa_refresh;
  if v_staged < 1000 then raise exception 'CAIXA normalized snapshot is unexpectedly small: %', v_staged; end if;
  insert into public.property_search_index(title,description,price,location_city,location_state,location_address,property_type,bedrooms,bathrooms,area_sqm,images,source_url,source_portal,anti_fraud_score,is_verified,scanned_at,metadata,listing_market,is_auction,sale_mode,source_property_id,first_seen_at,last_seen_at)
  select title,description,price,location_city,location_state,location_address,property_type,bedrooms,bathrooms,area_sqm,images,source_url,source_portal,anti_fraud_score,is_verified,scanned_at,metadata,listing_market,is_auction,sale_mode,source_property_id,now(),last_seen_at from tmp_caixa_refresh
  on conflict(source_url) do update set title=excluded.title,description=excluded.description,price=excluded.price,location_city=excluded.location_city,location_state=excluded.location_state,location_address=excluded.location_address,property_type=excluded.property_type,bedrooms=excluded.bedrooms,bathrooms=excluded.bathrooms,area_sqm=excluded.area_sqm,images=excluded.images,source_portal=excluded.source_portal,anti_fraud_score=excluded.anti_fraud_score,is_verified=excluded.is_verified,scanned_at=excluded.scanned_at,metadata=excluded.metadata,listing_market='caixa',is_auction=excluded.is_auction,sale_mode=excluded.sale_mode,source_property_id=excluded.source_property_id,last_seen_at=excluded.last_seen_at;
  get diagnostics v_upserted=row_count;
  delete from public.property_search_index target where target.listing_market='caixa' and not exists(select 1 from tmp_caixa_refresh staged where staged.source_url=target.source_url);
  get diagnostics v_removed=row_count;
  return jsonb_build_object('ok',true,'source_count',v_source_count,'staged',v_staged,'upserted',v_upserted,'removed',v_removed,'snapshot_generated_at',v_generated_at,'refreshed_at',now());
end; $$;
revoke all on function public.refresh_caixa_property_index() from public,anon,authenticated;
grant execute on function public.refresh_caixa_property_index() to service_role,postgres;
