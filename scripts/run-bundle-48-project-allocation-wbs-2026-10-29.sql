-- run-bundle-48-project-allocation-wbs-2026-10-29.sql
-- Paste into the Supabase SQL editor of each database (dev, then production). Safe to run twice.
-- = migration 0240: the contract project record page and budget allocation (KAMCO feedback, 2026-10-29).
--   contract_projects.handover_sent_at     stamped when the budget file is downloaded: the "Handed over" step of the project path.
--   tender_bid_version_terms               the payment-term template a bid version went out with (RLS: tenant SELECT policy ONLY).
-- Needs 0225 (bundle 35, bid versions) and 0226 (bundle 36, contract projects); the work packages also need the employees table.
-- The app works before and after: until it runs the Handed over step reads on buy-out alone, a bid version keeps no payment terms (the
--   project falls back to the tender's current choice) and, for allocation, projects keep their existing budget lines and say that work
--   packages need a database update; nothing crashes (42P01 / 42703 / PGRST205 are read as "not there yet").
-- Demo data: none (the demo workspace has no contract project seed; KAMCO's test projects are seed data the owner edits by hand).

-- 0240: contract project record page and budget allocation (KAMCO feedback, 2026-10-29; docs/design/kamco-feedback-build-spec.md slices 9 and 10).
-- Needs 0225 (tender_bid_versions), 0226 (contract_projects, budget revisions and lines) and the employees table.
--
-- Slice 9
--   contract_projects.handover_sent_at   stamped when the budget file is downloaded for the ERP: the "Handed over" step of the project path.
--   tender_bid_version_terms             the payment-term template that was chosen on the tender when a bid version was submitted, kept with
--                                        that version (the winning version's terms are what the project's billing schedule copies). The
--                                        templates themselves live in tenants.config (Settings > Contract projects); this keeps a COPY, so
--                                        editing a template later never changes a bid that went out.
--
-- RLS (MULTI_TENANT_GUARDRAILS.md, the tender/contract convention of 0220-0234): the new table carries a tenant SELECT policy and NOTHING
-- that writes. Which payment terms a bid went out with is part of the bid; a member must not be able to rewrite it through PostgREST. Every
-- write is a service-role API route that has already checked the tenant, the deal and the caller's access.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the app works as before (the Handed over step reads on buy-out
-- alone, a bid version keeps no payment terms and the project falls back to the tender's current choice); 42P01 / 42703 / PGRST205 are read
-- as "not there yet".

do $$
begin
  if to_regclass('public.contract_projects') is null or to_regclass('public.project_budget_lines') is null then
    raise exception 'Run 0226 (bundle 36, contract projects) first, then run this again.';
  end if;
  if to_regclass('public.tender_bid_versions') is null then
    raise exception 'Run 0225 (bundle 35, tender bids) first, then run this again.';
  end if;
end $$;

alter table contract_projects add column if not exists handover_sent_at timestamptz;

create table if not exists tender_bid_version_terms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  version_no int not null,
  terms jsonb not null,
  created_at timestamptz not null default now(),
  unique (opportunity_id, version_no)
);
create index if not exists tender_bid_version_terms_deal_idx on tender_bid_version_terms (tenant_id, opportunity_id, version_no desc);
alter table tender_bid_version_terms enable row level security;
drop policy if exists "tender_bid_version_terms: tenant read" on tender_bid_version_terms;
create policy "tender_bid_version_terms: tenant read" on tender_bid_version_terms for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
