-- Restrict legacy privileged functions so browser roles cannot invoke them directly.
revoke execute on function public.archive_old_audit_logs(integer) from public, anon, authenticated;
revoke execute on function public.check_auth_failures() from public, anon, authenticated;
revoke execute on function public.check_high_fraud_alert() from public, anon, authenticated;
revoke execute on function public.check_rate_limit(text) from public, anon, authenticated;
revoke execute on function public.generate_retention_report(integer) from public, anon, authenticated;
revoke execute on function public.get_audit_logs_csv(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.refresh_search_cache() from public, anon, authenticated;
revoke execute on function public.set_tenant_id_from_current_user() from public, anon, authenticated;

-- RLS helper functions are available only to signed-in users.
revoke execute on function public.current_tenant_id() from public, anon;
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
revoke execute on function public.is_tenant_member(uuid) from public, anon;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.is_tenant_member(uuid) to authenticated;

-- search_index_health intentionally remains callable by anon/authenticated because it
-- returns aggregate availability only and is used by the public healthcheck.
