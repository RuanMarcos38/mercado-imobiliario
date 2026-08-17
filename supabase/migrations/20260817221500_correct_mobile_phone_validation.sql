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
    if left(v_subscriber,1) <> '9' then return null; end if;
  else
    if left(v_subscriber,1) not in ('2','3','4','5') then return null; end if;
  end if;
  return '55' || v_digits;
end;
$$;

revoke all on function public.normalize_valid_br_phone(text) from public;
grant execute on function public.normalize_valid_br_phone(text) to authenticated, service_role, postgres;

update public.property_search_index
set contact_phone = coalesce(public.normalize_valid_br_phone(contact_whatsapp), public.normalize_valid_br_phone(contact_phone)),
    contact_whatsapp = public.normalize_valid_br_phone(contact_whatsapp),
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'contact_phone_valid', true,
      'contact_phone_e164', coalesce(public.normalize_valid_br_phone(contact_whatsapp), public.normalize_valid_br_phone(contact_phone))
    )
where coalesce(listing_market,'market') <> 'caixa'
  and coalesce(public.normalize_valid_br_phone(contact_whatsapp), public.normalize_valid_br_phone(contact_phone)) is not null;