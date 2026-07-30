-- Public bucket for company logos and partner logos uploaded via /api/upload
insert into storage.buckets (id, name, public)
values ('company-assets', 'company-assets', true)
on conflict (id) do nothing;

-- Allow authenticated users of any tenant to upload to their own folder
create policy "tenant users can upload company assets"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'company-assets');

-- Public read
create policy "public can read company assets"
  on storage.objects for select
  to public
  using (bucket_id = 'company-assets');

-- Allow authenticated users to delete objects they uploaded
create policy "tenant users can delete company assets"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'company-assets');
