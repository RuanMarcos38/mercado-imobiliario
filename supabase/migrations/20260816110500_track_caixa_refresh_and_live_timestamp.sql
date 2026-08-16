-- MercadoImobi: registra a sincronizacao real da CAIXA e historico de varreduras.
-- Esta migracao pertence somente ao banco Casa Conectada / MercadoImobi.

create or replace function public.refresh_caixa_property_index_tracked()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_started timestamptz := now();
  v_result jsonb;
  v_finished timestamptz;
  v_count integer;
begin
  v_result := public.refresh_caixa_property_index();
  v_finished := now();

  -- scanned_at representa quando o MercadoImobi confirmou a disponibilidade
  -- do anuncio na fonte, nao a data original informada pelo portal.
  update public.property_search_index
  set scanned_at = v_finished
  where source_portal = 'Imóveis CAIXA';

  select count(*) into v_count
  from public.property_search_index
  where source_portal = 'Imóveis CAIXA';

  insert into public.property_scan_runs (
    source_code,
    status,
    discovered_count,
    inserted_count,
    updated_count,
    removed_count,
    started_at,
    finished_at,
    created_at
  ) values (
    'caixa',
    'success',
    coalesce((v_result->>'source_count')::integer, v_count),
    0,
    coalesce((v_result->>'upserted')::integer, v_count),
    coalesce((v_result->>'removed')::integer, 0),
    v_started,
    v_finished,
    v_finished
  );

  return v_result || jsonb_build_object(
    'indexed_count', v_count,
    'last_sync_at', v_finished
  );
exception when others then
  insert into public.property_scan_runs (
    source_code,
    status,
    discovered_count,
    inserted_count,
    updated_count,
    removed_count,
    error_summary,
    started_at,
    finished_at,
    created_at
  ) values (
    'caixa',
    'failed',
    0,
    0,
    0,
    0,
    left(sqlerrm, 500),
    v_started,
    now(),
    now()
  );
  raise;
end;
$$;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'refresh-caixa-property-index'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'refresh-caixa-property-index',
    '45 * * * *',
    'select public.refresh_caixa_property_index_tracked();'
  );
end;
$$;
