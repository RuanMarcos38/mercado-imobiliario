alter table public.whatsapp_connections
  add column if not exists phone_number text;

comment on column public.whatsapp_connections.phone_number is
  'Normalized WhatsApp phone number reported by the connected Evolution instance when available.';
