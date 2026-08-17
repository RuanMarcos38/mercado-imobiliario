create or replace function public.normalize_valid_br_phone(p_value text)
returns text
language plpgsql
immutable
strict
set search_path = public
as $$
declare
  v_digits text;
  v_subscriber text;
  v_ddd text;
begin
  v_digits := regexp_replace(coalesce(p_value,''), '\D', '', 'g');
  if left(v_digits,2)='55' and length(v_digits) in (12,13) then
    v_digits := substr(v_digits,3);
  end if;
  if length(v_digits) not in (10,11) then return null; end if;
  v_ddd := left(v_digits,2);
  if not (v_ddd = any(array[
    '11','12','13','14','15','16','17','18','19','21','22','24','27','28',
    '31','32','33','34','35','37','38','41','42','43','44','45','46','47','48','49',
    '51','53','54','55','61','62','63','64','65','66','67','68','69','71','73','74','75','77','79',
    '81','82','83','84','85','86','87','88','89','91','92','93','94','95','96','97','98','99'
  ]::text[])) then return null; end if;
  if v_digits ~ '^([0-9])\1+$' then return null; end if;
  v_subscriber := substr(v_digits,3);
  if length(v_digits)=11 then
    if left(v_subscriber,1) <> '9' or substr(v_subscriber,2,1) not in ('6','7','8','9') then return null; end if;
  else
    if left(v_subscriber,1) not in ('2','3','4','5') then return null; end if;
  end if;
  return '55' || v_digits;
end;
$$;

revoke all on function public.normalize_valid_br_phone(text) from public;
grant execute on function public.normalize_valid_br_phone(text) to authenticated, service_role, postgres;

create or replace function public.enforce_market_listing_valid_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
begin
  if coalesce(new.listing_market,'market') <> 'caixa' then
    v_phone := coalesce(
      public.normalize_valid_br_phone(new.contact_whatsapp),
      public.normalize_valid_br_phone(new.contact_phone)
    );
    if v_phone is null then return null; end if;
    new.contact_phone := v_phone;
    if public.normalize_valid_br_phone(new.contact_whatsapp) is not null then
      new.contact_whatsapp := public.normalize_valid_br_phone(new.contact_whatsapp);
    end if;
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'contact_phone_valid', true,
      'contact_phone_e164', v_phone
    );
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_market_listing_valid_phone() from public, anon, authenticated;

drop trigger if exists trg_enforce_market_listing_valid_phone on public.property_search_index;
create trigger trg_enforce_market_listing_valid_phone
before insert or update on public.property_search_index
for each row execute function public.enforce_market_listing_valid_phone();

delete from public.property_search_index
where coalesce(listing_market,'market') <> 'caixa'
  and coalesce(
    public.normalize_valid_br_phone(contact_whatsapp),
    public.normalize_valid_br_phone(contact_phone)
  ) is null;

update public.property_search_index
set contact_phone = coalesce(
      public.normalize_valid_br_phone(contact_whatsapp),
      public.normalize_valid_br_phone(contact_phone)
    ),
    contact_whatsapp = case
      when public.normalize_valid_br_phone(contact_whatsapp) is not null
        then public.normalize_valid_br_phone(contact_whatsapp)
      else null
    end,
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'contact_phone_valid', true,
      'contact_phone_e164', coalesce(
        public.normalize_valid_br_phone(contact_whatsapp),
        public.normalize_valid_br_phone(contact_phone)
      )
    )
where coalesce(listing_market,'market') <> 'caixa';

drop policy if exists "authenticated read fresh real estate index" on public.property_search_index;
create policy "authenticated read fresh real estate index"
on public.property_search_index
for select
to authenticated
using (
  last_seen_at is not null
  and last_seen_at >= now() - interval '2 hours'
  and public.property_listing_is_real_estate(source_url,title,description,property_type)
  and (
    listing_market = 'caixa'
    or coalesce(
      public.normalize_valid_br_phone(contact_whatsapp),
      public.normalize_valid_br_phone(contact_phone)
    ) is not null
  )
);

insert into public.property_source_catalog(
  code,name,category,integration_mode,status,website_domain,
  supports_contacts,supports_updates,notes,
  public_discovery_enabled,public_discovery_mode,official_integration_optional,public_discovery_status
) values
('gafisa','Gafisa','builder','public_web_discovery','ready','gafisa.com.br',true,true,'Descoberta pública de empreendimentos com telefone brasileiro válido; integração oficial permanece opcional.',true,'hybrid',true,'ready'),
('plaenge','Plaenge','builder','public_web_discovery','ready','plaenge.com.br',true,true,'Descoberta pública de empreendimentos com telefone brasileiro válido; integração oficial permanece opcional.',true,'hybrid',true,'ready'),
('helbor','Helbor','builder','public_web_discovery','ready','helbor.com.br',true,true,'Descoberta pública de empreendimentos com telefone brasileiro válido; integração oficial permanece opcional.',true,'hybrid',true,'ready'),
('patrimar','Patrimar','builder','public_web_discovery','ready','patrimar.com.br',true,true,'Descoberta pública de empreendimentos com telefone brasileiro válido; integração oficial permanece opcional.',true,'hybrid',true,'ready')
on conflict(code) do update set
  name=excluded.name,
  category=excluded.category,
  integration_mode=excluded.integration_mode,
  website_domain=excluded.website_domain,
  supports_contacts=excluded.supports_contacts,
  supports_updates=excluded.supports_updates,
  notes=excluded.notes,
  public_discovery_enabled=true,
  public_discovery_mode='hybrid',
  official_integration_optional=true,
  updated_at=now();

update public.property_source_catalog c
set public_discovery_count = coalesce(x.cnt,0),
    status = case when c.code='caixa' then 'active' when coalesce(x.cnt,0)>0 then 'active' else 'ready' end,
    public_discovery_status = case when c.code='caixa' then 'active' when coalesce(x.cnt,0)>0 then 'active' else case when c.public_discovery_status='blocked' then 'blocked' else 'ready' end end,
    updated_at=now()
from (
  select c2.code, count(i.id)::integer as cnt
  from public.property_source_catalog c2
  left join public.property_search_index i
    on i.metadata->>'source_code'=c2.code
   and coalesce(i.listing_market,'market') <> 'caixa'
   and coalesce(public.normalize_valid_br_phone(i.contact_whatsapp), public.normalize_valid_br_phone(i.contact_phone)) is not null
  group by c2.code
) x
where c.code=x.code;

create index if not exists property_search_valid_contact_idx
on public.property_search_index ((coalesce(public.normalize_valid_br_phone(contact_whatsapp), public.normalize_valid_br_phone(contact_phone))))
where listing_market <> 'caixa';