-- run-bundle-52-contract-project-source-2026-11-22.sql
-- Paste into the Supabase SQL editor of each database (dev, then production, then KAMCO and PCBS). Safe to run twice. No seed.
-- Run AFTER 0226 (bundle 36, contract projects). Needs nothing else.
-- = migration 0248: where a contract project came from, so a project can be made from an accepted quote (docs/design/won-quote-to-project.md).
--   contract_projects.source_type / source_id   tender | standard_quote | quotation | estimate | manual, and the record it was made from
--                                               (the backfill below marks every existing tender project).
--   unique (tenant_id, source_type, source_id)  one project per quote; the one-per-deal index of 0226 now covers tender projects only.
-- The app works before and after: until it runs a tender still becomes a project and a deal id with no type reads as a tender; making a
--   project from a quote answers "needs a database update (migration 0248)" and creates nothing. Wrapped in one transaction.

begin;

-- 0248: where a contract project came from (docs/design/won-quote-to-project.md, owner decision 2026-11-22).
-- Needs 0226 (contract_projects).
--
-- A project is made from an awarded tender or, new, from an accepted quote. The source is recorded on the project:
--   contract_projects.source_type   tender | standard_quote | quotation | estimate | manual. NULL on a row written before this migration;
--                                   the backfill below makes every tender project 'tender'. Every tender-only screen (Buy-out, the tender's
--                                   costs, its WBS, the winning bid's payment terms) reads this column, not source_opportunity_id: a quote
--                                   project keeps the deal in source_opportunity_id only as a back link.
--   contract_projects.source_id     the record it was made from (the tender deal, or the quote). No foreign key: it points at one of several tables.
--
-- One project per source: a unique index on (tenant_id, source_type, source_id). The older one-project-per-deal index
-- (contract_projects_one_per_tender, 0226) now applies to tender projects only, so several accepted quotes of one deal can each
-- become a project while a tender still has exactly one.
--
-- No RLS change: contract_projects keeps the tenant SELECT policy of 0226 and nothing that writes; every write is a service-role route
-- that has already checked the tenant, the caller and the source.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, a tender still becomes a project (the two columns are left
-- out of the insert, and a project with a deal id and no type reads as a tender); making a project from a quote answers "needs a database
-- update (migration 0248)" and creates nothing; 42P01 / 42703 / PGRST204 are read as "not there yet".

do $$
begin
  if to_regclass('public.contract_projects') is null then
    raise exception 'Run 0226 (bundle 36, contract projects) first, then run this again.';
  end if;
end $$;

alter table contract_projects add column if not exists source_type text;
alter table contract_projects add column if not exists source_id uuid;

alter table contract_projects drop constraint if exists contract_projects_source_type_check;
alter table contract_projects add constraint contract_projects_source_type_check
  check (source_type is null or source_type in ('tender', 'standard_quote', 'quotation', 'estimate', 'manual'));

update contract_projects set source_type = 'tender', source_id = coalesce(source_id, source_opportunity_id)
  where source_type is null and source_opportunity_id is not null;

drop index if exists contract_projects_one_per_tender;
create unique index if not exists contract_projects_one_per_tender on contract_projects (tenant_id, source_opportunity_id)
  where source_opportunity_id is not null and (source_type is null or source_type = 'tender');
create unique index if not exists contract_projects_one_per_source on contract_projects (tenant_id, source_type, source_id)
  where source_id is not null;

commit;
