insert into public.property_source_catalog(code,name,category,integration_mode,status,website_domain,supports_contacts,supports_updates,notes,public_discovery_enabled,public_discovery_mode,official_integration_optional,public_discovery_status)
values(
  'canalpro','Canal Pro (ZAP + Viva Real + OLX)','network','authorized_vrsync_feed','ready',
  'canalpro.grupozap.com',true,true,
  'Conector para XML VRSYNC autorizado da conta do anunciante; complementa a descoberta pública dos portais.',
  false,'disabled',true,'ready'
)
on conflict(code) do update set
  name=excluded.name,category=excluded.category,integration_mode=excluded.integration_mode,status=excluded.status,
  website_domain=excluded.website_domain,supports_contacts=excluded.supports_contacts,
  supports_updates=excluded.supports_updates,notes=excluded.notes,updated_at=now();
