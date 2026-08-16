-- Restrict the tracked CAIXA refresh to trusted server-side execution only.
-- The function is SECURITY DEFINER and performs network/database writes, so it
-- must not be directly executable by PUBLIC, anon, or authenticated roles.

revoke all on function public.refresh_caixa_property_index_tracked() from public, anon, authenticated;
grant execute on function public.refresh_caixa_property_index_tracked() to service_role;
