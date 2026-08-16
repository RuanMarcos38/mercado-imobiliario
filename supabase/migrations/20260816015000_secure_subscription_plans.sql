alter table public.subscription_plans enable row level security;

revoke insert, update, delete, truncate, references, trigger
on table public.subscription_plans
from anon, authenticated;

grant select on table public.subscription_plans to anon, authenticated;

drop policy if exists "Public can view active subscription plans" on public.subscription_plans;

create policy "Public can view active subscription plans"
on public.subscription_plans
for select
to anon, authenticated
using (is_active is true);
