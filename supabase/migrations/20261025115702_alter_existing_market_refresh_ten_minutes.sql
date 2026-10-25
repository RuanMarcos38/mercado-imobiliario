-- Change only the existing MercadoImobi market-index schedule; never create a second job.
do $migration$
declare target_job bigint;
begin
  if (select count(*) from cron.job where jobname='mercadoimobi-refresh-public-index') <> 1 then
    raise exception 'Expected exactly one existing market refresh job';
  end if;
  select jobid into target_job from cron.job where jobname='mercadoimobi-refresh-public-index';
  perform cron.alter_job(target_job, schedule := '*/10 * * * *');
end;
$migration$;
