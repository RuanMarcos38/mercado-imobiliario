create table if not exists public.property_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  property_key text not null,
  property_snapshot jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(user_id, property_key)
);

alter table public.property_favorites enable row level security;

drop policy if exists "Users can view their own property favorites" on public.property_favorites;
create policy "Users can view their own property favorites"
on public.property_favorites for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can add their own property favorites" on public.property_favorites;
create policy "Users can add their own property favorites"
on public.property_favorites for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own property favorites" on public.property_favorites;
create policy "Users can update their own property favorites"
on public.property_favorites for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own property favorites" on public.property_favorites;
create policy "Users can delete their own property favorites"
on public.property_favorites for delete to authenticated
using (auth.uid() = user_id);

create index if not exists idx_property_favorites_user_created
on public.property_favorites(user_id, created_at desc);

create index if not exists idx_property_favorites_property_key
on public.property_favorites(property_key);
