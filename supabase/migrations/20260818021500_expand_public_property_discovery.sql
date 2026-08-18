-- Expand public property discovery without changing the application layout.
-- Public sources remain subject to real-estate classification and freshness rules.

update public.property_source_catalog
set name='Direcional',
    website_domain='direcional.com.br',
    notes='Descoberta pública de imóveis e empreendimentos no site comercial oficial da Direcional.',
    public_discovery_enabled=true,
    updated_at=now()
where code='direcional';

insert into public.property_source_catalog(
  code,name,category,integration_mode,status,website_domain,
  supports_contacts,supports_updates,notes,public_discovery_enabled,
  public_discovery_mode,official_integration_optional,public_discovery_status,
  public_discovery_count,created_at,updated_at
)
values(
  'riva','Riva Incorporadora','builder','public_discovery_or_feed','ready',
  'rivaincorporadora.com.br',true,true,
  'Descoberta pública de imóveis e empreendimentos Riva.',true,'hybrid',true,
  'ready',0,now(),now()
)
on conflict(code) do update
set name=excluded.name,
    website_domain=excluded.website_domain,
    public_discovery_enabled=true,
    updated_at=now();

create or replace function public.property_listing_is_real_estate(
  p_source_url text,
  p_title text,
  p_description text,
  p_property_type text
)
returns boolean
language sql
immutable
as $function$
  select
    coalesce(p_source_url, '') ~* '^https://(venda-imoveis\.caixa\.gov\.br|([a-z0-9-]+\.)?zapimoveis\.com\.br|([a-z0-9-]+\.)?vivareal\.com\.br|([a-z0-9-]+\.)?olx\.com\.br|([a-z0-9-]+\.)?imovelweb\.com\.br|([a-z0-9-]+\.)?quintoandar\.com\.br|([a-z0-9-]+\.)?chavesnamao\.com\.br|([a-z0-9-]+\.)?netimoveis\.com|([a-z0-9-]+\.)?orulo\.com\.br|([a-z0-9-]+\.)?mrv\.com\.br|([a-z0-9-]+\.)?rogga\.com\.br|([a-z0-9-]+\.)?rottasconstrutora\.com\.br|([a-z0-9-]+\.)?inicioempreendimentos\.com\.br|([a-z0-9-]+\.)?ayoshii\.com\.br|([a-z0-9-]+\.)?tenda\.com\.br|([a-z0-9-]+\.)?curyconstrutora\.com\.br|([a-z0-9-]+\.)?cyrela\.com\.br|([a-z0-9-]+\.)?even\.com\.br|([a-z0-9-]+\.)?eztec\.com\.br|([a-z0-9-]+\.)?gafisa\.com\.br|([a-z0-9-]+\.)?grupodirecional\.com|([a-z0-9-]+\.)?direcional\.com\.br|([a-z0-9-]+\.)?rivaincorporadora\.com\.br|([a-z0-9-]+\.)?helbor\.com\.br|([a-z0-9-]+\.)?mouradubeux\.com\.br|([a-z0-9-]+\.)?patrimar\.com\.br|([a-z0-9-]+\.)?plaenge\.com\.br|([a-z0-9-]+\.)?planoeplano\.com\.br|([a-z0-9-]+\.)?canalpro\.grupozap\.com)/'
    and (
      nullif(trim(coalesce(p_property_type, '')), '') is not null
      or concat_ws(' ', p_title, p_description) ~* '(im[oó]vel|apartamento|casa|terreno|lote|sobrado|kitnet|studio|loft|cobertura|ch[aá]cara|s[ií]tio|fazenda|galp[aã]o|sala comercial|loja|pr[eé]dio|condom[ií]nio|empreendimento)'
    );
$function$;

drop policy if exists "authenticated read fresh real estate index"
  on public.property_search_index;

create policy "authenticated read fresh real estate index"
on public.property_search_index
for select
to authenticated
using (
  last_seen_at is not null
  and last_seen_at >= now() - interval '2 hours'
  and public.property_listing_is_real_estate(source_url,title,description,property_type)
);

create or replace function public.property_region_search_health(
  p_city text,
  p_state text default null
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with eligible as (
    select *
    from public.property_search_index
    where last_seen_at >= now() - interval '2 hours'
      and public.property_listing_is_real_estate(source_url,title,description,property_type)
      and (
        coalesce(location_city,'') ilike '%' || p_city || '%'
        or coalesce(location_address,'') ilike '%' || p_city || '%'
        or coalesce(title,'') ilike '%' || p_city || '%'
      )
      and (p_state is null or location_state is null or upper(location_state)=upper(p_state))
  )
  select jsonb_build_object(
    'city',p_city,
    'state',p_state,
    'total',count(*),
    'market',count(*) filter(where listing_market <> 'caixa'),
    'caixa',count(*) filter(where listing_market='caixa'),
    'sources',count(distinct source_portal),
    'market_sources',coalesce(
      jsonb_agg(distinct source_portal) filter(where listing_market <> 'caixa'),
      '[]'::jsonb
    )
  ) from eligible;
$function$;

select cron.schedule(
  'mercadoimobi-refresh-public-index',
  '*/5 * * * *',
  $$select public.refresh_public_property_index(); select public.refresh_public_property_source_catalog();$$
);
