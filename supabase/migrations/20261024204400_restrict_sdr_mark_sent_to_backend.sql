-- Validated individually: source only updates backend sdr_contacts; no application client calls this RPC. Observed matching automation RPC traffic uses service_role. Preserve service_role and the body; remove unnecessary public execution.
revoke all on function public.sdr_mark_sent(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.sdr_mark_sent(text,text,jsonb) to service_role;
alter function public.sdr_mark_sent(text,text,jsonb) set search_path=public,pg_temp;
notify pgrst,'reload schema';
