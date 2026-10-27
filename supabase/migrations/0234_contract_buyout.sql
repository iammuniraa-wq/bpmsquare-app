-- 0234: contract buy-out: the packages a won project sources after the award, and the RFQ rounds that price them.
-- GCC tender deals, contract buy-out (docs/design/contract-buyout.md sections 3 and 4). Needs 0226 (contract_projects, budget lines) and
-- 0128 (rfqs, rfq_lines). 0233 (supplier groups) is separate: buy-out works without it, with every supplier offered.
--
-- project_buyout_packages: one row per package (ref PKG-####), a name, a kind (supplier or subcontract), a status (draft, out, ready,
-- awarded, handed_over), the RFQ round currently open, and once awarded the round, supplier, committed amount, reason, who and when. The
-- handover to the ERP is recorded here (handover_sent_at / by, erp_ref). There are no purchase orders in this product: the buy-out stops
-- at the award and the handover file.
-- project_buyout_package_lines: which budget lines a package groups. A line is in at most one package per project. Budget lines are copied
-- into a new row when a revision is approved, so a package line keeps the budget line's stable line_key (the thing that survives a revision)
-- as well as the id it was picked by; the id is informational and set null when that revision's rows go.
-- rfqs.package_id: an RFQ round raised for a package (each round is its own RFQ, and all of them are kept for audit). Round numbers are
-- derived from created order.
-- rfq_lines.package_line_id: which package line an RFQ line asks about, so an award and the handover read the price of the right line.
--
-- RLS (MULTI_TENANT_GUARDRAILS.md, the 0199 lesson): the new tables carry a tenant SELECT policy and NOTHING that writes. A package carries
-- the budget, the committed cost and the award, so a member must not be able to edit one through PostgREST; every write is a service-role
-- API route that has already checked the tenant, the project, the caller and the lock. The two added columns sit on tables that are already
-- select-only under RLS. Cost is internal: no v1, MCP or Data Workbench surface reads these tables.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the Buy-out tab says a database update is needed and nothing else
-- changes (42P01 / 42703 / PGRST205 are read as "not there yet").

do $$
begin
  if to_regclass('public.contract_projects') is null or to_regclass('public.project_budget_lines') is null then
    raise exception 'Run 0226 (bundle 36, contract projects) first, then run this again.';
  end if;
  if to_regclass('public.rfqs') is null or to_regclass('public.rfq_lines') is null then
    raise exception 'Run 0128 (RFQs) first, then run this again.';
  end if;
end $$;

create table if not exists project_buyout_packages (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  project_id           uuid not null references contract_projects(id) on delete cascade,
  ref                  text,
  name                 text not null check (char_length(name) between 1 and 200),
  kind                 text not null default 'supplier' check (kind in ('supplier', 'subcontract')),
  status               text not null default 'draft' check (status in ('draft', 'out', 'ready', 'awarded', 'handed_over')),
  current_rfq_id       uuid references rfqs(id) on delete set null,
  awarded_rfq_id       uuid references rfqs(id) on delete set null,
  awarded_supplier_id  uuid references suppliers(id) on delete set null,
  committed_amount     numeric(14,2) check (committed_amount is null or committed_amount >= 0),
  currency             text,
  award_reason         text check (award_reason is null or char_length(award_reason) <= 1000),
  awarded_by           uuid,
  awarded_at           timestamptz,
  handover_sent_at     timestamptz,
  handover_sent_by     uuid,
  erp_ref              text check (erp_ref is null or char_length(erp_ref) <= 100),
  note                 text check (note is null or char_length(note) <= 1000),
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists project_buyout_packages_tenant_ref_uniq on project_buyout_packages (tenant_id, ref) where ref is not null;
create index if not exists project_buyout_packages_project_idx on project_buyout_packages (tenant_id, project_id, created_at);

alter table project_buyout_packages enable row level security;
drop policy if exists "project_buyout_packages: tenant read" on project_buyout_packages;
create policy "project_buyout_packages: tenant read" on project_buyout_packages for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists project_buyout_package_lines (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  project_id     uuid not null references contract_projects(id) on delete cascade,
  package_id     uuid not null references project_buyout_packages(id) on delete cascade,
  budget_line_id uuid references project_budget_lines(id) on delete set null,
  line_key       uuid not null,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);

create unique index if not exists project_buyout_package_lines_one_package on project_buyout_package_lines (project_id, line_key);
create index if not exists project_buyout_package_lines_package_idx on project_buyout_package_lines (tenant_id, package_id, sort_order);

alter table project_buyout_package_lines enable row level security;
drop policy if exists "project_buyout_package_lines: tenant read" on project_buyout_package_lines;
create policy "project_buyout_package_lines: tenant read" on project_buyout_package_lines for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

alter table rfqs add column if not exists package_id uuid references project_buyout_packages(id) on delete set null;
create index if not exists rfqs_package_idx on rfqs (tenant_id, package_id) where package_id is not null;

alter table rfq_lines add column if not exists package_line_id uuid references project_buyout_package_lines(id) on delete set null;
