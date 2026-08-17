do $$
declare
  v_user uuid;
  v_tenant uuid;
begin
  select id into v_user from auth.users where lower(email)='admin@r2rmarketingdigital.com.br' limit 1;
  if v_user is null then
    raise exception 'bootstrap admin auth user not found';
  end if;

  select id into v_tenant from public.tenants where owner_user_id=v_user limit 1;
  if v_tenant is null then
    insert into public.tenants(name, owner_user_id)
    values ('MercadoImobi Administração', v_user)
    returning id into v_tenant;
  end if;

  insert into public.tenant_members(tenant_id,user_id,member_role)
  select v_tenant,v_user,'owner'
  where not exists (
    select 1 from public.tenant_members where tenant_id=v_tenant and user_id=v_user
  );

  update public.profiles
     set tenant_id=v_tenant, is_active=true, user_type='admin', updated_at=now()
   where id=v_user;

  insert into public.user_roles(user_id,role)
  select v_user,'admin'
  where not exists (select 1 from public.user_roles where user_id=v_user and role='admin');

  insert into public.subscriptions(user_id,status,current_period_start,current_period_end)
  select v_user,'active',now(),now()+interval '10 years'
  where not exists (select 1 from public.subscriptions where user_id=v_user);
end $$;

create table if not exists public.whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  instance_name text not null,
  display_name text not null default 'Meu WhatsApp',
  status text not null default 'disconnected' check (status in ('connected','connecting','disconnected','error')),
  last_connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id),
  unique(instance_name)
);

alter table public.whatsapp_connections enable row level security;

drop policy if exists whatsapp_connections_read_member on public.whatsapp_connections;
create policy whatsapp_connections_read_member
on public.whatsapp_connections for select
to authenticated
using (
  owner_user_id = auth.uid() or exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = whatsapp_connections.tenant_id and tm.user_id = auth.uid()
  )
);

drop policy if exists whatsapp_connections_insert_member on public.whatsapp_connections;
create policy whatsapp_connections_insert_member
on public.whatsapp_connections for insert
to authenticated
with check (
  owner_user_id = auth.uid() and exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = whatsapp_connections.tenant_id and tm.user_id = auth.uid()
  )
);

drop policy if exists whatsapp_connections_update_member on public.whatsapp_connections;
create policy whatsapp_connections_update_member
on public.whatsapp_connections for update
to authenticated
using (
  owner_user_id = auth.uid() or exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = whatsapp_connections.tenant_id and tm.user_id = auth.uid()
  )
)
with check (
  owner_user_id = auth.uid() or exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = whatsapp_connections.tenant_id and tm.user_id = auth.uid()
  )
);

create index if not exists whatsapp_connections_tenant_idx on public.whatsapp_connections(tenant_id);
create index if not exists whatsapp_connections_owner_idx on public.whatsapp_connections(owner_user_id);
