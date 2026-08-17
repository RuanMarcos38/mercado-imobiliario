insert into storage.buckets (id, name, public, file_size_limit)
values ('cca-documents','cca-documents',false,12582912)
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit;

drop policy if exists "cca documents read own" on storage.objects;
create policy "cca documents read own" on storage.objects for select to authenticated using (bucket_id='cca-documents' and (storage.foldername(name))[2]=auth.uid()::text);

drop policy if exists "cca documents insert own" on storage.objects;
create policy "cca documents insert own" on storage.objects for insert to authenticated with check (bucket_id='cca-documents' and (storage.foldername(name))[2]=auth.uid()::text);

drop policy if exists "cca documents update own" on storage.objects;
create policy "cca documents update own" on storage.objects for update to authenticated using (bucket_id='cca-documents' and (storage.foldername(name))[2]=auth.uid()::text) with check (bucket_id='cca-documents' and (storage.foldername(name))[2]=auth.uid()::text);

drop policy if exists "cca documents delete own" on storage.objects;
create policy "cca documents delete own" on storage.objects for delete to authenticated using (bucket_id='cca-documents' and (storage.foldername(name))[2]=auth.uid()::text);
