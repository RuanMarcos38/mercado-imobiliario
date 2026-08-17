create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  company_name text,
  user_type text not null default 'corretor' check (user_type in ('cliente','corretor','imobiliaria','proprietario','construtora','admin')),
  is_active boolean not null default true,
  tenant_id uuid references public.tenants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','user')),
  created_at timestamptz not null default now(),
  unique(user_id, role)
);

create table if not exists public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'owner' check (member_role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  unique(tenant_id, user_id)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'trialing' check (status in ('trialing','active','past_due','canceled','unpaid')),
  trial_start timestamptz,
  trial_end timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_tenant_id on public.profiles(tenant_id);
create index if not exists idx_user_roles_user_id on public.user_roles(user_id);
create index if not exists idx_tenant_members_user_id on public.tenant_members(user_id);
create index if not exists idx_tenant_members_tenant_id on public.tenant_members(tenant_id);
create index if not exists idx_subscriptions_user_id_created_at on public.subscriptions(user_id, created_at desc);

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.tenant_members enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists profiles_read_self on public.profiles;
create policy profiles_read_self on public.profiles for select to authenticated using (id = auth.uid());

drop policy if exists user_roles_read_self on public.user_roles;
create policy user_roles_read_self on public.user_roles for select to authenticated using (user_id = auth.uid());

drop policy if exists tenants_read_member on public.tenants;
create policy tenants_read_member on public.tenants for select to authenticated using (
  owner_user_id = auth.uid() or exists (
    select 1 from public.tenant_members tm where tm.tenant_id = tenants.id and tm.user_id = auth.uid()
  )
);

drop policy if exists tenant_members_read_self on public.tenant_members;
create policy tenant_members_read_self on public.tenant_members for select to authenticated using (user_id = auth.uid());

drop policy if exists subscriptions_read_self on public.subscriptions;
create policy subscriptions_read_self on public.subscriptions for select to authenticated using (user_id = auth.uid());

create or replace function public.handle_mercadoimobi_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, user_type)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    case when new.raw_user_meta_data ->> 'user_type' in ('cliente','corretor','imobiliaria','proprietario','construtora','admin')
      then new.raw_user_meta_data ->> 'user_type'
      else 'corretor'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_mercadoimobi_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_mercadoimobi on auth.users;
create trigger on_auth_user_created_mercadoimobi
after insert on auth.users
for each row execute procedure public.handle_mercadoimobi_new_user();

insert into public.profiles (id, full_name, company_name, user_type, is_active)
select id, coalesce(raw_user_meta_data ->> 'full_name', split_part(email,'@',1)), 'RM NEGOCIO IMOBILIARIO', 'admin', true
from auth.users
where email = 'admin@r2rmarketingdigital.com.br'
on conflict (id) do update set user_type='admin', is_active=true, updated_at=now();

insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'admin@r2rmarketingdigital.com.br'
on conflict (user_id, role) do nothing;
