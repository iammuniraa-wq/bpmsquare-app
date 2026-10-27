-- run-bundle-41-after-award-2026-10-27.sql
-- Paste into the Supabase SQL editor of each database (dev, then production). Safe to run twice.
-- = migrations 0230, 0231 and 0232: GCC tender deals, after award (docs/design/gcc-tender-deals.md section 23).
--   0230 tender_bid_version_costs: the internal cost of each bid version, stored when the bid is submitted (RLS on, NO policy: only the
--        service role reaches it). The contract project budget starts from the winning version's cost; "Bid against budget" compares them.
--   0231 contract_project_variations: client changes after the award, priced and approved (RLS: tenant SELECT policy ONLY).
--   0232 contract_project_milestones: the billing schedule of a contract project, with a link to the invoice made from each milestone
--        (RLS: tenant SELECT policy ONLY).
--   No column is added to any existing table.
-- Needs 0225 (bundle 35, bid versions) before 0230, and 0226 (bundle 36, contract projects) and the invoices table before 0231 and 0232;
--   each part stops with a plain message if that is missing. Variations also use approval_requests (0221, bundle 32) to be approved.
-- The app works before and after: until it runs, a bid is submitted as before (the answer says its cost was not stored), a project made
--   from such a tender starts from the current BOQ and says so, and the Variations and Invoicing tabs say a database update is needed;
--   nothing crashes (42P01 / 42703 / PGRST205 are read as "not there yet"). A workspace without the platform-admin flags `gcc_tender`
--   and `contract_projects` sees nothing.
-- Demo data: none.

-- 0230: the internal cost of each bid version.
-- GCC tender deals, after award (docs/design/gcc-tender-deals.md section 23). Needs 0225 (tender_bid_versions).
--
-- tender_bid_version_costs: when a bid version is submitted, the application also stores, per bid line, the INTERNAL cost behind the
-- price and the row markup, as the budget lines that cost becomes (resource type, cost code, quantity, unit cost; from the BOQ row's
-- recorded cost, the estimates that priced it, or the default margin). The contract project's baseline budget starts from the WINNING
-- version's snapshot instead of the current BOQ, and "Bid against budget" on the project compares the two. One row per version, written
-- once (a trigger refuses an UPDATE), never read by an export, a PDF, a public link, the answer sheet, the v1 API or Talk to data.
--
-- Why a table and not a column on tender_bid_versions: that table has a tenant SELECT policy (a bid is a record every member may read),
-- and a policy cannot hide one column, so a cost column there would be readable by any member through PostgREST with their own session
-- token (the 2026-10-21 audit lesson, 0200). This table has RLS ENABLED and NO policy at all: only the service role reaches it, and
-- every read and write is an API route that has already checked the tenant, the deal and the caller's access.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, a bid is submitted exactly as before (without a snapshot,
-- and the response says so), and a project made from such a tender starts from the current BOQ and says so in its budget note.

do $$
begin
  if to_regclass('public.tender_bid_versions') is null then
    raise exception 'Run 0225 (bundle 35, bid versions) first, then run this again.';
  end if;
end $$;

create table if not exists tender_bid_version_costs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  opportunity_id  uuid not null references opportunities(id) on delete cascade,
  version_no      int not null check (version_no >= 1),
  total_cost      numeric(16,2) not null default 0,
  line_count      int not null default 0,
  snapshot        jsonb not null,
  created_at      timestamptz not null default now(),
  unique (opportunity_id, version_no)
);

create index if not exists tender_bid_version_costs_deal on tender_bid_version_costs (tenant_id, opportunity_id, version_no desc);

create or replace function tender_bid_version_costs_no_update() returns trigger as $$
begin
  raise exception 'the cost of a submitted bid version cannot be changed';
end;
$$ language plpgsql;

drop trigger if exists tender_bid_version_costs_immutable on tender_bid_version_costs;
create trigger tender_bid_version_costs_immutable before update on tender_bid_version_costs
  for each row execute function tender_bid_version_costs_no_update();

alter table tender_bid_version_costs enable row level security;

-- 0231: variations of a contract project: a client change after award, priced and approved.
-- GCC tender deals, after award (docs/design/gcc-tender-deals.md section 23). Needs 0226 (contract_projects).
--
-- contract_project_variations: one row per change the client asks for after the award. ref VAR-####, a title, what changed, the change
-- in contract value (amount, signed: an omission is negative) and the internal cost of doing it (cost_amount, signed), and the change
-- request it answers (free text: the deal's change request number or the client's own reference). Status draft, submitted, approved,
-- rejected. Submitting asks the people who approve project budgets (approval_requests, kind project_variation, the same approvers and
-- self-approval rule as a baseline); approving adds `amount` to contract_projects.contract_value and, when the project has an approved
-- baseline and no open revision, opens a budget revision for the cost (budget_revision_id says which).
--
-- RLS (MULTI_TENANT_GUARDRAILS.md, the 0199 lesson): a tenant SELECT policy and NOTHING that writes. A variation moves the contract
-- value and opens a budget revision, so a member must not be able to write one through PostgREST; every write is a service-role API
-- route that has already checked the tenant, the project and the approver list.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the Variations tab says a database update is needed and
-- nothing else changes (42P01 / 42703 / PGRST205 are read as "not there yet").

do $$
begin
  if to_regclass('public.contract_projects') is null then
    raise exception 'Run 0226 (bundle 36, contract projects) first, then run this again.';
  end if;
end $$;

create table if not exists contract_project_variations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  project_id         uuid not null references contract_projects(id) on delete cascade,
  ref                text,
  title              text not null check (char_length(title) between 1 and 200),
  description        text check (description is null or char_length(description) <= 2000),
  status             text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  amount             numeric(14,2) not null default 0,
  cost_amount        numeric(14,2) not null default 0,
  change_request_ref text check (change_request_ref is null or char_length(change_request_ref) <= 100),
  note               text check (note is null or char_length(note) <= 1000),
  submitted_by       uuid,
  submitted_at       timestamptz,
  decided_by         uuid,
  decided_at         timestamptz,
  budget_revision_id uuid references project_budget_revisions(id) on delete set null,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists contract_project_variations_tenant_ref_uniq on contract_project_variations (tenant_id, ref) where ref is not null;
create index if not exists contract_project_variations_project on contract_project_variations (tenant_id, project_id, created_at desc);

alter table contract_project_variations enable row level security;
drop policy if exists "contract_project_variations: tenant read" on contract_project_variations;
create policy "contract_project_variations: tenant read" on contract_project_variations for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- 0232: the billing schedule of a contract project: invoicing milestones.
-- GCC tender deals, after award (docs/design/gcc-tender-deals.md section 23). Needs 0226 (contract_projects) and the invoices table.
--
-- contract_project_milestones: one row per amount to bill, in order. A title, a due date, the amount as a percent of the (revised)
-- contract value OR a fixed amount, a status (planned, ready, invoiced, paid) and the invoice made from it (invoice_id points at the
-- existing invoices object; "Create invoice" on a milestone makes a draft invoice and stores the link both ways: here, and in the
-- invoice's custom_data). Percent milestones are meant to total at most 100 percent; the screen warns, the database does not block.
--
-- RLS (MULTI_TENANT_GUARDRAILS.md, the 0199 lesson): a tenant SELECT policy and NOTHING that writes. A milestone drives what is billed,
-- so every write is a service-role API route that has already checked the tenant, the project and the caller's access.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the Invoicing tab says a database update is needed and
-- nothing else changes (42P01 / 42703 / PGRST205 are read as "not there yet").

do $$
begin
  if to_regclass('public.contract_projects') is null then
    raise exception 'Run 0226 (bundle 36, contract projects) first, then run this again.';
  end if;
  if to_regclass('public.invoices') is null then
    raise exception 'The invoices table is missing. Run the base schema first, then run this again.';
  end if;
end $$;

create table if not exists contract_project_milestones (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  project_id   uuid not null references contract_projects(id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 200),
  due_date     date,
  basis        text not null default 'percent' check (basis in ('percent', 'fixed')),
  percent      numeric(6,2) check (percent is null or (percent >= 0 and percent <= 100)),
  fixed_amount numeric(14,2) check (fixed_amount is null or fixed_amount >= 0),
  status       text not null default 'planned' check (status in ('planned', 'ready', 'invoiced', 'paid')),
  invoice_id   uuid references invoices(id) on delete set null,
  sort_order   int not null default 0,
  note         text check (note is null or char_length(note) <= 1000),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check ((basis = 'percent' and percent is not null) or (basis = 'fixed' and fixed_amount is not null))
);

create index if not exists contract_project_milestones_project on contract_project_milestones (tenant_id, project_id, sort_order, due_date);
create unique index if not exists contract_project_milestones_one_invoice on contract_project_milestones (invoice_id) where invoice_id is not null;

alter table contract_project_milestones enable row level security;
drop policy if exists "contract_project_milestones: tenant read" on contract_project_milestones;
create policy "contract_project_milestones: tenant read" on contract_project_milestones for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
