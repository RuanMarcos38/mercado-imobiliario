create index if not exists idx_property_search_state_city
on public.property_search_index(location_state, location_city);

create index if not exists idx_property_search_type
on public.property_search_index(property_type);

create index if not exists idx_property_search_price
on public.property_search_index(price);

create index if not exists idx_property_search_area
on public.property_search_index(area_sqm);

create index if not exists idx_property_search_bed_bath
on public.property_search_index(bedrooms, bathrooms);

create index if not exists idx_property_search_source
on public.property_search_index(source_portal);

create index if not exists idx_property_search_scanned
on public.property_search_index(scanned_at desc);
