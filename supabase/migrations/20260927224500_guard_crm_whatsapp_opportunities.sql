create or replace function public.crm_opportunity_from_whatsapp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_pipeline uuid;
  v_stage uuid;
  v_contact uuid;
  v_meta_phone_number_id text;
  v_meta_phone_number text;
  v_meta_provider_metadata jsonb;
  v_expected_phone text;
  v_actual_phone text;
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

  select coalesce(new.assigned_user_id, t.owner_user_id) into v_owner
  from public.tenants t
  where t.id = new.tenant_id;

  insert into public.crm_contacts(tenant_id,phone_e164,name,source,last_whatsapp_at)
  values(
    new.tenant_id,
    new.phone_e164,
    nullif(new.contact_name,''),
    'whatsapp',
    coalesce(new.last_message_at,new.created_at,now())
  )
  on conflict (tenant_id,phone_e164)
    where phone_e164 is not null and btrim(phone_e164)<>''
  do update set
    name=coalesce(nullif(excluded.name,''),public.crm_contacts.name),
    last_whatsapp_at=greatest(
      coalesce(public.crm_contacts.last_whatsapp_at,'-infinity'::timestamptz),
      coalesce(excluded.last_whatsapp_at,'-infinity'::timestamptz)
    ),
    updated_at=now()
  returning id into v_contact;

  select d.pipeline_id, d.initial_stage_id into v_pipeline, v_stage
  from public.crm_ensure_default_pipeline(new.tenant_id, v_owner) d;

  if v_pipeline is null or v_stage is null then return new; end if;

  insert into public.crm_opportunities(
    tenant_id,pipeline_id,stage_id,owner_user_id,conversation_id,contact_id,protocol_code,
    contact_name,contact_phone,source,notes,last_activity_at
  ) values (
    new.tenant_id,v_pipeline,v_stage,v_owner,new.id,v_contact,new.protocol_code,
    coalesce(nullif(new.contact_name,''),new.phone_e164),new.phone_e164,'whatsapp',
    nullif(new.last_message,''),coalesce(new.last_message_at,new.created_at,now())
  )
  on conflict (tenant_id,conversation_id) where conversation_id is not null
  do update set
    contact_id=coalesce(excluded.contact_id,public.crm_opportunities.contact_id),
    protocol_code=coalesce(excluded.protocol_code,public.crm_opportunities.protocol_code),
    contact_name=coalesce(nullif(excluded.contact_name,''),public.crm_opportunities.contact_name),
    contact_phone=coalesce(excluded.contact_phone,public.crm_opportunities.contact_phone),
    owner_user_id=coalesce(excluded.owner_user_id,public.crm_opportunities.owner_user_id),
    last_activity_at=greatest(
      coalesce(public.crm_opportunities.last_activity_at,'-infinity'::timestamptz),
      coalesce(excluded.last_activity_at,'-infinity'::timestamptz)
    ),
    updated_at=now();

  return new;
end;
$$;

revoke execute on function public.crm_opportunity_from_whatsapp() from public;
revoke execute on function public.crm_opportunity_from_whatsapp() from anon;
revoke execute on function public.crm_opportunity_from_whatsapp() from authenticated;
grant execute on function public.crm_opportunity_from_whatsapp() to service_role;
