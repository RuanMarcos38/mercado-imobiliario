-- Reviewed individually. buscar_historico_conversa reads private contact history without any caller/tenant predicate; there are no client RPC references. r2r_listar_followups reads global contacts and writes locks; observed pg_stat_statements traffic for it is service_role (2 calls), and there are no app client references. Their bodies and service-role access remain unchanged.
revoke all on function public.buscar_historico_conversa(uuid,integer) from public,anon,authenticated;
grant execute on function public.buscar_historico_conversa(uuid,integer) to service_role;
revoke all on function public.r2r_listar_followups(integer) from public,anon,authenticated;
grant execute on function public.r2r_listar_followups(integer) to service_role;
notify pgrst,'reload schema';
