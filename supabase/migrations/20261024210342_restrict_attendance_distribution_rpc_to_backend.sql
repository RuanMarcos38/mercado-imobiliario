-- Individually traced: attendance-center.functions.ts calls this via adminDb(); whatsapp-flow-runtime.server.ts is called from the trusted webhook. Keep backend access and the body unchanged.
revoke all on function public.attendance_distribute_conversation(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.attendance_distribute_conversation(uuid,uuid,boolean) to service_role;
notify pgrst,'reload schema';
