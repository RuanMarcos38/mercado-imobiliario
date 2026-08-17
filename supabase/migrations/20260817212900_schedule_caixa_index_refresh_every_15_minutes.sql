create extension if not exists pg_cron with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mercadoimobi-refresh-caixa-index') then
    perform cron.unschedule((select jobid from cron.job where jobname = 'mercadoimobi-refresh-caixa-index' limit 1));
  end if;
end $$;

select cron.schedule(
  'mercadoimobi-refresh-caixa-index',
  '*/15 * * * *',
  $$select public.refresh_caixa_property_index();$$
);
