-- MercadoImobi runtime completion. Additive only: no existing project/table is removed or renamed.

create table if not exists public.property_alert_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,
  name text not null,
  criteria jsonb not null default '{}'::jsonb,
  notify_in_app boolean not null default true,
  notify_whatsapp boolean not null default false,
  notify_email boolean not null default false,
  active boolean not null default true,
  last_matched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.property_alert_rules enable row level security;
drop policy if exists property_alert_rules_select on public.property_alert_rules;
drop policy if exists property_alert_rules_insert on public.property_alert_rules;
drop policy if exists property_alert_rules_update on public.property_alert_rules;
drop policy if exists property_alert_rules_delete on public.property_alert_rules;
create policy property_alert_rules_select on public.property_alert_rules for select to authenticated
  using (user_id=auth.uid() and exists(select 1 from public.tenant_members tm where tm.tenant_id=property_alert_rules.tenant_id and tm.user_id=auth.uid()));
create policy property_alert_rules_insert on public.property_alert_rules for insert to authenticated
  with check (user_id=auth.uid() and exists(select 1 from public.tenant_members tm where tm.tenant_id=property_alert_rules.tenant_id and tm.user_id=auth.uid()));
create policy property_alert_rules_update on public.property_alert_rules for update to authenticated
  using (user_id=auth.uid() and exists(select 1 from public.tenant_members tm where tm.tenant_id=property_alert_rules.tenant_id and tm.user_id=auth.uid()))
  with check (user_id=auth.uid() and exists(select 1 from public.tenant_members tm where tm.tenant_id=property_alert_rules.tenant_id and tm.user_id=auth.uid()));
create policy property_alert_rules_delete on public.property_alert_rules for delete to authenticated
  using (user_id=auth.uid() and exists(select 1 from public.tenant_members tm where tm.tenant_id=property_alert_rules.tenant_id and tm.user_id=auth.uid()));
create index if not exists property_alert_rules_user_active_idx on public.property_alert_rules(user_id,active,created_at desc);

create table if not exists public.property_alert_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,
  rule_id uuid not null references public.property_alert_rules(id) on delete cascade,
  property_id uuid references public.property_search_index(id) on delete set null,
  property_key text not null,
  title text not null,
  property_snapshot jsonb not null,
  read_at timestamptz,
  notified_whatsapp_at timestamptz,
  notified_email_at timestamptz,
  created_at timestamptz not null default now(),
  unique(rule_id,property_key)
);
alter table public.property_alert_events enable row level security;
drop policy if exists property_alert_events_select on public.property_alert_events;
drop policy if exists property_alert_events_insert on public.property_alert_events;
drop policy if exists property_alert_events_update on public.property_alert_events;
drop policy if exists property_alert_events_delete on public.property_alert_events;
create policy property_alert_events_select on public.property_alert_events for select to authenticated
  using (user_id=auth.uid() and exists(select 1 from public.tenant_members tm where tm.tenant_id=property_alert_events.tenant_id and tm.user_id=auth.uid()));
create policy property_alert_events_insert on public.property_alert_events for insert to authenticated
  with check (user_id=auth.uid() and exists(select 1 from public.tenant_members tm where tm.tenant_id=property_alert_events.tenant_id and tm.user_id=auth.uid()));
create policy property_alert_events_update on public.property_alert_events for update to authenticated
  using (user_id=auth.uid() and exists(select 1 from public.tenant_members tm where tm.tenant_id=property_alert_events.tenant_id and tm.user_id=auth.uid()))
  with check (user_id=auth.uid() and exists(select 1 from public.tenant_members tm where tm.tenant_id=property_alert_events.tenant_id and tm.user_id=auth.uid()));
create policy property_alert_events_delete on public.property_alert_events for delete to authenticated
  using (user_id=auth.uid() and exists(select 1 from public.tenant_members tm where tm.tenant_id=property_alert_events.tenant_id and tm.user_id=auth.uid()));
create index if not exists property_alert_events_user_unread_idx on public.property_alert_events(user_id,read_at,created_at desc);

create or replace function public.match_property_alert_rules()
returns trigger language plpgsql security definer set search_path=public as $$
declare r record; v_key text; v_city text; v_state text; v_type text; v_market text; v_min numeric; v_max numeric; v_auction boolean;
begin
  v_key:=coalesce(new.source_url,new.id::text);
  for r in select * from public.property_alert_rules where active=true loop
    v_city:=nullif(r.criteria->>'city',''); v_state:=nullif(r.criteria->>'state',''); v_type:=nullif(r.criteria->>'propertyType','');
    v_market:=nullif(r.criteria->>'market',''); v_min:=nullif(r.criteria->>'minPrice','')::numeric; v_max:=nullif(r.criteria->>'maxPrice','')::numeric;
    v_auction:=coalesce((r.criteria->>'auctionOnly')::boolean,false);
    if v_city is not null and lower(coalesce(new.location_city,'')) not like '%'||lower(v_city)||'%' then continue; end if;
    if v_state is not null and upper(coalesce(new.location_state,''))<>upper(v_state) then continue; end if;
    if v_type is not null and lower(coalesce(new.property_type,'')) not like '%'||lower(v_type)||'%' then continue; end if;
    if v_market is not null and coalesce(new.listing_market,'market')<>v_market then continue; end if;
    if v_min is not null and (new.price is null or new.price<v_min) then continue; end if;
    if v_max is not null and (new.price is null or new.price>v_max) then continue; end if;
    if v_auction and not coalesce(new.is_auction,false) then continue; end if;
    insert into public.property_alert_events(tenant_id,user_id,rule_id,property_id,property_key,title,property_snapshot)
    values(r.tenant_id,r.user_id,r.id,new.id,v_key,new.title,to_jsonb(new)) on conflict(rule_id,property_key) do nothing;
    update public.property_alert_rules set last_matched_at=now(),updated_at=now() where id=r.id;
  end loop;
  return new;
end; $$;
revoke all on function public.match_property_alert_rules() from public,anon,authenticated;
drop trigger if exists trg_match_property_alert_rules on public.property_search_index;
create trigger trg_match_property_alert_rules after insert on public.property_search_index for each row execute function public.match_property_alert_rules();

create table if not exists public.whatsapp_flows (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid not null, name text not null, description text,
  trigger_type text not null default 'manual' check(trigger_type in ('manual','new_conversation','keyword','new_property_alert','webhook')),
  trigger_value text, enabled boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.whatsapp_flows enable row level security;
drop policy if exists whatsapp_flows_select on public.whatsapp_flows;
drop policy if exists whatsapp_flows_insert on public.whatsapp_flows;
drop policy if exists whatsapp_flows_update on public.whatsapp_flows;
drop policy if exists whatsapp_flows_delete on public.whatsapp_flows;
create policy whatsapp_flows_select on public.whatsapp_flows for select to authenticated using (exists(select 1 from public.tenant_members tm where tm.tenant_id=whatsapp_flows.tenant_id and tm.user_id=auth.uid()));
create policy whatsapp_flows_insert on public.whatsapp_flows for insert to authenticated with check (created_by=auth.uid() and exists(select 1 from public.tenant_members tm where tm.tenant_id=whatsapp_flows.tenant_id and tm.user_id=auth.uid()));
create policy whatsapp_flows_update on public.whatsapp_flows for update to authenticated using (exists(select 1 from public.tenant_members tm where tm.tenant_id=whatsapp_flows.tenant_id and tm.user_id=auth.uid())) with check (exists(select 1 from public.tenant_members tm where tm.tenant_id=whatsapp_flows.tenant_id and tm.user_id=auth.uid()));
create policy whatsapp_flows_delete on public.whatsapp_flows for delete to authenticated using (exists(select 1 from public.tenant_members tm where tm.tenant_id=whatsapp_flows.tenant_id and tm.user_id=auth.uid()));
create index if not exists whatsapp_flows_tenant_idx on public.whatsapp_flows(tenant_id,created_at desc);

create table if not exists public.whatsapp_flow_steps (
  id uuid primary key default gen_random_uuid(), flow_id uuid not null references public.whatsapp_flows(id) on delete cascade,
  position integer not null, step_type text not null check(step_type in ('message','wait','ai','handoff','webhook','tag')),
  config jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), unique(flow_id,position)
);
alter table public.whatsapp_flow_steps enable row level security;
drop policy if exists whatsapp_flow_steps_select on public.whatsapp_flow_steps;
drop policy if exists whatsapp_flow_steps_insert on public.whatsapp_flow_steps;
drop policy if exists whatsapp_flow_steps_update on public.whatsapp_flow_steps;
drop policy if exists whatsapp_flow_steps_delete on public.whatsapp_flow_steps;
create policy whatsapp_flow_steps_select on public.whatsapp_flow_steps for select to authenticated using (exists(select 1 from public.whatsapp_flows f join public.tenant_members tm on tm.tenant_id=f.tenant_id where f.id=whatsapp_flow_steps.flow_id and tm.user_id=auth.uid()));
create policy whatsapp_flow_steps_insert on public.whatsapp_flow_steps for insert to authenticated with check (exists(select 1 from public.whatsapp_flows f join public.tenant_members tm on tm.tenant_id=f.tenant_id where f.id=whatsapp_flow_steps.flow_id and tm.user_id=auth.uid()));
create policy whatsapp_flow_steps_update on public.whatsapp_flow_steps for update to authenticated using (exists(select 1 from public.whatsapp_flows f join public.tenant_members tm on tm.tenant_id=f.tenant_id where f.id=whatsapp_flow_steps.flow_id and tm.user_id=auth.uid())) with check (exists(select 1 from public.whatsapp_flows f join public.tenant_members tm on tm.tenant_id=f.tenant_id where f.id=whatsapp_flow_steps.flow_id and tm.user_id=auth.uid()));
create policy whatsapp_flow_steps_delete on public.whatsapp_flow_steps for delete to authenticated using (exists(select 1 from public.whatsapp_flows f join public.tenant_members tm on tm.tenant_id=f.tenant_id where f.id=whatsapp_flow_steps.flow_id and tm.user_id=auth.uid()));

create table if not exists public.integration_webhooks (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null, direction text not null check(direction in ('inbound','outbound')), event_type text not null,
  endpoint_url text, enabled boolean not null default false, secret_hash text, created_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.integration_webhooks enable row level security;
drop policy if exists integration_webhooks_select on public.integration_webhooks;
drop policy if exists integration_webhooks_insert on public.integration_webhooks;
drop policy if exists integration_webhooks_update on public.integration_webhooks;
drop policy if exists integration_webhooks_delete on public.integration_webhooks;
create policy integration_webhooks_select on public.integration_webhooks for select to authenticated using (exists(select 1 from public.tenant_members tm where tm.tenant_id=integration_webhooks.tenant_id and tm.user_id=auth.uid()));
create policy integration_webhooks_insert on public.integration_webhooks for insert to authenticated with check ((created_by is null or created_by=auth.uid()) and exists(select 1 from public.tenant_members tm where tm.tenant_id=integration_webhooks.tenant_id and tm.user_id=auth.uid()));
create policy integration_webhooks_update on public.integration_webhooks for update to authenticated using (exists(select 1 from public.tenant_members tm where tm.tenant_id=integration_webhooks.tenant_id and tm.user_id=auth.uid())) with check (exists(select 1 from public.tenant_members tm where tm.tenant_id=integration_webhooks.tenant_id and tm.user_id=auth.uid()));
create policy integration_webhooks_delete on public.integration_webhooks for delete to authenticated using (exists(select 1 from public.tenant_members tm where tm.tenant_id=integration_webhooks.tenant_id and tm.user_id=auth.uid()));
create index if not exists integration_webhooks_tenant_idx on public.integration_webhooks(tenant_id,created_at desc);

-- Keep private job credentials in this project's Vault. Values are generated in-database and never committed.
do $$
begin
  if not exists (select 1 from vault.secrets where name='mercadoimobi_property_discovery_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32),'hex'),'mercadoimobi_property_discovery_secret','Internal property discovery job key - MercadoImobi',null);
  end if;
  if not exists (select 1 from vault.secrets where name='mercadoimobi_property_feed_sync_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32),'hex'),'mercadoimobi_property_feed_sync_secret','Internal property feed and CRM jobs key - MercadoImobi',null);
  end if;
  if not exists (select 1 from vault.secrets where name='mercadoimobi_property_import_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32),'hex'),'mercadoimobi_property_import_secret','Legacy authorized property import key - MercadoImobi',null);
  end if;
end $$;
