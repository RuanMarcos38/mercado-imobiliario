create table public.whatsapp_contact_permissions (
 tenant_id uuid not null references public.tenants(id),
 phone_e164 text not null check (phone_e164 ~ '^55[1-9][0-9]{9,10}$'),
 allowed boolean not null default false,
 consent_at timestamptz,
 evidence_url text,
 evidence_text text,
 verified_whatsapp_at timestamptz,
 validated_by uuid references auth.users(id),
 validated_at timestamptz,
 revoked_at timestamptz,
 primary key(tenant_id,phone_e164),
 check (not allowed or (consent_at is not null and evidence_url ~ '^https?://' and length(trim(evidence_text)) > 0 and verified_whatsapp_at is not null and validated_by is not null and validated_at is not null and revoked_at is null))
);
alter table public.whatsapp_contact_permissions enable row level security;
revoke all on public.whatsapp_contact_permissions from public,anon,authenticated;
grant select,insert,update on public.whatsapp_contact_permissions to service_role;

create table public.whatsapp_initial_outreach (
 tenant_id uuid not null references public.tenants(id),
 phone_e164 text not null check (phone_e164 ~ '^55[1-9][0-9]{9,10}$'),
 purpose text not null check(purpose='joinville_mcmv_presentation'),
 reservation_id uuid not null default gen_random_uuid(),
 template_name text not null,
 status text not null default 'reserved' check(status in ('reserved','sent','uncertain','blocked')),
 external_message_id text,
 consent_snapshot jsonb not null,
 created_at timestamptz not null default now(),
 sent_at timestamptz,
 primary key(tenant_id,phone_e164,purpose),
 unique(reservation_id)
);
alter table public.whatsapp_initial_outreach enable row level security;
revoke all on public.whatsapp_initial_outreach from public,anon,authenticated;
grant select,insert,update on public.whatsapp_initial_outreach to service_role;

create function public.reserve_whatsapp_initial_outreach(p_tenant_id uuid,p_phone text,p_template text)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_permission public.whatsapp_contact_permissions; v_id uuid;
begin
 select * into v_permission from public.whatsapp_contact_permissions
 where tenant_id=p_tenant_id and phone_e164=p_phone for update;
 if not found or not v_permission.allowed or v_permission.revoked_at is not null then
   raise exception 'CONTACT_PERMISSION_REQUIRED';
 end if;
 insert into public.whatsapp_initial_outreach(tenant_id,phone_e164,purpose,template_name,consent_snapshot)
 values(p_tenant_id,p_phone,'joinville_mcmv_presentation',p_template,to_jsonb(v_permission))
 on conflict(tenant_id,phone_e164,purpose) do nothing returning reservation_id into v_id;
 return v_id;
end;
$$;
revoke all on function public.reserve_whatsapp_initial_outreach(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_whatsapp_initial_outreach(uuid,text,text) to service_role;
