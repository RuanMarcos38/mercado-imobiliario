create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  tagline text not null default '',
  description text not null default '',
  price_monthly numeric(10,2) not null default 0,
  onboarding_fee numeric(10,2) not null default 0,
  user_limit integer not null default 1 check (user_limit > 0),
  whatsapp_connections integer not null default 0 check (whatsapp_connections >= 0),
  ai_interactions_monthly integer not null default 0 check (ai_interactions_monthly >= 0),
  storage_gb integer not null default 1 check (storage_gb >= 0),
  feature_keys text[] not null default '{}'::text[],
  highlights text[] not null default '{}'::text[],
  badge text,
  is_recommended boolean not null default false,
  is_public boolean not null default true,
  is_self_service boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  stripe_price_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions
  add column if not exists plan_id uuid references public.subscription_plans(id) on delete set null;
create index if not exists subscriptions_plan_id_idx on public.subscriptions(plan_id);

insert into public.platform_features(feature_key,label,description,route_prefix,default_allowed,sort_order) values
('buscar','Buscar imóveis','Pesquisa imobiliária nacional.','/buscar',true,11),
('leiloes','Leilões CAIXA','Pesquisa e oportunidades CAIXA.','/leiloes',true,12),
('central_integracoes','Central de Integrações','Google, API aberta e conectores por usuário.','/central-integracoes',true,51),
('agenda','Agenda e Google Meet','Agenda de atendimento e reuniões.','/agenda',true,52),
('api','API aberta','Tokens e endpoints individuais por usuário.','/central-integracoes',true,53),
('google_drive','Google Drive','Backup e arquivos no Drive.','/central-integracoes',true,54),
('cca','Integração CCA','Fluxo documental com CCA homologado.','/central-integracoes',true,55),
('discador','Telefonia e Discador','Recursos de telefonia e discagem.','/discador',true,71)
on conflict (feature_key) do update set
  label=excluded.label,
  description=excluded.description,
  route_prefix=excluded.route_prefix,
  sort_order=excluded.sort_order;

insert into public.subscription_plans(
  slug,name,tagline,description,price_monthly,onboarding_fee,user_limit,
  whatsapp_connections,ai_interactions_monthly,storage_gb,feature_keys,highlights,
  badge,is_recommended,is_public,is_self_service,sort_order
)
values
('start','Corretor Start','Organização comercial para começar a vender mais','Plano essencial para o corretor organizar imóveis, oportunidades, alertas e rotina comercial.',197,297,1,0,0,5,
 array['dashboard','buscar','leiloes','alertas','crm','simulador','afiliados'],
 array['Busca e timeline de imóveis','CRM e Pipeline imobiliário','Alertas e follow-ups','Leilões CAIXA','Simulador de financiamento','Afiliados / Wallet','1 usuário'],null,false,true,true,10),
('pro_ia','Corretor Pro IA','Atendimento, IA e automação em um único plano','Plano principal para corretor que quer automatizar atendimento e integrar sua operação.',397,497,1,1,3000,20,
 array['dashboard','buscar','leiloes','alertas','crm','simulador','afiliados','atendimento','assistente','analise_localizacao','central_integracoes','agenda','api','google_drive'],
 array['Tudo do Start','WhatsApp e atendimento centralizado','Agente de IA','Agenda e Google Meet','Central de Integrações e API','Google Drive','Análise de localização','3.000 interações de IA/mês','1 conexão WhatsApp'],
 'Mais escolhido',true,true,true,20),
('equipe','Equipe','Gestão comercial e atendimento para times','Para pequenas equipes com distribuição de atendimento, integrações e inteligência operacional.',697,997,5,2,10000,50,
 array['dashboard','buscar','leiloes','alertas','crm','simulador','afiliados','atendimento','assistente','analise_localizacao','central_integracoes','agenda','api','google_drive','discador','midias','cca'],
 array['Tudo do Pro IA','Até 5 usuários','Distribuição de atendimento','10.000 interações de IA/mês','2 conexões WhatsApp','Mídias sociais e discador','Integração CCA quando homologada','Permissões por usuário'],
 'Para equipes',false,true,true,30),
('imobiliaria','Imobiliária','Operação completa para imobiliárias','Estrutura avançada para gestão de equipe, CRM, atendimento, integrações e alto volume.',1297,1997,15,5,30000,200,
 array['dashboard','buscar','leiloes','alertas','crm','simulador','afiliados','atendimento','assistente','analise_localizacao','central_integracoes','agenda','api','google_drive','discador','midias','cca'],
 array['Tudo do Equipe','Até 15 usuários','30.000 interações de IA/mês','Até 5 conexões WhatsApp','200 GB de armazenamento','Automação e API avançadas','Gestão de permissões','Relatórios gerenciais'],
 'Escala',false,true,true,40),
('enterprise','Enterprise','Para grandes operações e redes','Plano sob medida para franquias, construtoras e operações com requisitos especiais.',2497,0,50,10,100000,500,
 array['dashboard','buscar','leiloes','alertas','crm','simulador','afiliados','atendimento','assistente','analise_localizacao','central_integracoes','agenda','api','google_drive','discador','midias','cca'],
 array['Tudo do Imobiliária','Até 50 usuários incluídos','100.000 interações de IA/mês','Até 10 conexões WhatsApp','500 GB de armazenamento','Prioridade de suporte','Integrações personalizadas','Implantação sob proposta'],
 'Sob medida',false,true,false,50),
('legacy_full','Legado completo','Preserva os acessos existentes','Plano interno para preservar acessos anteriores à implantação dos planos comerciais.',0,0,999,999,999999,999,
 array['dashboard','buscar','leiloes','alertas','crm','simulador','afiliados','atendimento','assistente','analise_localizacao','central_integracoes','agenda','api','google_drive','discador','midias','cca'],
 array[]::text[],null,false,false,false,999)
on conflict (slug) do update set
  name=excluded.name,
  tagline=excluded.tagline,
  description=excluded.description,
  price_monthly=excluded.price_monthly,
  onboarding_fee=excluded.onboarding_fee,
  user_limit=excluded.user_limit,
  whatsapp_connections=excluded.whatsapp_connections,
  ai_interactions_monthly=excluded.ai_interactions_monthly,
  storage_gb=excluded.storage_gb,
  feature_keys=excluded.feature_keys,
  highlights=excluded.highlights,
  badge=excluded.badge,
  is_recommended=excluded.is_recommended,
  is_public=excluded.is_public,
  is_self_service=excluded.is_self_service,
  is_active=true,
  sort_order=excluded.sort_order,
  updated_at=now();

update public.subscriptions s
set plan_id = p.id, updated_at = now()
from public.subscription_plans p
where s.plan_id is null and p.slug='legacy_full';

alter table public.subscription_plans enable row level security;
drop policy if exists subscription_plans_read_active on public.subscription_plans;
create policy subscription_plans_read_active
on public.subscription_plans for select to authenticated
using (
  is_active = true and (
    is_public = true or exists(
      select 1 from public.user_roles ur
      where ur.user_id=auth.uid() and ur.role='admin'
    )
  )
);

grant select on public.subscription_plans to authenticated;

create or replace function public.user_has_plan_feature(p_user_id uuid, p_feature_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_override boolean;
  v_override_exists boolean;
  v_plan_features text[];
begin
  select exists(select 1 from public.user_roles where user_id=p_user_id and role='admin') into v_admin;
  if v_admin then return true; end if;

  select allowed, true into v_override, v_override_exists
  from public.user_feature_access
  where user_id=p_user_id and feature_key=p_feature_key
  limit 1;
  if coalesce(v_override_exists,false) then return v_override; end if;

  select sp.feature_keys into v_plan_features
  from public.subscriptions s
  left join public.subscription_plans sp on sp.id=s.plan_id
  where s.user_id=p_user_id and s.status in ('active','trialing')
  order by s.created_at desc
  limit 1;

  if v_plan_features is null then
    return coalesce((select default_allowed from public.platform_features where feature_key=p_feature_key), true);
  end if;
  return p_feature_key = any(v_plan_features);
end;
$$;

revoke all on function public.user_has_plan_feature(uuid,text) from public;
grant execute on function public.user_has_plan_feature(uuid,text) to authenticated;
