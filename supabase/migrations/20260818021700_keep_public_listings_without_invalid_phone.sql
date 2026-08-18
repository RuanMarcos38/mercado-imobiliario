-- Public listings must remain searchable even when a source does not publish a phone.
-- Invalid phones are removed from contact fields instead of causing the listing row to be discarded.

create or replace function public.enforce_market_listing_valid_phone()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phone text;
  v_whatsapp text;
begin
  if coalesce(new.listing_market,'market') <> 'caixa' then
    v_whatsapp := public.normalize_valid_br_phone(new.contact_whatsapp);
    v_phone := coalesce(v_whatsapp, public.normalize_valid_br_phone(new.contact_phone));

    if v_phone is not null then
      new.contact_phone := v_phone;
      new.contact_whatsapp := v_whatsapp;
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'contact_phone_valid', true,
        'contact_phone_e164', v_phone
      );
    else
      new.contact_phone := null;
      new.contact_whatsapp := null;
      new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
        'contact_phone_valid', false
      );
    end if;
  end if;
  return new;
end;
$function$;
