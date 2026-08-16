create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_slug text;
  v_tenant_id uuid;
  v_user_type public.user_type;
begin
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    split_part(new.email, '@', 1)
  );

  v_user_type := case
    when new.raw_user_meta_data->>'user_type' = 'corretor' then 'corretor'::public.user_type
    else 'cliente'::public.user_type
  end;

  v_slug := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  if v_slug is null or v_slug = '' then
    v_slug := 'conta';
  end if;
  v_slug := v_slug || '-' || substr(replace(new.id::text, '-', ''), 1, 8);

  insert into public.tenants (name, slug)
  values (v_name, v_slug)
  returning id into v_tenant_id;

  insert into public.profiles (id, full_name, user_type, company_name, tenant_id)
  values (new.id, new.raw_user_meta_data->>'full_name', v_user_type, null, v_tenant_id);

  insert into public.tenant_members (tenant_id, user_id, member_role)
  values (v_tenant_id, new.id, 'owner')
  on conflict (tenant_id, user_id) do nothing;

  return new;
end;
$$;
