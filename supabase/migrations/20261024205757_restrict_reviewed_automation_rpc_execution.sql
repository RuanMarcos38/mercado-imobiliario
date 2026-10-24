-- Each of these six bodies was inspected: global backend contact/message mutation, no tenant or caller authorization, no app client RPC references. Keep existing signatures, logic and service_role execution, and remove browser/public execution only.
revoke all on function public.r2r_processar_entrada(text,text,text,text,boolean,boolean,timestamp with time zone) from public,anon,authenticated;
grant execute on function public.r2r_processar_entrada(text,text,text,text,boolean,boolean,timestamp with time zone) to service_role;
revoke all on function public.r2r_registrar_followup(text,text,text) from public,anon,authenticated;
grant execute on function public.r2r_registrar_followup(text,text,text) to service_role;
revoke all on function public.r2r_registrar_prospeccao(text,text,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.r2r_registrar_prospeccao(text,text,text,text,text,text,integer) to service_role;
revoke all on function public.r2r_registrar_saida(text,text,text,text,text,text,boolean,integer) from public,anon,authenticated;
grant execute on function public.r2r_registrar_saida(text,text,text,text,text,text,boolean,integer) to service_role;
revoke all on function public.sdr_process_inbound(text,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.sdr_process_inbound(text,text,text,text,text,text,text,jsonb) to service_role;
revoke all on function public.sdr_save_ai_reply(text,text,text,text,jsonb,text,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.sdr_save_ai_reply(text,text,text,text,jsonb,text,boolean,text,jsonb) to service_role;
alter function public.sdr_process_inbound(text,text,text,text,text,text,text,jsonb) set search_path=public,pg_temp;
alter function public.sdr_save_ai_reply(text,text,text,text,jsonb,text,boolean,text,jsonb) set search_path=public,pg_temp;
notify pgrst,'reload schema';
