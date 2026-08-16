-- MercadoImobi: separation of CAIXA opportunities, national source registry,
-- contact fields, new-listing alerts and atendimento automation controls.

alter table public.property_search_index
  add column if not exists listing_market text not null default 'market',
  add column if not exists is_auction boolean not null default false,
  add column if not exists sale_mode text,
  add column if not exists contact_name text,
  add column if not exists contact_phone text,
  add column if not exists contact_whatsapp text,
  add column if not exists contact_email text,
  add column if not exists source_property_id text,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now();

update public.property_search_index
set listing_market = case when metadata->>'source'='caixa' then 'caixa' else coalesce(nullif(listing_market,''),'market') end,
    sale_mode = coalesce(sale_mode,metadata->>'sale_mode'),
    is_auction = case when lower(coalesce(metadata->>'sale_mode','')) like '%leil%' then true else coalesce(is_auction,false) end,
    source_property_id = coalesce(source_property_id,nullif(metadata->>'official_id','')),
    last_seen_at = greatest(coalesce(last_seen_at,scanned_at,now()),coalesce(scanned_at,now()));

create index if not exists property_search_market_idx on public.property_search_index(listing_market,is_auction);
create index if not exists property_search_last_seen_idx on public.property_search_index(last_seen_at desc);
create index if not exists property_search_contact_whatsapp_idx on public.property_search_index(contact_whatsapp) where contact_whatsapp is not null;

create table if not exists public.property_source_catalog (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
  category text not null check(category in ('official','portal','builder','network','discovery','agency_feed')),
  integration_mode text not null,
  status text not null default 'authorization_required' check(status in ('active','ready','authorization_required','planned','paused')),
  website_domain text, supports_contacts boolean not null default false,
  supports_updates boolean not null default false, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.property_source_catalog enable row level security;
drop policy if exists property_source_catalog_read on public.property_source_catalog;
create policy property_source_catalog_read on public.property_source_catalog for select to authenticated using(true);

insert into public.property_source_catalog(code,name,category,integration_mode,status,website_domain,supports_contacts,supports_updates,notes) values
('caixa','CAIXA Imóveis','official','official_csv','active','venda-imoveis.caixa.gov.br',false,true,'Fonte oficial já integrada; modalidades classificadas separadamente.'),
('olx','OLX Imóveis','portal','official_api_oauth','authorization_required','olx.com.br',true,true,'Integração somente pela API/OAuth oficial ou feed autorizado.'),
('zap','ZAP Imóveis','portal','authorized_xml_feed','authorization_required','zapimoveis.com.br',true,true,'Integração por XML/Canal Pro autorizado.'),
('vivareal','Viva Real','portal','authorized_xml_feed','authorization_required','vivareal.com.br',true,true,'Integração por Canal Pro/feed autorizado.'),
('imovelweb','Imovelweb','portal','authorized_feed_or_partner','authorization_required','imovelweb.com.br',true,true,'Conectar por feed/API/parceria autorizada.'),
('quintoandar','QuintoAndar','portal','authorized_partner','authorization_required','quintoandar.com.br',true,true,'Conectar somente por parceria/autorização.'),
('chavesnamao','Chaves na Mão','portal','authorized_xml_feed','authorization_required','chavesnamao.com.br',true,true,'Integração XML mediante contrato.'),
('netimoveis','Netimóveis','network','authorized_partner','authorization_required','netimoveis.com',true,true,'Conectar por parceria/feed autorizado.'),
('orulo','Órulo','portal','official_api_oauth','authorization_required','orulo.com.br',true,true,'API oficial mediante credenciais/contrato.'),
('mrv','MRV','builder','authorized_feed_or_discovery','authorization_required','mrv.com.br',true,true,'Conector para feed/API autorizado.'),
('rogga','Rogga','builder','authorized_feed_or_discovery','authorization_required','rogga.com.br',true,true,'Conector para feed/API autorizado.'),
('rottas','Rottas','builder','authorized_feed_or_discovery','authorization_required','rottasconstrutora.com.br',true,true,'Conector para feed/API autorizado.'),
('inicio','Início Empreendimentos','builder','authorized_feed_or_discovery','authorization_required',null,true,true,'Conector para feed/API autorizado.'),
('google_discovery','Descoberta Web','discovery','search_provider_api','authorization_required','google.com',false,true,'Descoberta de domínios via provedor de busca autorizado.'),
('agency_feeds','Imobiliárias Independentes','agency_feed','xml_json_api_feed','ready',null,true,true,'Feeds XML/JSON/API autorizados de imobiliárias brasileiras.')
on conflict(code) do update set name=excluded.name,category=excluded.category,integration_mode=excluded.integration_mode,
website_domain=excluded.website_domain,supports_contacts=excluded.supports_contacts,supports_updates=excluded.supports_updates,
notes=excluded.notes,updated_at=now();

create table if not exists public.property_source_connections (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_code text not null references public.property_source_catalog(code) on delete cascade, name text,
  status text not null default 'disconnected' check(status in ('disconnected','pending','connected','error','paused')),
  connection_type text, public_config jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,last_success_at timestamptz,last_error text,created_by uuid,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(tenant_id,source_code,name)
);
alter table public.property_source_connections enable row level security;
drop policy if exists property_source_connections_select on public.property_source_connections;
create policy property_source_connections_select on public.property_source_connections for select to authenticated using(public.is_tenant_member(tenant_id));
drop policy if exists property_source_connections_insert on public.property_source_connections;
create policy property_source_connections_insert on public.property_source_connections for insert to authenticated with check(public.is_tenant_member(tenant_id));
drop policy if exists property_source_connections_update on public.property_source_connections;
create policy property_source_connections_update on public.property_source_connections for update to authenticated using(public.is_tenant_member(tenant_id)) with check(public.is_tenant_member(tenant_id));
drop policy if exists property_source_connections_delete on public.property_source_connections;
create policy property_source_connections_delete on public.property_source_connections for delete to authenticated using(public.is_tenant_member(tenant_id));

create table if not exists public.property_discovered_domains (
  id uuid primary key default gen_random_uuid(),domain text not null unique,business_name text,city text,state text,discovery_source text,
  status text not null default 'candidate' check(status in ('candidate','authorized','indexed','blocked','inactive')),
  feed_url text,last_checked_at timestamptz,last_property_seen_at timestamptz,metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.property_discovered_domains enable row level security;
drop policy if exists property_discovered_domains_read on public.property_discovered_domains;
create policy property_discovered_domains_read on public.property_discovered_domains for select to authenticated using(true);

create table if not exists public.property_scan_runs (
  id uuid primary key default gen_random_uuid(),source_code text references public.property_source_catalog(code) on delete set null,
  connection_id uuid references public.property_source_connections(id) on delete set null,
  status text not null default 'queued' check(status in ('queued','running','success','partial','failed')),
  discovered_count integer not null default 0,inserted_count integer not null default 0,updated_count integer not null default 0,
  removed_count integer not null default 0,error_summary text,started_at timestamptz,finished_at timestamptz,created_at timestamptz not null default now()
);
alter table public.property_scan_runs enable row level security;
drop policy if exists property_scan_runs_read on public.property_scan_runs;
create policy property_scan_runs_read on public.property_scan_runs for select to authenticated using(true);

create table if not exists public.property_alert_rules (
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,user_id uuid not null,
  name text not null,criteria jsonb not null default '{}'::jsonb,notify_in_app boolean not null default true,
  notify_whatsapp boolean not null default false,notify_email boolean not null default false,active boolean not null default true,
  last_matched_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.property_alert_rules enable row level security;
drop policy if exists property_alert_rules_all on public.property_alert_rules;
create policy property_alert_rules_all on public.property_alert_rules for all to authenticated using(user_id=auth.uid() and public.is_tenant_member(tenant_id)) with check(user_id=auth.uid() and public.is_tenant_member(tenant_id));

create table if not exists public.property_alert_events (
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,user_id uuid not null,
  rule_id uuid not null references public.property_alert_rules(id) on delete cascade,property_id uuid references public.property_search_index(id) on delete set null,
  property_key text not null,title text not null,property_snapshot jsonb not null,read_at timestamptz,notified_whatsapp_at timestamptz,
  notified_email_at timestamptz,created_at timestamptz not null default now(),unique(rule_id,property_key)
);
alter table public.property_alert_events enable row level security;
drop policy if exists property_alert_events_all on public.property_alert_events;
create policy property_alert_events_all on public.property_alert_events for all to authenticated using(user_id=auth.uid() and public.is_tenant_member(tenant_id)) with check(user_id=auth.uid() and public.is_tenant_member(tenant_id));
create index if not exists property_alert_events_user_unread_idx on public.property_alert_events(user_id,read_at,created_at desc);

create or replace function public.match_property_alert_rules() returns trigger language plpgsql security definer set search_path=public as $$
declare r record;v_key text;v_city text;v_state text;v_type text;v_market text;v_min numeric;v_max numeric;v_auction boolean;
begin
  v_key:=coalesce(new.source_url,new.id::text);
  for r in select * from public.property_alert_rules where active=true loop
    v_city:=nullif(r.criteria->>'city','');v_state:=nullif(r.criteria->>'state','');v_type:=nullif(r.criteria->>'propertyType','');
    v_market:=nullif(r.criteria->>'market','');v_min:=nullif(r.criteria->>'minPrice','')::numeric;v_max:=nullif(r.criteria->>'maxPrice','')::numeric;
    v_auction:=coalesce((r.criteria->>'auctionOnly')::boolean,false);
    if v_city is not null and lower(coalesce(new.location_city,'')) not like '%'||lower(v_city)||'%' then continue;end if;
    if v_state is not null and upper(coalesce(new.location_state,''))<>upper(v_state) then continue;end if;
    if v_type is not null and lower(coalesce(new.property_type,'')) not like '%'||lower(v_type)||'%' then continue;end if;
    if v_market is not null and coalesce(new.listing_market,'market')<>v_market then continue;end if;
    if v_min is not null and (new.price is null or new.price<v_min) then continue;end if;
    if v_max is not null and (new.price is null or new.price>v_max) then continue;end if;
    if v_auction and not coalesce(new.is_auction,false) then continue;end if;
    insert into public.property_alert_events(tenant_id,user_id,rule_id,property_id,property_key,title,property_snapshot)
    values(r.tenant_id,r.user_id,r.id,new.id,v_key,new.title,to_jsonb(new)) on conflict(rule_id,property_key) do nothing;
    update public.property_alert_rules set last_matched_at=now() where id=r.id;
  end loop;return new;
end;$$;
revoke all on function public.match_property_alert_rules() from public,anon,authenticated;
drop trigger if exists trg_match_property_alert_rules on public.property_search_index;
create trigger trg_match_property_alert_rules after insert on public.property_search_index for each row execute function public.match_property_alert_rules();

create table if not exists public.whatsapp_flows (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,created_by uuid not null,
 name text not null,description text,trigger_type text not null default 'manual' check(trigger_type in ('manual','new_conversation','keyword','new_property_alert','webhook')),
 trigger_value text,enabled boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.whatsapp_flows enable row level security;
drop policy if exists whatsapp_flows_all on public.whatsapp_flows;
create policy whatsapp_flows_all on public.whatsapp_flows for all to authenticated using(public.is_tenant_member(tenant_id)) with check(public.is_tenant_member(tenant_id));

create table if not exists public.whatsapp_flow_steps (
 id uuid primary key default gen_random_uuid(),flow_id uuid not null references public.whatsapp_flows(id) on delete cascade,position integer not null,
 step_type text not null check(step_type in ('message','wait','ai','handoff','webhook','tag')),config jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),unique(flow_id,position)
);
alter table public.whatsapp_flow_steps enable row level security;
drop policy if exists whatsapp_flow_steps_all on public.whatsapp_flow_steps;
create policy whatsapp_flow_steps_all on public.whatsapp_flow_steps for all to authenticated using(exists(select 1 from public.whatsapp_flows f where f.id=flow_id and public.is_tenant_member(f.tenant_id))) with check(exists(select 1 from public.whatsapp_flows f where f.id=flow_id and public.is_tenant_member(f.tenant_id)));

create table if not exists public.ai_agent_settings (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null unique references public.tenants(id) on delete cascade,enabled boolean not null default false,
 agent_name text not null default 'Assistente MercadoImobi',system_prompt text,auto_reply boolean not null default false,
 handoff_keywords text[] not null default array['humano','corretor','atendente']::text[],business_hours jsonb not null default '{}'::jsonb,
 updated_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.ai_agent_settings enable row level security;
drop policy if exists ai_agent_settings_all on public.ai_agent_settings;
create policy ai_agent_settings_all on public.ai_agent_settings for all to authenticated using(public.is_tenant_member(tenant_id)) with check(public.is_tenant_member(tenant_id));

create table if not exists public.integration_webhooks (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,name text not null,
 direction text not null check(direction in ('inbound','outbound')),event_type text not null,endpoint_url text,enabled boolean not null default false,
 secret_hash text,created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.integration_webhooks enable row level security;
drop policy if exists integration_webhooks_all on public.integration_webhooks;
create policy integration_webhooks_all on public.integration_webhooks for all to authenticated using(public.is_tenant_member(tenant_id)) with check(public.is_tenant_member(tenant_id));
