create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  assigned_user_id uuid null references auth.users(id) on delete set null,
  phone_e164 text not null,
  contact_name text null,
  avatar_url text null,
  last_message text null,
  last_message_at timestamptz null,
  unread_count integer not null default 0 check (unread_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_conversations_phone_format check (phone_e164 ~ '^55[1-9][0-9]{9,10}$'),
  constraint whatsapp_conversations_tenant_phone_unique unique (tenant_id, phone_e164)
);

create index if not exists whatsapp_conversations_tenant_last_message_idx
  on public.whatsapp_conversations (tenant_id, last_message_at desc nulls last);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  external_message_id text null,
  direction text not null check (direction in ('inbound','outbound')),
  message_type text not null default 'text',
  body text null,
  media_url text null,
  status text not null default 'received',
  sender_name text null,
  sent_at timestamptz not null default now(),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_messages_conversation_sent_idx
  on public.whatsapp_messages (conversation_id, sent_at asc);
create index if not exists whatsapp_messages_tenant_sent_idx
  on public.whatsapp_messages (tenant_id, sent_at desc);
create unique index if not exists whatsapp_messages_tenant_external_unique
  on public.whatsapp_messages (tenant_id, external_message_id)
  where external_message_id is not null;

alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;

revoke all on table public.whatsapp_conversations from anon;
revoke all on table public.whatsapp_messages from anon;
grant select, insert, update, delete on table public.whatsapp_conversations to authenticated;
grant select, insert, update, delete on table public.whatsapp_messages to authenticated;

create policy whatsapp_conversations_read_member
on public.whatsapp_conversations for select to authenticated
using (exists (
  select 1 from public.tenant_members tm
  where tm.tenant_id = whatsapp_conversations.tenant_id
    and tm.user_id = auth.uid()
));

create policy whatsapp_conversations_insert_member
on public.whatsapp_conversations for insert to authenticated
with check (exists (
  select 1 from public.tenant_members tm
  where tm.tenant_id = whatsapp_conversations.tenant_id
    and tm.user_id = auth.uid()
));

create policy whatsapp_conversations_update_member
on public.whatsapp_conversations for update to authenticated
using (exists (
  select 1 from public.tenant_members tm
  where tm.tenant_id = whatsapp_conversations.tenant_id
    and tm.user_id = auth.uid()
))
with check (exists (
  select 1 from public.tenant_members tm
  where tm.tenant_id = whatsapp_conversations.tenant_id
    and tm.user_id = auth.uid()
));

create policy whatsapp_conversations_delete_member
on public.whatsapp_conversations for delete to authenticated
using (exists (
  select 1 from public.tenant_members tm
  where tm.tenant_id = whatsapp_conversations.tenant_id
    and tm.user_id = auth.uid()
));

create policy whatsapp_messages_read_member
on public.whatsapp_messages for select to authenticated
using (exists (
  select 1 from public.tenant_members tm
  where tm.tenant_id = whatsapp_messages.tenant_id
    and tm.user_id = auth.uid()
));

create policy whatsapp_messages_insert_member
on public.whatsapp_messages for insert to authenticated
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = whatsapp_messages.tenant_id
      and tm.user_id = auth.uid()
  )
  and exists (
    select 1 from public.whatsapp_conversations wc
    where wc.id = whatsapp_messages.conversation_id
      and wc.tenant_id = whatsapp_messages.tenant_id
  )
);

create policy whatsapp_messages_update_member
on public.whatsapp_messages for update to authenticated
using (exists (
  select 1 from public.tenant_members tm
  where tm.tenant_id = whatsapp_messages.tenant_id
    and tm.user_id = auth.uid()
))
with check (exists (
  select 1 from public.tenant_members tm
  where tm.tenant_id = whatsapp_messages.tenant_id
    and tm.user_id = auth.uid()
));

create policy whatsapp_messages_delete_member
on public.whatsapp_messages for delete to authenticated
using (exists (
  select 1 from public.tenant_members tm
  where tm.tenant_id = whatsapp_messages.tenant_id
    and tm.user_id = auth.uid()
));
