-- MercadoImobi: corrige o centro de atendimento criando o event store usado
-- pelas filas, presença, tags, métricas e permissões sensíveis do WhatsApp.

create table if not exists public.system_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_type text not null,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  severity text not null default 'info',
  created_at timestamptz not null default now()
);

create index if not exists system_events_tenant_type_created_idx
  on public.system_events(tenant_id, event_type, created_at desc);
create index if not exists system_events_tenant_created_idx
  on public.system_events(tenant_id, created_at desc);

alter table public.system_events enable row level security;

drop policy if exists system_events_read_member on public.system_events;
create policy system_events_read_member
on public.system_events for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = system_events.tenant_id
      and tm.user_id = auth.uid()
  )
);

grant select on public.system_events to authenticated;
grant all on public.system_events to service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'system_events'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.system_events;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
