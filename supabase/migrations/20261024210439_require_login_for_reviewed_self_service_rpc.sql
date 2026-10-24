-- Individually reviewed: affiliate functions already reject any user ID different from auth.uid(), except the service role. Capacity derives its tenant exclusively from auth.uid(). Their registered-user/server APIs remain intact; anonymous execution is unnecessary.
revoke all on function public.affiliate_network_stats(uuid) from public,anon;
grant execute on function public.affiliate_network_stats(uuid) to authenticated,service_role;
revoke all on function public.affiliate_set_sponsor(uuid,text) from public,anon;
grant execute on function public.affiliate_set_sponsor(uuid,text) to authenticated,service_role;
revoke all on function public.get_my_tenant_user_capacity() from public,anon;
grant execute on function public.get_my_tenant_user_capacity() to authenticated,service_role;
notify pgrst,'reload schema';
