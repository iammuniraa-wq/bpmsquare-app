-- Fixes two storage-bucket gaps found in the 2026-07-25 security audit:
--
-- 1. company-assets' insert/delete policies (0014_storage_company_assets.sql)
--    only ever checked `bucket_id = 'company-assets'` -- never tenant identity.
--    The tenant-id folder prefix used by src/app/api/upload/route.ts is purely
--    an app-level convention; nothing stopped a tenant-A user from calling the
--    Storage API directly (their own real session, not through the app) and
--    overwriting or deleting tenant-B's logo objects. Tightened to match the
--    same tenant_users-membership check every other RLS policy in this repo
--    uses.
-- 2. The `logos` bucket (src/app/api/admin/upload-logo/route.ts) was created
--    ad-hoc via the dashboard with no tracked migration -- its existing
--    policies (if any) are unknown, so this drops whatever is there and
--    replaces it with policies matching the route's actual access model
--    (platform-admin-only writes; the route always uses the service-role
--    client gated by isPlatformAdmin() in app code -- direct end-user writes
--    via the anon key + session should never have been allowed at all).

drop policy if exists "tenant users can upload company assets" on storage.objects;
create policy "tenant users can upload company assets"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'company-assets'
    and (storage.foldername(name))[1] in (
      select tenant_id::text from tenant_users where user_id = auth.uid()
    )
  );

drop policy if exists "tenant users can delete company assets" on storage.objects;
create policy "tenant users can delete company assets"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'company-assets'
    and (storage.foldername(name))[1] in (
      select tenant_id::text from tenant_users where user_id = auth.uid()
    )
  );

-- "public can read company assets" (0014) is unchanged -- logos/certs need to
-- render on customer-facing quote PDFs, so public read is intentional.

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

-- Drop whatever ad-hoc policies exist on the logos bucket (names unknown --
-- never tracked in a migration) before recreating them correctly below.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (qual like '%''logos''%' or with_check like '%''logos''%')
  loop
    execute format('drop policy if exists %I on storage.objects', pol.policyname);
  end loop;
end $$;

create policy "logos: public read"
  on storage.objects for select
  to public
  using (bucket_id = 'logos');

create policy "logos: admin only write"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'logos' and exists (select 1 from platform_admins where user_id = auth.uid()));

create policy "logos: admin only delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'logos' and exists (select 1 from platform_admins where user_id = auth.uid()));
