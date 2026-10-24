-- Keep the existing signed ingestion endpoint compatible with the current inbox.
-- This view is an internal adapter, not a second lead store or a public API.
create view public.leads with (security_invoker = true) as
select id, tenant_id, owner_user_id as user_id,
       contact_name as client_name, contact_email as client_email,
       contact_phone as client_phone,
       case status when 'new' then 'novo' else status end as status,
       notes as ai_qualification_notes, created_at, updated_at
from public.crm_lead_inbox;

revoke all on public.leads from public, anon, authenticated;
grant select, insert on public.leads to service_role;

create function public.insert_lead_webhook_into_inbox()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_existing public.crm_lead_inbox%rowtype;
  v_created public.crm_lead_inbox%rowtype;
  v_conversation uuid;
  v_marker text;
  v_source text;
  v_meta jsonb := '{}'::jsonb;
  v_json text;
begin
  if new.tenant_id is null or new.user_id is null or
     not exists (
       select 1 from public.tenant_members tm
       join public.profiles p on p.id = tm.user_id
       where tm.tenant_id = new.tenant_id and tm.user_id = new.user_id
         and p.is_active and p.user_type not in ('cliente', 'proprietario')
     ) then
    raise exception 'Invalid lead assignment';
  end if;
  if coalesce(nullif(btrim(new.client_phone), ''), nullif(btrim(new.client_email), '')) is null then
    raise exception 'Lead contact required';
  end if;
  v_marker := substring(new.ai_qualification_notes from '\[mi-lead:([a-f0-9]{32})\]');
  if v_marker is null then raise exception 'Lead ingestion identity required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    new.tenant_id::text || ':' || coalesce(nullif(new.client_phone, ''), lower(new.client_email)), 0));

  -- Reuse an existing inbox contact without resetting qualification or ownership.
  select * into v_existing from public.crm_lead_inbox i
  where i.tenant_id = new.tenant_id and (
    position('[mi-lead:' || v_marker || ']' in coalesce(i.notes, '')) > 0
    or (nullif(new.client_phone, '') is not null and i.contact_phone = new.client_phone)
    or (nullif(new.client_email, '') is not null and lower(i.contact_email) = lower(new.client_email))
  ) order by i.created_at limit 1 for update;
  if found then
    if position('[mi-lead:' || v_marker || ']' in coalesce(v_existing.notes, '')) = 0 then
      update public.crm_lead_inbox
      set notes = concat_ws(E'\n\n', nullif(notes, ''), new.ai_qualification_notes),
          contact_email = coalesce(contact_email, nullif(new.client_email, '')),
          updated_at = now()
      where id = v_existing.id and tenant_id = new.tenant_id;
    end if;
    new.id := v_existing.id;
    new.user_id := coalesce(v_existing.owner_user_id, new.user_id);
    return new;
  end if;

  v_source := coalesce(nullif(btrim(substring(new.ai_qualification_notes from 'Origem: ([^\n]+)')), ''), 'google');
  v_json := substring(new.ai_qualification_notes from 'Observações: (\{[^\n]*\})');
  if v_json is not null then
    begin v_meta := v_json::jsonb; exception when invalid_text_representation then v_meta := '{}'::jsonb; end;
  end if;

  -- Prepare a conversation without sending messages or enabling AI on an import.
  if nullif(new.client_phone, '') is not null then
    select id into v_conversation from public.whatsapp_conversations
      where tenant_id = new.tenant_id and phone_e164 = new.client_phone limit 1;
    if v_conversation is null then
      insert into public.whatsapp_conversations
        (tenant_id, assigned_user_id, phone_e164, contact_name, last_message,
         last_message_at, unread_count, ai_enabled)
      values
        (new.tenant_id, new.user_id, new.client_phone, new.client_name,
         'Contato importado aguardando atendimento', now(), 0, false)
      on conflict (tenant_id, phone_e164) do nothing
      returning id into v_conversation;
      if v_conversation is null then
        select id into v_conversation from public.whatsapp_conversations
          where tenant_id = new.tenant_id and phone_e164 = new.client_phone limit 1;
      end if;
    end if;
  end if;

  -- Some installations already populate the inbox from the conversation trigger.
  select * into v_existing from public.crm_lead_inbox
    where tenant_id = new.tenant_id and conversation_id = v_conversation limit 1 for update;
  if found then
    update public.crm_lead_inbox
      set contact_email = coalesce(contact_email, nullif(new.client_email, '')),
          notes = concat_ws(E'\n\n', nullif(notes, ''), new.ai_qualification_notes),
          source = v_source, updated_at = now()
      where id = v_existing.id and tenant_id = new.tenant_id
      returning * into v_created;
  else
    insert into public.crm_lead_inbox
      (tenant_id, owner_user_id, conversation_id, contact_name, contact_phone,
       contact_email, source, status, city, property_type, interest, notes)
    values
      (new.tenant_id, new.user_id, v_conversation, new.client_name,
       nullif(new.client_phone, ''), nullif(new.client_email, ''), v_source, 'new',
       nullif(v_meta->>'cidade', ''), nullif(v_meta->>'tipo_imovel', ''),
       nullif(v_meta->>'evidencia_intencao', ''), new.ai_qualification_notes)
    returning * into v_created;
  end if;
  new.id := v_created.id;
  new.created_at := v_created.created_at;
  new.updated_at := v_created.updated_at;
  return new;
end;
$$;

revoke all on function public.insert_lead_webhook_into_inbox() from public, anon, authenticated;
grant execute on function public.insert_lead_webhook_into_inbox() to service_role;
create trigger lead_webhook_inbox_insert
instead of insert on public.leads
for each row execute function public.insert_lead_webhook_into_inbox();
notify pgrst, 'reload schema';

