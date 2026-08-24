-- Atendimento operacional inspirado em boas praticas de centrais de conversas.
-- Alteracao aditiva: preserva conversas/mensagens existentes e o layout atual do produto.

alter table public.whatsapp_conversations
  add column if not exists attendance_state text not null default 'automatic',
  add column if not exists waiting_since timestamptz null,
  add column if not exists accepted_at timestamptz null,
  add column if not exists first_response_at timestamptz null,
  add column if not exists closed_at timestamptz null,
  add column if not exists department_name text null,
  add column if not exists tags text[] not null default '{}'::text[];

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'whatsapp_conversations_attendance_state_check'
      and conrelid = 'public.whatsapp_conversations'::regclass
  ) then
    alter table public.whatsapp_conversations
      add constraint whatsapp_conversations_attendance_state_check
      check (attendance_state in ('waiting','in_service','automatic'));
  end if;
end $$;

create index if not exists whatsapp_conversations_tenant_attendance_idx
  on public.whatsapp_conversations (tenant_id, attendance_state, last_message_at desc nulls last);
create index if not exists whatsapp_conversations_tenant_tags_idx
  on public.whatsapp_conversations using gin (tags);

alter table public.tenant_members
  add column if not exists can_view_sensitive_data boolean not null default false;

-- Proprietarios/administradores existentes mantem visibilidade. Demais perfis ficam protegidos.
update public.tenant_members
set can_view_sensitive_data = true
where lower(member_role) in ('owner','admin','administrator');

create table if not exists public.whatsapp_attendant_presence (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'free',
  status_since timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id),
  constraint whatsapp_attendant_presence_status_check
    check (status in ('alert','in_service','free','paused','away'))
);

create index if not exists whatsapp_attendant_presence_tenant_status_idx
  on public.whatsapp_attendant_presence (tenant_id, status, updated_at desc);

create table if not exists public.whatsapp_attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  user_id uuid null references auth.users(id) on delete set null,
  queued_at timestamptz null,
  accepted_at timestamptz not null default now(),
  first_response_at timestamptz null,
  closed_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_attendance_sessions_tenant_accepted_idx
  on public.whatsapp_attendance_sessions (tenant_id, accepted_at desc);
create index if not exists whatsapp_attendance_sessions_open_idx
  on public.whatsapp_attendance_sessions (tenant_id, conversation_id)
  where closed_at is null;

create table if not exists public.sensitive_data_access_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid null references public.whatsapp_conversations(id) on delete set null,
  field_name text not null,
  created_at timestamptz not null default now(),
  constraint sensitive_data_access_audit_field_check
    check (field_name in ('phone'))
);

create index if not exists sensitive_data_access_audit_tenant_created_idx
  on public.sensitive_data_access_audit (tenant_id, created_at desc);

alter table public.whatsapp_attendant_presence enable row level security;
alter table public.whatsapp_attendance_sessions enable row level security;
alter table public.sensitive_data_access_audit enable row level security;

revoke all on table public.whatsapp_attendant_presence from anon;
revoke all on table public.whatsapp_attendance_sessions from anon;
revoke all on table public.sensitive_data_access_audit from anon;
grant select, insert, update, delete on table public.whatsapp_attendant_presence to authenticated;
grant select, insert, update, delete on table public.whatsapp_attendance_sessions to authenticated;
grant select, insert on table public.sensitive_data_access_audit to authenticated;

drop policy if exists whatsapp_attendant_presence_member_select on public.whatsapp_attendant_presence;
create policy whatsapp_attendant_presence_member_select
on public.whatsapp_attendant_presence for select to authenticated
using (exists (
  select 1 from public.tenant_members tm
  where tm.tenant_id = whatsapp_attendant_presence.tenant_id
    and tm.user_id = auth.uid()
));

drop policy if exists whatsapp_attendant_presence_self_insert on public.whatsapp_attendant_presence;
create policy whatsapp_attendant_presence_self_insert
on public.whatsapp_attendant_presence for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = whatsapp_attendant_presence.tenant_id
      and tm.user_id = auth.uid()
  )
);

drop policy if exists whatsapp_attendant_presence_self_update on public.whatsapp_attendant_presence;
create policy whatsapp_attendant_presence_self_update
on public.whatsapp_attendant_presence for update to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = whatsapp_attendant_presence.tenant_id
      and tm.user_id = auth.uid()
  )
)
with check (user_id = auth.uid());

drop policy if exists whatsapp_attendance_sessions_member_select on public.whatsapp_attendance_sessions;
create policy whatsapp_attendance_sessions_member_select
on public.whatsapp_attendance_sessions for select to authenticated
using (exists (
  select 1 from public.tenant_members tm
  where tm.tenant_id = whatsapp_attendance_sessions.tenant_id
    and tm.user_id = auth.uid()
));

drop policy if exists whatsapp_attendance_sessions_member_insert on public.whatsapp_attendance_sessions;
create policy whatsapp_attendance_sessions_member_insert
on public.whatsapp_attendance_sessions for insert to authenticated
with check (exists (
  select 1 from public.tenant_members tm
  where tm.tenant_id = whatsapp_attendance_sessions.tenant_id
    and tm.user_id = auth.uid()
));

drop policy if exists whatsapp_attendance_sessions_member_update on public.whatsapp_attendance_sessions;
create policy whatsapp_attendance_sessions_member_update
on public.whatsapp_attendance_sessions for update to authenticated
using (exists (
  select 1 from public.tenant_members tm
  where tm.tenant_id = whatsapp_attendance_sessions.tenant_id
    and tm.user_id = auth.uid()
))
with check (exists (
  select 1 from public.tenant_members tm
  where tm.tenant_id = whatsapp_attendance_sessions.tenant_id
    and tm.user_id = auth.uid()
));

drop policy if exists sensitive_data_access_audit_member_select on public.sensitive_data_access_audit;
create policy sensitive_data_access_audit_member_select
on public.sensitive_data_access_audit for select to authenticated
using (exists (
  select 1 from public.tenant_members tm
  where tm.tenant_id = sensitive_data_access_audit.tenant_id
    and tm.user_id = auth.uid()
));

drop policy if exists sensitive_data_access_audit_self_insert on public.sensitive_data_access_audit;
create policy sensitive_data_access_audit_self_insert
on public.sensitive_data_access_audit for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = sensitive_data_access_audit.tenant_id
      and tm.user_id = auth.uid()
  )
);
