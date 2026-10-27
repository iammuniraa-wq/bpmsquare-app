-- bootstrap.sql -- the minimum rows a NEW dedicated BPMSquare database needs before the first login.
--
-- Run AFTER dist/dedicated/fresh-schema.sql (see docs/dedicated-instance.md step 4) and BEFORE the first sign-in.
-- Nothing in this file is tenant-specific. The client's workspace is created afterwards through the Tenant Creation
-- Studio (/admin/tenant-studio), never by SQL (TENANT_PROVISIONING.md section 1).
--
-- NO CREDENTIALS BELONG IN THIS FILE. The only value to edit is the operator's e-mail address (one place, below).
-- The operator's password is set in the Supabase dashboard (Authentication > Users > Add user), not here.
--
-- Safe to run twice.

-- ---------------------------------------------------------------------------------------------
-- 1. The first platform admin.
--    The app recognises a platform admin by a row in platform_admins matched on user_id OR e-mail
--    (src/proxy.ts, src/lib/supabase-server.ts isPlatformAdmin()). Insert the e-mail; the user_id links itself on
--    the first sign-in. Create the matching auth user first (dashboard: Add user, "Auto confirm user" ticked).
--    Use an address the operating team controls, not a client address.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_email text := 'REPLACE_WITH_OPERATOR_EMAIL';   -- <- the only line to edit
begin
  if v_email = 'REPLACE_WITH_OPERATOR_EMAIL' or position('@' in v_email) = 0 then
    raise exception 'bootstrap.sql: put the operator e-mail address on the v_email line first';
  end if;
  insert into platform_admins (email) values (lower(trim(v_email)))
  on conflict (email) do nothing;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. A storage bucket the code uses but no migration creates.
--    src/app/api/cases/[id]/photos/route.ts writes to "case-photos" and serves photos by getPublicUrl(), so it must
--    be public. On the shared production project it was created by hand; a fresh project does not have it.
--    (Every other bucket is created by its own migration. The bucket names are listed in docs/dedicated-instance.md.)
--    Storage must already be running (self-hosted: storage container healthy) or this fails.
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('case-photos', 'case-photos', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- 3. Checks. Read the output; every line should say ok.
-- ---------------------------------------------------------------------------------------------
select 'platform admin present' as check,
       case when exists (select 1 from platform_admins where email <> 'REPLACE_WITH_OPERATOR_EMAIL') then 'ok' else 'MISSING' end as result
union all
select 'no pilot tenant carried over from the baseline',
       case when not exists (select 1 from tenants) then 'ok (no tenants yet, as intended)' else 'tenants present: ' || (select string_agg(slug, ', ') from tenants) end
union all
select 'status reference data seeded (system_status)',
       case when (select count(*) from system_status) > 0 then 'ok (' || (select count(*) from system_status) || ' rows)' else 'MISSING' end
union all
select 'row level security on every public table',
       case when not exists (
         select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
       ) then 'ok' else 'NOT ENABLED on: ' || (
         select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) end
union all
select 'storage buckets (expect 9: company-assets, logos, wfm, quote-attachments, order-attachments, inbox-attachments, deal-room-files, tender-boq-files, case-photos)',
       (select count(*) from storage.buckets where id in ('company-assets','logos','wfm','quote-attachments','order-attachments','inbox-attachments','deal-room-files','tender-boq-files','case-photos'))::text
union all
select 'extensions (expect pgcrypto and pg_trgm)',
       (select string_agg(extname, ', ' order by extname) from pg_extension where extname in ('pgcrypto','pg_trgm'))
union all
select 'tenants.api_key hidden from signed-in users (migration 0200)',
       case when has_column_privilege('authenticated', 'public.tenants', 'api_key', 'select') then 'EXPOSED: 0200 did not apply' else 'ok' end
union all
select 'default table grants reach the API roles (a plain member must be able to read accounts)',
       case when has_table_privilege('authenticated', 'public.accounts', 'select') then 'ok' else 'NO GRANT: see docs/dedicated-instance.md, step 4' end;
