-- MercadoImobi: restore tenant-scoped AI agent settings required by automatic WhatsApp attendance.
create table if not exists public.ai_agent_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  agent_name text not null default 'Assistente MercadoImobi',
  system_prompt text,
  auto_reply boolean not null default false,
  handoff_keywords text[] not null default array['humano','corretor','atendente']::text[],
  business_hours jsonb not null default '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_agent_settings enable row level security;

drop policy if exists ai_agent_settings_select on public.ai_agent_settings;
create policy ai_agent_settings_select on public.ai_agent_settings
for select to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = ai_agent_settings.tenant_id
      and tm.user_id = (select auth.uid())
  )
);

drop policy if exists ai_agent_settings_insert on public.ai_agent_settings;
create policy ai_agent_settings_insert on public.ai_agent_settings
for insert to authenticated
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = ai_agent_settings.tenant_id
      and tm.user_id = (select auth.uid())
  )
);

drop policy if exists ai_agent_settings_update on public.ai_agent_settings;
create policy ai_agent_settings_update on public.ai_agent_settings
for update to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = ai_agent_settings.tenant_id
      and tm.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = ai_agent_settings.tenant_id
      and tm.user_id = (select auth.uid())
  )
);

drop policy if exists ai_agent_settings_delete on public.ai_agent_settings;
create policy ai_agent_settings_delete on public.ai_agent_settings
for delete to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = ai_agent_settings.tenant_id
      and tm.user_id = (select auth.uid())
  )
);

grant select, insert, update, delete on public.ai_agent_settings to authenticated;
revoke all on public.ai_agent_settings from anon;
