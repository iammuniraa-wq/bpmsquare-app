-- run-bundle-site-0260-site-entry-2026-11-24.sql
-- Paste into the Supabase SQL editor of each database (dev, then production, then PCBS). Safe to run twice.
-- Run AFTER 0226 (bundle 36). No seed.
-- = migration 0260: The Site entry switch (docs/design/pcbs-site-receipt-expenses.md).
--   contract_projects.site_entry (boolean, default true)
-- The app works before and after: the modules are hidden behind platform-admin flags (default off); until this has run a flagged-on
--   workspace sees "a database update is needed" and nothing crashes. Wrapped in one transaction.

begin;

-- 0260: the per-project switch "Site entry" (docs/design/pcbs-site-receipt-expenses.md, section 6): a project the site people may record
-- receipts and expenses on. Default ON, so an active project is open to site entry the moment the workspace's flags are on; a manager turns it
-- off for a project that should not take site entries. One column on contract_projects; its existing tenant-isolation policy covers it.
--
-- Idempotent; safe to run twice. Hand-applied by the owner. Until it runs every project reads as "site entry on" and the switch is hidden
-- (42703 / PGRST204 are read as "not there yet").

do $$
begin
  if to_regclass('public.contract_projects') is null then
    raise exception 'Run 0226 (bundle 36, contract projects) first, then run this again.';
  end if;
end $$;

alter table contract_projects add column if not exists site_entry boolean not null default true;

commit;
