-- Camada aditiva de histórico, pesquisa de satisfação e relatórios de atendimento.
-- Não altera nem remove estruturas atuais.

create table if not exists public.attendance_satisfaction_surveys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  session_id uuid not null,
  attendant_user_id uuid,
  protocol_code text not null default '',
  rating smallint,
  status text not null default 'queued',
  requested_at timestamptz,
  responded_at timestamptz,
  request_message_id text,
  response_message_id text,
  response_text text,
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_satisfaction_rating_check check (rating is null or rating between 1 and 5),
  constraint attendance_satisfaction_status_check check (status in ('queued','sending','sent','answered','failed')),
  constraint attendance_satisfaction_session_unique unique (tenant_id, session_id)
);

create index if not exists attendance_satisfaction_tenant_requested_idx
  on public.attendance_satisfaction_surveys (tenant_id, requested_at desc nulls last);
create index if not exists attendance_satisfaction_conversation_idx
  on public.attendance_satisfaction_surveys (tenant_id, conversation_id, created_at desc);
create index if not exists attendance_satisfaction_queue_idx
  on public.attendance_satisfaction_surveys (status, next_attempt_at)
  where rating is null and status in ('queued','failed');

alter table public.attendance_satisfaction_surveys enable row level security;

drop policy if exists attendance_satisfaction_read_member on public.attendance_satisfaction_surveys;
create policy attendance_satisfaction_read_member
  on public.attendance_satisfaction_surveys
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tenant_members tm
      where tm.tenant_id = attendance_satisfaction_surveys.tenant_id
        and tm.user_id = auth.uid()
    )
  );

grant select on public.attendance_satisfaction_surveys to authenticated;

-- Apenas o backend/service role usa esta tabela. O segredo real nunca é armazenado aqui.
create table if not exists public.attendance_survey_job_config (
  id text primary key default 'default',
  token_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.attendance_survey_job_config enable row level security;
revoke all on public.attendance_survey_job_config from anon, authenticated;

create or replace function public.queue_attendance_satisfaction_survey()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_conversation_id uuid;
  v_attendant_user_id uuid;
  v_protocol_code text := '';
begin
  if new.event_type <> 'attendance_session_closed' then
    return new;
  end if;

  begin
    v_session_id := nullif(new.metadata->>'sessionId', '')::uuid;
    v_conversation_id := nullif(new.metadata->>'conversationId', '')::uuid;
    v_attendant_user_id := nullif(new.metadata->>'userId', '')::uuid;
  exception when others then
    return new;
  end;

  if v_session_id is null or v_conversation_id is null then
    return new;
  end if;

  select coalesce(wc.protocol_code, '')
    into v_protocol_code
  from public.whatsapp_conversations wc
  where wc.id = v_conversation_id
    and wc.tenant_id = new.tenant_id;

  insert into public.attendance_satisfaction_surveys (
    tenant_id,
    conversation_id,
    session_id,
    attendant_user_id,
    protocol_code,
    status,
    next_attempt_at,
    created_at,
    updated_at
  ) values (
    new.tenant_id,
    v_conversation_id,
    v_session_id,
    v_attendant_user_id,
    coalesce(v_protocol_code, ''),
    'queued',
    now(),
    coalesce(new.created_at, now()),
    now()
  )
  on conflict (tenant_id, session_id) do nothing;

  return new;
end;
$$;

revoke all on function public.queue_attendance_satisfaction_survey() from public;

-- Reaplica o trigger de forma idempotente.
drop trigger if exists trg_queue_attendance_satisfaction_survey on public.system_events;
create trigger trg_queue_attendance_satisfaction_survey
  after insert on public.system_events
  for each row
  when (new.event_type = 'attendance_session_closed')
  execute function public.queue_attendance_satisfaction_survey();

-- Gera uma credencial interna exclusiva sem expor o valor no repositório.
do $$
declare
  v_secret text;
  v_hash text;
begin
  select decrypted_secret
    into v_secret
  from vault.decrypted_secrets
  where name = 'mercadoimobi_attendance_survey_job_secret'
  order by created_at desc
  limit 1;

  if coalesce(v_secret, '') = '' then
    v_secret := encode(gen_random_bytes(32), 'hex');
    perform vault.create_secret(
      v_secret,
      'mercadoimobi_attendance_survey_job_secret',
      'Job interno para envio de pesquisa de satisfação do atendimento'
    );
  end if;

  v_hash := encode(digest(v_secret, 'sha256'), 'hex');
  insert into public.attendance_survey_job_config (id, token_hash, updated_at)
  values ('default', v_hash, now())
  on conflict (id) do update
    set token_hash = excluded.token_hash,
        updated_at = excluded.updated_at;
end;
$$;

-- Executa o despachante a cada minuto usando o segredo diretamente do Vault.
-- O segredo não aparece no código nem na URL.
do $$
begin
  perform cron.unschedule('mercadoimobi-attendance-satisfaction-dispatch');
exception when others then
  null;
end;
$$;

select cron.schedule(
  'mercadoimobi-attendance-satisfaction-dispatch',
  '* * * * *',
  $cron$
    select (extensions.http((
      'POST',
      'https://r2rmarketingdigital-mercadomobi.ke4n49.easypanel.host/api/public/jobs/attendance-surveys',
      array[
        ('Content-Type','application/json')::extensions.http_header,
        (
          'x-attendance-survey-key',
          (select decrypted_secret
             from vault.decrypted_secrets
            where name = 'mercadoimobi_attendance_survey_job_secret'
            order by created_at desc
            limit 1)
        )::extensions.http_header
      ],
      'application/json',
      '{}'
    )::extensions.http_request)).status;
  $cron$
);