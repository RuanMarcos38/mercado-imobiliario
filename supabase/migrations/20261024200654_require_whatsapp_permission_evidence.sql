alter table public.whatsapp_contact_permissions add constraint whatsapp_contact_permission_evidence_required check (not allowed or (evidence_url is not null and evidence_text is not null));
