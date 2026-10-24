-- These six functions return trigger, not an RPC result. They are referenced by existing triggers, and no app client invokes them as an RPC. PostgreSQL invokes existing triggers without requiring callers to hold direct EXECUTE on their function. Preserve the trigger definitions, bodies, owners, and service_role grant.
revoke all on function public.attendance_auto_distribute_new_conversation() from public,anon,authenticated;
grant execute on function public.attendance_auto_distribute_new_conversation() to service_role;
revoke all on function public.crm_schedule_stage_actions() from public,anon,authenticated;
grant execute on function public.crm_schedule_stage_actions() to service_role;
revoke all on function public.enforce_tenant_plan_user_limit() from public,anon,authenticated;
grant execute on function public.enforce_tenant_plan_user_limit() to service_role;
revoke all on function public.handle_affiliate_new_user() from public,anon,authenticated;
grant execute on function public.handle_affiliate_new_user() to service_role;
revoke all on function public.queue_attendance_satisfaction_survey() from public,anon,authenticated;
grant execute on function public.queue_attendance_satisfaction_survey() to service_role;
revoke all on function public.touch_whatsapp_conversation_message_direction() from public,anon,authenticated;
grant execute on function public.touch_whatsapp_conversation_message_direction() to service_role;
notify pgrst,'reload schema';
