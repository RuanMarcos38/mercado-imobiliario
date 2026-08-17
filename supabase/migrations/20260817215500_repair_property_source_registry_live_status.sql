create table if not exists public.property_source_catalog (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
  category text not null check(category in ('official','portal','builder','network','discovery','agency_feed')),
  integration_mode text not null,
  status text not null default 'ready' check(status in ('active','ready','authorization_required','planned','paused')),
  website_domain text, supports_contacts boolean not null default false, supports_updates boolean not null default true,
  notes text, public_discovery_enabled boolean not null default false,
  public_discovery_mode text not null default 'disabled' check(public_discovery_mode in ('disabled','sitemap','web_search','hybrid')),
  official_integration_optional boolean not null default true,
  public_discovery_status text not null default 'idle' check(public_discovery_status in ('idle','ready','running','active','limited','blocked','error')),
  public_discovery_count integer not null default 0, last_public_discovery_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.property_source_catalog enable row level security;
drop policy if exists property_source_catalog_read on public.property_source_catalog;
create policy property_source_catalog_read on public.property_source_catalog for select to authenticated using(true);
grant select on public.property_source_catalog to authenticated;

create table if not exists public.property_source_connections (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_code text not null references public.property_source_catalog(code) on delete cascade, name text,
  status text not null default 'disconnected' check(status in ('disconnected','pending','connected','error','paused')),
  connection_type text, public_config jsonb not null default '{}'::jsonb, last_sync_at timestamptz,
  last_success_at timestamptz, last_error text, created_by uuid, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique(tenant_id,source_code,name)
);
alter table public.property_source_connections enable row level security;
drop policy if exists property_source_connections_select on public.property_source_connections;
create policy property_source_connections_select on public.property_source_connections for select to authenticated using(exists(select 1 from public.tenant_members tm where tm.tenant_id=property_source_connections.tenant_id and tm.user_id=auth.uid()));
drop policy if exists property_source_connections_insert on public.property_source_connections;
create policy property_source_connections_insert on public.property_source_connections for insert to authenticated with check(exists(select 1 from public.tenant_members tm where tm.tenant_id=property_source_connections.tenant_id and tm.user_id=auth.uid()));
drop policy if exists property_source_connections_update on public.property_source_connections;
create policy property_source_connections_update on public.property_source_connections for update to authenticated using(exists(select 1 from public.tenant_members tm where tm.tenant_id=property_source_connections.tenant_id and tm.user_id=auth.uid())) with check(exists(select 1 from public.tenant_members tm where tm.tenant_id=property_source_connections.tenant_id and tm.user_id=auth.uid()));
drop policy if exists property_source_connections_delete on public.property_source_connections;
create policy property_source_connections_delete on public.property_source_connections for delete to authenticated using(exists(select 1 from public.tenant_members tm where tm.tenant_id=property_source_connections.tenant_id and tm.user_id=auth.uid()));
grant select,insert,update,delete on public.property_source_connections to authenticated;

create table if not exists public.property_scan_runs (
  id uuid primary key default gen_random_uuid(), source_code text references public.property_source_catalog(code) on delete set null,
  connection_id uuid references public.property_source_connections(id) on delete set null,
  status text not null default 'queued' check(status in ('queued','running','success','partial','failed')),
  discovered_count integer not null default 0, inserted_count integer not null default 0, updated_count integer not null default 0,
  removed_count integer not null default 0, error_summary text, started_at timestamptz, finished_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.property_scan_runs enable row level security;
drop policy if exists property_scan_runs_read on public.property_scan_runs;
create policy property_scan_runs_read on public.property_scan_runs for select to authenticated using(true);
grant select on public.property_scan_runs to authenticated;

create table if not exists public.property_discovered_domains (
  id uuid primary key default gen_random_uuid(), domain text not null unique, business_name text, city text, state text,
  discovery_source text, status text not null default 'candidate' check(status in ('candidate','authorized','indexed','blocked','inactive')),
  feed_url text, last_checked_at timestamptz, last_property_seen_at timestamptz, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.property_discovered_domains enable row level security;
drop policy if exists property_discovered_domains_read on public.property_discovered_domains;
create policy property_discovered_domains_read on public.property_discovered_domains for select to authenticated using(true);
grant select on public.property_discovered_domains to authenticated;

insert into public.property_source_catalog(code,name,category,integration_mode,status,website_domain,supports_contacts,supports_updates,notes,public_discovery_enabled,public_discovery_mode,official_integration_optional,public_discovery_status) values
('caixa','CAIXA Imóveis','official','official_csv','active','venda-imoveis.caixa.gov.br',false,true,'Fonte oficial CAIXA integrada.',false,'disabled',false,'active'),
('zap','ZAP Imóveis','portal','public_discovery_or_authorized_feed','ready','zapimoveis.com.br',true,true,'Descoberta pública e feed/XML autorizado opcional.',true,'hybrid',true,'ready'),
('vivareal','Viva Real','portal','public_discovery_or_authorized_feed','ready','vivareal.com.br',true,true,'Descoberta pública e feed autorizado opcional.',true,'hybrid',true,'ready'),
('olx','OLX Imóveis','portal','public_discovery_or_official_api','ready','olx.com.br',true,true,'Descoberta pública apenas em áreas permitidas; API oficial opcional.',true,'hybrid',true,'ready'),
('imovelweb','Imovelweb','portal','public_discovery_or_partner_feed','ready','imovelweb.com.br',true,true,'Descoberta pública e parceria/feed autorizado opcional.',true,'hybrid',true,'ready'),
('quintoandar','QuintoAndar','portal','public_discovery_or_partner','active','quintoandar.com.br',true,true,'Descoberta pública ativa.',true,'hybrid',true,'active'),
('chavesnamao','Chaves na Mão','portal','public_discovery_or_xml','ready','chavesnamao.com.br',true,true,'Descoberta pública com filtro imobiliário.',true,'hybrid',true,'ready'),
('netimoveis','Netimóveis','network','public_discovery_or_partner','ready','netimoveis.com',true,true,'Descoberta pública e parceria autorizada opcional.',true,'hybrid',true,'ready'),
('orulo','Órulo','portal','public_discovery_or_api','ready','orulo.com.br',true,true,'Descoberta pública e API oficial opcional.',true,'hybrid',true,'ready'),
('mrv','MRV','builder','public_discovery_or_feed','active','mrv.com.br',true,true,'Descoberta pública de imóveis e empreendimentos.',true,'hybrid',true,'active'),
('rogga','Rogga','builder','public_discovery_or_feed','active','rogga.com.br',true,true,'Descoberta pública de empreendimentos.',true,'hybrid',true,'active'),
('rottas','Rottas','builder','public_discovery_or_feed','ready','rottasconstrutora.com.br',true,true,'Descoberta pública de empreendimentos.',true,'hybrid',true,'ready'),
('inicio','Início Empreendimentos','builder','public_discovery_or_feed','ready','inicioempreendimentos.com.br',true,true,'Descoberta pública de empreendimentos.',true,'hybrid',true,'ready'),
('cyrela','Cyrela','builder','public_discovery_or_feed','active','cyrela.com.br',true,true,'Descoberta pública de empreendimentos.',true,'hybrid',true,'active'),
('cury','Cury Construtora','builder','public_discovery_or_feed','ready','curyconstrutora.com.br',true,true,'Descoberta pública de empreendimentos.',true,'hybrid',true,'ready'),
('tenda','Construtora Tenda','builder','public_discovery_or_feed','ready','tenda.com.br',true,true,'Descoberta pública de imóveis e empreendimentos.',true,'hybrid',true,'ready'),
('eztec','EZTEC','builder','public_discovery_or_feed','ready','eztec.com.br',true,true,'Descoberta pública de empreendimentos.',true,'hybrid',true,'ready'),
('planoeplano','Plano&Plano','builder','public_discovery_or_feed','active','planoeplano.com.br',true,true,'Descoberta pública de empreendimentos.',true,'hybrid',true,'active'),
('mouradubeux','Moura Dubeux','builder','public_discovery_or_feed','ready','mouradubeux.com.br',true,true,'Descoberta pública de empreendimentos.',true,'hybrid',true,'ready'),
('even','Even','builder','public_discovery_or_feed','active','even.com.br',true,true,'Descoberta pública de empreendimentos.',true,'hybrid',true,'active'),
('ayoshii','A.Yoshii','builder','public_discovery_or_feed','active','ayoshii.com.br',true,true,'Descoberta pública de empreendimentos.',true,'hybrid',true,'active'),
('direcional','Grupo Direcional','builder','public_discovery_or_feed','ready','grupodirecional.com',true,true,'Descoberta pública de imóveis e empreendimentos.',true,'hybrid',true,'ready'),
('agency_feeds','Imobiliárias Independentes','agency_feed','xml_json_api_feed','ready',null,true,true,'Feeds XML/JSON/API autorizados de imobiliárias brasileiras.',true,'web_search',true,'ready')
on conflict(code) do update set name=excluded.name,category=excluded.category,integration_mode=excluded.integration_mode,status=excluded.status,website_domain=excluded.website_domain,supports_contacts=excluded.supports_contacts,supports_updates=excluded.supports_updates,notes=excluded.notes,public_discovery_enabled=excluded.public_discovery_enabled,public_discovery_mode=excluded.public_discovery_mode,official_integration_optional=excluded.official_integration_optional,updated_at=now();

create or replace function public.refresh_public_property_source_catalog()
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $function$
declare v_api jsonb;v_payload jsonb;v_url text;v_source record;v_code text;v_status text;v_found integer;v_checked_at timestamptz;v_updated integer:=0;
begin
  v_url:='https://api.github.com/repos/RuanMarcos38/mercado-imobiliario/contents/public-properties.json?ref=public-data-cache&ts='||floor(extract(epoch from clock_timestamp()))::bigint::text;
  select ((extensions.http_get(v_url)).content)::jsonb into v_api;
  if v_api is null or nullif(v_api->>'content','') is null then raise exception 'Public source catalog GitHub payload is invalid'; end if;
  v_payload:=convert_from(decode(replace(v_api->>'content',E'\n',''),'base64'),'UTF8')::jsonb;
  for v_source in select key,value from jsonb_each(coalesce(v_payload->'sources','{}'::jsonb)) loop
    v_code:=v_source.key;v_status:=coalesce(nullif(v_source.value->>'status',''),'error');
    if v_status not in ('active','limited','blocked','error') then v_status:='ready'; end if;
    v_found:=coalesce(nullif(v_source.value->>'found_count','')::integer,0);v_checked_at:=nullif(v_source.value->>'checked_at','')::timestamptz;
    update public.property_source_catalog set public_discovery_status=v_status,public_discovery_count=v_found,last_public_discovery_at=v_checked_at,status=case when v_status='active' then 'active' else 'ready' end,updated_at=now() where code=v_code;
    if found then v_updated:=v_updated+1;end if;
  end loop;
  update public.property_source_catalog c set public_discovery_count=x.cnt,last_public_discovery_at=coalesce(x.last_seen,c.last_public_discovery_at),status='active',public_discovery_status='active',updated_at=now()
  from (select metadata->>'source_code' code,count(*)::integer cnt,max(last_seen_at) last_seen from public.property_search_index where coalesce(metadata->>'public_discovery','false')='true' group by metadata->>'source_code') x where c.code=x.code;
  update public.property_source_catalog set public_discovery_count=(select count(*)::integer from public.property_search_index where listing_market='caixa'),last_public_discovery_at=(select max(last_seen_at) from public.property_search_index where listing_market='caixa'),status='active',public_discovery_status='active',updated_at=now() where code='caixa';
  return jsonb_build_object('ok',true,'updated_sources',v_updated,'snapshot_generated_at',v_payload->>'generated_at','refreshed_at',now());
end;$function$;
revoke all on function public.refresh_public_property_source_catalog() from public,anon,authenticated;
grant execute on function public.refresh_public_property_source_catalog() to service_role,postgres;

do $$ declare v_jobid bigint; begin
  select jobid into v_jobid from cron.job where jobname='mercadoimobi-refresh-public-index' limit 1;
  if v_jobid is not null then perform cron.unschedule(v_jobid);end if;
  perform cron.schedule('mercadoimobi-refresh-public-index','*/15 * * * *',$cron$select public.refresh_public_property_index(); select public.refresh_public_property_source_catalog();$cron$);
end $$;
