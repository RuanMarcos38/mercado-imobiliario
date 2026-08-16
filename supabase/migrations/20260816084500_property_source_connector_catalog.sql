-- MercadoImobi: source catalog should distinguish a prepared connector from
-- an actually connected inventory. Portal-wide inventory is never marked active
-- without a real authorized data connection.

insert into public.property_source_catalog(
  code,name,category,integration_mode,status,website_domain,
  supports_contacts,supports_updates,notes
) values (
  'canalpro',
  'Canal Pro (ZAP + Viva Real + OLX)',
  'network',
  'authorized_vrsync_feed',
  'ready',
  'canalpro.grupozap.com',
  true,
  true,
  'Conector para XML VRSYNC autorizado da conta do anunciante. Sincroniza o inventário fornecido pelo integrador; não representa o inventário público completo dos portais.'
)
on conflict(code) do update set
  name=excluded.name,
  category=excluded.category,
  integration_mode=excluded.integration_mode,
  status=excluded.status,
  website_domain=excluded.website_domain,
  supports_contacts=excluded.supports_contacts,
  supports_updates=excluded.supports_updates,
  notes=excluded.notes,
  updated_at=now();

update public.property_source_catalog
set notes='O site público pode ser monitorado. Para trazer inventário do portal para o MercadoImobi é necessária uma integração ou parceria de dados autorizada. O Canal Pro atende ao inventário do próprio anunciante via XML.',
    updated_at=now()
where code in ('olx','zap','vivareal');

update public.property_source_catalog
set notes='API oficial Órulo preparada para integração mediante client_id/client_secret e escopo contratado. Dados restritos devem respeitar as regras de autenticação da Órulo.',
    updated_at=now()
where code='orulo';

update public.property_source_catalog
set notes='Conector preparado para feed/API autorizado da construtora. O site público é monitorado separadamente da conexão de inventário.',
    updated_at=now()
where code in ('mrv','rogga','rottas','inicio');
