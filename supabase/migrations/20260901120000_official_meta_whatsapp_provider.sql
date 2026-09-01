alter table public.whatsapp_connections
  add column if not exists provider text not null default 'evolution',
  add column if not exists provider_phone_number_id text,
  add column if not exists provider_business_account_id text,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'whatsapp_connections_provider_check'
      and conrelid = 'public.whatsapp_connections'::regclass
  ) then
    alter table public.whatsapp_connections
      add constraint whatsapp_connections_provider_check
      check (provider in ('evolution', 'meta'));
  end if;
end $$;

update public.whatsapp_connections
   set provider = 'evolution'
 where provider is null;

create unique index if not exists whatsapp_connections_meta_phone_unique
  on public.whatsapp_connections (provider_phone_number_id)
  where provider = 'meta' and provider_phone_number_id is not null;

create index if not exists whatsapp_connections_provider_idx
  on public.whatsapp_connections (provider, tenant_id);

comment on column public.whatsapp_connections.provider is
  'WhatsApp runtime provider for the tenant: evolution QR gateway or official Meta Cloud API.';

comment on column public.whatsapp_connections.provider_phone_number_id is
  'Official Meta WhatsApp Phone Number ID. This is not a secret and is used to route webhooks to the tenant.';

comment on column public.whatsapp_connections.provider_business_account_id is
  'Official Meta WhatsApp Business Account ID when configured. This is not a secret.';

comment on column public.whatsapp_connections.provider_metadata is
  'Non-secret runtime metadata for the WhatsApp provider. Access tokens remain in server env or encrypted storage only.';
