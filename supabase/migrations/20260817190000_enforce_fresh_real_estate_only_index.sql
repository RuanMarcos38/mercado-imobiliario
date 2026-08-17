create or replace function public.property_listing_is_real_estate(
  p_source_url text,
  p_title text,
  p_description text,
  p_property_type text
) returns boolean
language sql
immutable
as $$
  select
    coalesce(p_source_url, '') ~* '^https://(venda-imoveis\.caixa\.gov\.br|([a-z0-9-]+\.)?zapimoveis\.com\.br|([a-z0-9-]+\.)?vivareal\.com\.br|([a-z0-9-]+\.)?olx\.com\.br|([a-z0-9-]+\.)?imovelweb\.com\.br|([a-z0-9-]+\.)?quintoandar\.com\.br|([a-z0-9-]+\.)?chavesnamao\.com\.br|([a-z0-9-]+\.)?netimoveis\.com|([a-z0-9-]+\.)?orulo\.com\.br|([a-z0-9-]+\.)?mrv\.com\.br|([a-z0-9-]+\.)?rogga\.com\.br|([a-z0-9-]+\.)?rottasconstrutora\.com\.br|([a-z0-9-]+\.)?inicioempreendimentos\.com\.br)/'
    and (
      nullif(trim(coalesce(p_property_type, '')), '') is not null
      or concat_ws(' ', p_title, p_description) ~* '(im[oó]vel|apartamento|casa|terreno|lote|sobrado|kitnet|studio|loft|cobertura|ch[aá]cara|s[ií]tio|fazenda|galp[aã]o|sala comercial|loja|pr[eé]dio|condom[ií]nio)'
    );
$$;

create index if not exists idx_property_search_last_seen
  on public.property_search_index(last_seen_at desc);

alter table public.property_search_index enable row level security;

drop policy if exists "authenticated read property search index" on public.property_search_index;
drop policy if exists "authenticated read fresh real estate index" on public.property_search_index;
create policy "authenticated read fresh real estate index"
on public.property_search_index
for select
to authenticated
using (
  last_seen_at is not null
  and last_seen_at >= now() - interval '2 hours'
  and public.property_listing_is_real_estate(source_url, title, description, property_type)
);

create or replace function public.search_index_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'count', count(*) filter (
      where last_seen_at >= now() - interval '2 hours'
        and public.property_listing_is_real_estate(source_url, title, description, property_type)
    ),
    'states', count(distinct upper(location_state)) filter (
      where location_state is not null
        and last_seen_at >= now() - interval '2 hours'
        and public.property_listing_is_real_estate(source_url, title, description, property_type)
    ),
    'latest_update', max(last_seen_at),
    'stale_count', count(*) filter (where last_seen_at is null or last_seen_at < now() - interval '2 hours'),
    'non_property_count', count(*) filter (
      where not public.property_listing_is_real_estate(source_url, title, description, property_type)
    ),
    'freshness_sla_minutes', 120
  )
  from public.property_search_index;
$$;

grant execute on function public.property_listing_is_real_estate(text,text,text,text) to authenticated, service_role;
grant execute on function public.search_index_health() to anon, authenticated, service_role;
