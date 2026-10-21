-- 0200_tenants_hide_api_key.sql
--
-- Security audit 2026-10-21 (docs/security-audit-2026-10-21.md, finding H3).
--
-- "tenants: members read own" is a ROW policy: it lets every member of a
-- workspace select every COLUMN of their workspace's row through PostgREST,
-- including tenants.api_key -- the legacy plaintext key that authorises full
-- read/write on /api/v1 (see api/v1/_auth.ts). redactTenantForRole() hides it
-- from the page props of a non-admin, but a member does not need the page:
-- GET /rest/v1/tenants?select=api_key with their own session returns it.
--
-- A row policy cannot hide a column, and REVOKE (api_key) alone is a no-op while
-- a table-level SELECT grant exists. So the table-level SELECT is withdrawn from
-- the browser-facing roles and re-granted column by column, every column except
-- api_key. The service role is untouched, and so are all current reads: every
-- session-client read of tenants in the app names its columns and none asks for
-- api_key (the admin pages that do `select *` use the service role).
--
-- RUN AFTER deploying the audit-2026-10-21 code; nothing in it depends on the
-- order, but this is the one migration of the pair that changes what a session
-- client may select.
--
-- WHEN YOU ADD A COLUMN TO tenants later, add
--     grant select (<column>) on tenants to authenticated;
-- in the same migration, or a session-client read of that column fails with
-- "permission denied". src/lib/tenantsColumnGrants.test.ts fails the build if
-- you forget.

do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'tenants' and column_name <> 'api_key';

  execute 'revoke select on public.tenants from anon, authenticated';
  execute format('grant select (%s) on public.tenants to authenticated', cols);
end
$$;
