-- run-bundle-48-project-allocation-wbs-2026-10-29.sql
-- Paste into the Supabase SQL editor of each database (dev, then production). Safe to run twice.
-- = migration 0240: the contract project record page and budget allocation (KAMCO feedback, 2026-10-29).
--   contract_projects.handover_sent_at     stamped when the budget file is downloaded: the "Handed over" step of the project path.
--   tender_bid_version_terms               the payment-term template a bid version went out with (RLS: tenant SELECT policy ONLY).
--   contract_projects.allocation_basis     per project: allocate the budget by BOQ line or by work package.
--   project_budget_lines                   + allocated, client_rate, client_amount, source_line_id (existing rows count as allocated).
--   project_work_packages                  the work breakdown (WBS): code, name, owner employee, allocated cost (RLS: tenant SELECT only).
--   project_work_package_lines             which budget lines a package holds, by line_key (RLS: tenant SELECT only).
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

-- ── Slice 10: the budget is allocated by a person, by BOQ line or by work package (WBS) ───────────────────────────────────────
-- Needs the employees table (a package owner is an employee). The projects table gets the basis; a budget line gets whether a cost has been
-- allocated to it and what the client pays for it; the work breakdown is two small tables.
--
-- Existing rows keep working: a line saved before this counts as allocated (default true), its client rate / amount / source line are null,
-- and the basis is 'line'. Nothing is migrated. cost_known stays as a column, is always written true and is read by nothing.
--
-- RLS (the contract-project convention of 0226 and 0234): both new tables carry a tenant SELECT policy and NOTHING that writes. A package
-- holds the cost allocated to it and who owns it, so a member must not be able to edit one through PostgREST; every write is a service-role
-- API route that has already checked the tenant, the project, the caller, the lock, and that an owner is an active employee WITH a login.

do $$
begin
  if to_regclass('public.employees') is null then
    raise exception 'The employees table is missing; run the Employees migration first, then run this again.';
  end if;
end $$;

alter table contract_projects add column if not exists allocation_basis text not null default 'line';
alter table contract_projects drop constraint if exists contract_projects_allocation_basis_check;
alter table contract_projects add constraint contract_projects_allocation_basis_check check (allocation_basis in ('line', 'package'));

alter table project_budget_lines add column if not exists allocated boolean not null default true;
alter table project_budget_lines add column if not exists client_rate numeric(14,4);
alter table project_budget_lines add column if not exists client_amount numeric(14,2);
alter table project_budget_lines add column if not exists source_line_id uuid;
create index if not exists project_budget_lines_source_idx on project_budget_lines (tenant_id, project_id, source_line_id) where source_line_id is not null;

create table if not exists project_work_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references contract_projects(id) on delete cascade,
  code text not null check (char_length(code) between 1 and 20),
  name text not null check (char_length(name) between 1 and 200),
  owner_employee_id uuid references employees(id) on delete set null,
  allocated_cost numeric(14,2) check (allocated_cost is null or allocated_cost >= 0),
  sort_order int not null default 0,
  note text check (note is null or char_length(note) <= 1000),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, code)
);
create index if not exists project_work_packages_project_idx on project_work_packages (tenant_id, project_id, sort_order);
alter table project_work_packages enable row level security;
drop policy if exists "project_work_packages: tenant read" on project_work_packages;
create policy "project_work_packages: tenant read" on project_work_packages for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- Which budget lines a package holds, by the line's stable line_key (it survives revisions, as buy-out does). One package per line.
create table if not exists project_work_package_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references contract_projects(id) on delete cascade,
  package_id uuid not null references project_work_packages(id) on delete cascade,
  line_key uuid not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (project_id, line_key)
);
create index if not exists project_work_package_lines_package_idx on project_work_package_lines (tenant_id, package_id, sort_order);
alter table project_work_package_lines enable row level security;
drop policy if exists "project_work_package_lines: tenant read" on project_work_package_lines;
create policy "project_work_package_lines: tenant read" on project_work_package_lines for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
