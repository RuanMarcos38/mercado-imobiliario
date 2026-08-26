create table if not exists public.property_rejected_listings (
  fingerprint text primary key,
  original_id uuid,
  source_url text,
  source_portal text,
  title text,
  property_type text,
  rejection_reason text not null,
  snapshot jsonb not null default '{}'::jsonb,
  first_rejected_at timestamptz not null default now(),
  last_rejected_at timestamptz not null default now(),
  rejection_count integer not null default 1
);

alter table public.property_rejected_listings enable row level security;

create index if not exists idx_property_rejected_last_rejected_at
  on public.property_rejected_listings(last_rejected_at desc);
create index if not exists idx_property_rejected_source_portal
  on public.property_rejected_listings(source_portal);

create or replace function public.is_residential_sale_listing(
  p_title text,
  p_description text,
  p_price numeric,
  p_location_city text,
  p_location_address text,
  p_property_type text,
  p_source_url text,
  p_listing_market text,
  p_is_auction boolean,
  p_sale_mode text
) returns boolean
language sql
immutable
as $$
  select
    coalesce(p_price, 0) > 0
    and (nullif(btrim(p_location_city), '') is not null or nullif(btrim(p_location_address), '') is not null)
    and nullif(btrim(p_source_url), '') is not null
    and (
      lower(coalesce(p_property_type, '')) ~ '(casa|apartamento|apto|sobrado|studio|kitnet|loft|cobertura|duplex|triplex)'
      or (
        nullif(btrim(p_property_type), '') is null
        and lower(coalesce(p_title, '')) ~ '(casa|apartamento|apto|sobrado|studio|kitnet|loft|cobertura|duplex|triplex)'
      )
    )
    and (
      p_listing_market = 'caixa'
      or coalesce(p_is_auction, false)
      or lower(concat_ws(' ', p_title, p_description, p_sale_mode, p_source_url)) ~ '(venda|à venda|a venda|comprar|compre|vende[- ]?se)'
    );
$$;

create or replace function public.residential_sale_rejection_reason(
  p_title text,
  p_description text,
  p_price numeric,
  p_location_city text,
  p_location_address text,
  p_property_type text,
  p_source_url text,
  p_listing_market text,
  p_is_auction boolean,
  p_sale_mode text
) returns text
language plpgsql
immutable
as $$
begin
  if coalesce(p_price, 0) <= 0 then return 'missing_price'; end if;
  if nullif(btrim(p_location_city), '') is null and nullif(btrim(p_location_address), '') is null then return 'missing_location'; end if;
  if nullif(btrim(p_source_url), '') is null then return 'missing_source_url'; end if;
  if not (
    lower(coalesce(p_property_type, '')) ~ '(casa|apartamento|apto|sobrado|studio|kitnet|loft|cobertura|duplex|triplex)'
    or (
      nullif(btrim(p_property_type), '') is null
      and lower(coalesce(p_title, '')) ~ '(casa|apartamento|apto|sobrado|studio|kitnet|loft|cobertura|duplex|triplex)'
    )
  ) then return 'non_residential_property_type'; end if;
  if not (
    p_listing_market = 'caixa'
    or coalesce(p_is_auction, false)
    or lower(concat_ws(' ', p_title, p_description, p_sale_mode, p_source_url)) ~ '(venda|à venda|a venda|comprar|compre|vende[- ]?se)'
  ) then return 'no_sale_intent'; end if;
  return 'not_qualified';
end;
$$;

insert into public.property_rejected_listings (
  fingerprint, original_id, source_url, source_portal, title, property_type,
  rejection_reason, snapshot, first_rejected_at, last_rejected_at, rejection_count
)
select
  md5(coalesce(source_url, '') || '|' || coalesce(title, '') || '|' || coalesce(source_portal, '')),
  id,
  source_url,
  source_portal,
  title,
  property_type,
  public.residential_sale_rejection_reason(
    title, description, price, location_city, location_address, property_type,
    source_url, listing_market, is_auction, sale_mode
  ),
  to_jsonb(property_search_index),
  now(),
  now(),
  1
from public.property_search_index
where not public.is_residential_sale_listing(
  title, description, price, location_city, location_address, property_type,
  source_url, listing_market, is_auction, sale_mode
)
on conflict (fingerprint) do update set
  original_id = excluded.original_id,
  source_url = excluded.source_url,
  source_portal = excluded.source_portal,
  title = excluded.title,
  property_type = excluded.property_type,
  rejection_reason = excluded.rejection_reason,
  snapshot = excluded.snapshot,
  last_rejected_at = now(),
  rejection_count = public.property_rejected_listings.rejection_count + 1;

delete from public.property_search_index
where not public.is_residential_sale_listing(
  title, description, price, location_city, location_address, property_type,
  source_url, listing_market, is_auction, sale_mode
);

create or replace function public.guard_property_search_index_residential_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fingerprint text;
  v_reason text;
begin
  if public.is_residential_sale_listing(
    new.title, new.description, new.price, new.location_city, new.location_address,
    new.property_type, new.source_url, new.listing_market, new.is_auction, new.sale_mode
  ) then
    return new;
  end if;

  v_fingerprint := md5(coalesce(new.source_url, '') || '|' || coalesce(new.title, '') || '|' || coalesce(new.source_portal, ''));
  v_reason := public.residential_sale_rejection_reason(
    new.title, new.description, new.price, new.location_city, new.location_address,
    new.property_type, new.source_url, new.listing_market, new.is_auction, new.sale_mode
  );

  insert into public.property_rejected_listings (
    fingerprint, original_id, source_url, source_portal, title, property_type,
    rejection_reason, snapshot, first_rejected_at, last_rejected_at, rejection_count
  ) values (
    v_fingerprint,
    new.id,
    new.source_url,
    new.source_portal,
    new.title,
    new.property_type,
    v_reason,
    to_jsonb(new),
    now(),
    now(),
    1
  )
  on conflict (fingerprint) do update set
    original_id = excluded.original_id,
    source_url = excluded.source_url,
    source_portal = excluded.source_portal,
    title = excluded.title,
    property_type = excluded.property_type,
    rejection_reason = excluded.rejection_reason,
    snapshot = excluded.snapshot,
    last_rejected_at = now(),
    rejection_count = public.property_rejected_listings.rejection_count + 1;

  return null;
end;
$$;

drop trigger if exists trg_property_search_index_residential_sale on public.property_search_index;
create trigger trg_property_search_index_residential_sale
before insert or update on public.property_search_index
for each row execute function public.guard_property_search_index_residential_sale();

comment on function public.is_residential_sale_listing(text,text,numeric,text,text,text,text,text,boolean,text)
is 'Business rule: only genuine residential sale listings are allowed in the searchable index.';
comment on table public.property_rejected_listings
is 'Internal quarantine for records rejected by the residential-sale quality rule; not shown in the platform.';
