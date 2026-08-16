alter table public.property_source_catalog
  add column if not exists public_discovery_enabled boolean not null default false,
  add column if not exists public_discovery_mode text not null default 'disabled',
  add column if not exists official_integration_optional boolean not null default true,
  add column if not exists public_discovery_status text not null default 'idle',
  add column if not exists public_discovery_count integer not null default 0,
  add column if not exists last_public_discovery_at timestamptz;

alter table public.property_source_catalog drop constraint if exists property_source_catalog_public_discovery_mode_check;
alter table public.property_source_catalog add constraint property_source_catalog_public_discovery_mode_check
  check (public_discovery_mode in ('disabled','sitemap','web_search','hybrid'));

alter table public.property_source_catalog drop constraint if exists property_source_catalog_public_discovery_status_check;
alter table public.property_source_catalog add constraint property_source_catalog_public_discovery_status_check
  check (public_discovery_status in ('idle','ready','running','active','limited','blocked','error'));

update public.property_source_catalog
set
  public_discovery_enabled = case when code='caixa' then false else true end,
  public_discovery_mode = case
    when code='caixa' then 'disabled'
    when website_domain is not null then 'hybrid'
    else 'web_search'
  end,
  official_integration_optional = case when code='caixa' then false else true end,
  public_discovery_status = case when code='caixa' then 'active' else 'ready' end,
  status = case when code='caixa' then 'active' else 'ready' end,
  updated_at = now();

update public.property_source_catalog
set name='Descoberta Inteligente',
    integration_mode='public_web_discovery',
    website_domain=null,
    public_discovery_mode='web_search',
    notes='Descobre fontes e anúncios públicos sem contornar login, CAPTCHA, paywall ou áreas privadas. Integrações oficiais permanecem opcionais.',
    updated_at=now()
where code='google_discovery';

update public.property_source_catalog
set website_domain='inicioempreendimentos.com.br',
    public_discovery_mode='hybrid',
    notes='Descoberta pública de empreendimentos e páginas abertas; integração oficial é opcional quando disponível.',
    updated_at=now()
where code='inicio';

update public.property_source_catalog
set notes = case code
  when 'zap' then 'Descoberta pública de páginas abertas do ZAP; integração oficial/XML é opcional para inventário autorizado.'
  when 'vivareal' then 'Descoberta pública de páginas abertas do Viva Real; integração oficial/XML é opcional para inventário autorizado.'
  when 'olx' then 'Descoberta pública de páginas abertas da OLX; OAuth/API oficial é opcional para recursos autorizados.'
  when 'imovelweb' then 'Descoberta pública de páginas abertas do Imovelweb; parceria/feed oficial é opcional.'
  when 'quintoandar' then 'Descoberta pública de páginas abertas do QuintoAndar; integração oficial é opcional quando disponível.'
  when 'chavesnamao' then 'Descoberta pública de páginas abertas do Chaves na Mão; XML autorizado é opcional.'
  when 'netimoveis' then 'Descoberta pública de páginas abertas da Netimóveis; integração oficial é opcional.'
  when 'orulo' then 'Descoberta pública de páginas abertas da Órulo; API oficial é opcional para inventário autorizado.'
  when 'mrv' then 'Descoberta pública de empreendimentos e imóveis da MRV; feed/API oficial é opcional.'
  when 'rogga' then 'Descoberta pública de empreendimentos e imóveis da Rogga; feed/API oficial é opcional.'
  when 'rottas' then 'Descoberta pública de empreendimentos e imóveis da Rottas; feed/API oficial é opcional.'
  when 'canalpro' then 'Integração opcional para inventário autorizado do anunciante; ZAP, Viva Real e OLX também possuem descoberta pública separada.'
  when 'agency_feeds' then 'Descoberta de sites públicos de imobiliárias e conexão opcional por XML, JSON, API ou webhook.'
  else notes end,
  updated_at=now()
where code <> 'caixa';
