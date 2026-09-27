create table if not exists public.crm_lead_inbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  owner_user_id uuid null references auth.users(id) on delete set null,
  conversation_id uuid null references public.whatsapp_conversations(id) on delete set null,
  protocol_code text null,
  contact_name text not null,
  contact_phone text null,
  contact_email text null,
  source text not null default 'whatsapp',
  last_message text null,
  last_activity_at timestamptz null,
  score integer not null default 0 check (score between 0 and 100),
  temperature text not null default 'cold' check (temperature in ('cold','warm','hot')),
  status text not null default 'new' check (
    status in ('new','qualifying','qualified','discarded','converted')
  ),
  city text null,
  neighborhood text null,
  property_type text null,
  interest text null,
  income numeric(14,2) null check (income is null or income >= 0),
  down_payment numeric(14,2) null check (down_payment is null or down_payment >= 0),
  has_fgts boolean null,
  credit_status text null,
  notes text null,
  converted_opportunity_id uuid null references public.crm_opportunities(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists crm_lead_inbox_tenant_conversation_uidx
  on public.crm_lead_inbox(tenant_id, conversation_id)
  where conversation_id is not null;

create index if not exists crm_lead_inbox_tenant_status_score_idx
  on public.crm_lead_inbox(tenant_id, status, score desc, last_activity_at desc);

create index if not exists crm_lead_inbox_owner_status_idx
  on public.crm_lead_inbox(tenant_id, owner_user_id, status)
  where owner_user_id is not null;

alter table public.crm_lead_inbox enable row level security;

drop policy if exists crm_lead_inbox_member_all on public.crm_lead_inbox;
create policy crm_lead_inbox_member_all
on public.crm_lead_inbox
for all
to authenticated
using (
  exists (
    select 1
    from public.tenants t
    where t.id = crm_lead_inbox.tenant_id
      and (
        t.owner_user_id = (select auth.uid())
        or exists (
          select 1
          from public.tenant_members tm
          where tm.tenant_id = t.id
            and tm.user_id = (select auth.uid())
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.tenants t
    where t.id = crm_lead_inbox.tenant_id
      and (
        t.owner_user_id = (select auth.uid())
        or exists (
          select 1
          from public.tenant_members tm
          where tm.tenant_id = t.id
            and tm.user_id = (select auth.uid())
        )
      )
  )
);

create or replace function public.crm_lead_inbox_from_whatsapp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_meta_phone_number_id text;
  v_meta_phone_number text;
  v_meta_provider_metadata jsonb;
  v_expected_phone text;
  v_actual_phone text;
  v_score integer := 0;
  v_temperature text := 'cold';
begin
  select
    wc.provider_phone_number_id,
    wc.phone_number,
    coalesce(wc.provider_metadata, '{}'::jsonb)
  into
    v_meta_phone_number_id,
    v_meta_phone_number,
    v_meta_provider_metadata
  from public.whatsapp_connections wc
  where wc.tenant_id = new.tenant_id
    and wc.provider = 'meta'
  order by wc.updated_at desc
  limit 1;

  if found then
    v_expected_phone := regexp_replace(
      coalesce(v_meta_provider_metadata->>'expectedPhoneE164', ''),
      '\D',
      '',
      'g'
    );
    v_actual_phone := regexp_replace(coalesce(v_meta_phone_number, ''), '\D', '', 'g');

    if v_expected_phone <> '' and v_actual_phone <> v_expected_phone then
      return new;
    end if;

    if coalesce(v_meta_phone_number_id, '') <> '' then
      if not exists (
        select 1
        from public.whatsapp_messages m
        where m.tenant_id = new.tenant_id
          and m.conversation_id = new.id
          and coalesce(m.raw_payload->>'phone_number_id', '') = v_meta_phone_number_id
          and not (
            coalesce(m.raw_payload->'referral'->>'source_id', '') <> ''
            and exists (
              select 1
              from jsonb_array_elements_text(
                coalesce(v_meta_provider_metadata->'blockedReferralSourceIds', '[]'::jsonb)
              ) blocked(source_id)
              where blocked.source_id = m.raw_payload->'referral'->>'source_id'
            )
          )
      ) then
        return new;
      end if;
    end if;
  end if;

  select coalesce(new.assigned_user_id, t.owner_user_id)
  into v_owner
  from public.tenants t
  where t.id = new.tenant_id;

  if coalesce(btrim(new.phone_e164), '') <> '' then
    v_score := v_score + 10;
  end if;
  if coalesce(btrim(new.contact_name), '') <> ''
     and regexp_replace(coalesce(new.contact_name, ''), '\D', '', 'g')
         <> regexp_replace(coalesce(new.phone_e164, ''), '\D', '', 'g') then
    v_score := v_score + 10;
  end if;
  if length(coalesce(btrim(new.last_message), '')) >= 3 then
    v_score := v_score + 10;
  end if;

  if v_score >= 70 then
    v_temperature := 'hot';
  elsif v_score >= 45 then
    v_temperature := 'warm';
  else
    v_temperature := 'cold';
  end if;

  insert into public.crm_lead_inbox(
    tenant_id, owner_user_id, conversation_id, protocol_code, contact_name, contact_phone,
    source, last_message, last_activity_at, score, temperature, status
  )
  values(
    new.tenant_id, v_owner, new.id, new.protocol_code,
    coalesce(nullif(new.contact_name, ''), new.phone_e164, 'Contato'),
    new.phone_e164, 'whatsapp', nullif(new.last_message, ''),
    coalesce(new.last_message_at, new.created_at, now()),
    v_score, v_temperature, 'new'
  )
  on conflict (tenant_id, conversation_id)
    where conversation_id is not null
  do update set
    owner_user_id = coalesce(excluded.owner_user_id, public.crm_lead_inbox.owner_user_id),
    protocol_code = coalesce(excluded.protocol_code, public.crm_lead_inbox.protocol_code),
    contact_name = coalesce(nullif(excluded.contact_name, ''), public.crm_lead_inbox.contact_name),
    contact_phone = coalesce(excluded.contact_phone, public.crm_lead_inbox.contact_phone),
    last_message = coalesce(excluded.last_message, public.crm_lead_inbox.last_message),
    last_activity_at = greatest(
      coalesce(public.crm_lead_inbox.last_activity_at, '-infinity'::timestamptz),
      coalesce(excluded.last_activity_at, '-infinity'::timestamptz)
    ),
    score = greatest(public.crm_lead_inbox.score, excluded.score),
    updated_at = now();

  return new;
end;
$$;

revoke execute on function public.crm_lead_inbox_from_whatsapp() from public;
revoke execute on function public.crm_lead_inbox_from_whatsapp() from anon;
revoke execute on function public.crm_lead_inbox_from_whatsapp() from authenticated;
grant execute on function public.crm_lead_inbox_from_whatsapp() to service_role;

drop trigger if exists crm_whatsapp_auto_opportunity on public.whatsapp_conversations;
drop trigger if exists crm_whatsapp_lead_inbox on public.whatsapp_conversations;

create trigger crm_whatsapp_lead_inbox
after insert or update of assigned_user_id, contact_name, last_message, last_message_at
on public.whatsapp_conversations
for each row
execute function public.crm_lead_inbox_from_whatsapp();
