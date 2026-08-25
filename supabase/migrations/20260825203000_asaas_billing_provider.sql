alter table public.subscriptions
  add column if not exists billing_provider text,
  add column if not exists asaas_customer_id text,
  add column if not exists asaas_subscription_id text,
  add column if not exists asaas_checkout_id text;

create index if not exists subscriptions_asaas_customer_id_idx
  on public.subscriptions(asaas_customer_id)
  where asaas_customer_id is not null;

create index if not exists subscriptions_asaas_subscription_id_idx
  on public.subscriptions(asaas_subscription_id)
  where asaas_subscription_id is not null;

create or replace function public.get_platform_secret(p_name text)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = p_name
  order by updated_at desc
  limit 1;
$$;

revoke all on function public.get_platform_secret(text) from public;
revoke all on function public.get_platform_secret(text) from anon;
revoke all on function public.get_platform_secret(text) from authenticated;
grant execute on function public.get_platform_secret(text) to service_role;

comment on function public.get_platform_secret(text) is
  'Server-only accessor for encrypted platform secrets stored in Supabase Vault.';
