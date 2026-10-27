-- run-bundle-39-bid-guarantee-states-2026-10-27.sql
-- Paste into the Supabase SQL editor of each database (dev, then production). Safe to run twice.
-- = migration 0228: GCC tender deals, redesign step 1 (bid guarantee states). Widens the check on opportunity_tenders.bond_status to
--   ('requested','issued','submitted','held','released') and makes 'requested' the default for new rows. 'held' stays as the legacy value
--   (shown as "Issued"); no row is rewritten.
-- Needs 0221 (bundle 32) before it; it stops with a plain message if that is missing.
-- The app works before and after: until it runs, the guarantee shows and changes as Issued (held) and Released only, and choosing
--   Requested or Submitted says a database update is needed; nothing crashes. A workspace without the platform-admin flag `gcc_tender`
--   sees nothing. Demo data: none.

-- 0228: Bid guarantee states.
-- GCC tender deals, redesign step 1 (docs/design/gcc-tender-deals.md section 21). Needs 0221 (opportunity_tenders.bond_status).
--
-- The bid guarantee (still the bid bond column set) moves through four visible states: Requested, Issued, Submitted, Released.
-- bond_status was 'held' or 'released'. The check is widened to ('requested','issued','submitted','held','released'): 'held' stays as
-- the legacy value every existing row has and is shown as "Issued", so no row is rewritten. New rows default to 'requested'.
-- The check constraint is found by what it checks, not by its generated name. No new column, so no grant.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the app works with held and released only (held reads as "Issued";
-- Requested and Submitted say a database update is needed) and nothing crashes.

do $$
begin
  if to_regclass('public.opportunity_tenders') is null then
    raise exception 'Run 0220 and 0221 (bundles 31 and 32, the tender deals) first: public.opportunity_tenders does not exist';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'opportunity_tenders' and column_name = 'bond_status') then
    raise exception 'Run 0221 (bundle 32) first: opportunity_tenders.bond_status does not exist';
  end if;
end $$;

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.opportunity_tenders'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%bond_status%'
  loop
    execute format('alter table opportunity_tenders drop constraint %I', c.conname);
  end loop;
  alter table opportunity_tenders add constraint opportunity_tenders_bond_status_check
    check (bond_status in ('requested', 'issued', 'submitted', 'held', 'released'));
end $$;

alter table opportunity_tenders alter column bond_status set default 'requested';
