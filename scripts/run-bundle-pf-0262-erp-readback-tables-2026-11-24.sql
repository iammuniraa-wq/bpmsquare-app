-- run-bundle-pf-0262-erp-readback-tables-2026-11-24.sql
-- Paste into the Supabase SQL editor of each database (dev, then production, then PCBS). Safe to run twice. No seed.
-- Needs contract_projects (0226). = migration 0262: project_erp_facts, project_erp_state, project_kpi_snapshots, the landing tables of the future ERP
--   cost read-back (all RLS on, NO policy: service role only). Nothing writes them yet; every figure that needs them says "Not connected".
-- Optional until the ERP read-back is built: nothing in the app needs it to run. Wrapped in one transaction.

begin;

-- 0262: the landing tables of the ERP read-back for the cost-to-complete and profitability dashboards (docs/design/pcbs-project-dashboards.md,
-- section 3). Nothing writes them yet: the Dynamics 365 read-back is a later piece of work. They exist now so that a later pull lights the
-- tiles with no further change to the screens, and every figure that needs them says "Not connected" while they are empty (never a zero).
--
-- 1. project_erp_facts: what a pull read, one row per fact. kind: cost_actual (posted cost), cost_committed (open commitments), billed (a posted
--    customer invoice, matched to a milestone), received (a settlement), delivered, planned_delivery. wbs_code + resource_code are the cost cell
--    ('' = none). A pull REPLACES the project's rows of its kind in one transaction (a snapshot, never an append that can double).
-- 2. project_erp_state: one row per project and kind: linked, the last good pull, the last run's status and the row count. It tells
--    "never pulled" (Not connected) from "pulled, zero rows" (nothing posted yet).
-- 3. project_kpi_snapshots: one row per project per day, written after a good pull; feeds trends and "was at X last month". No backfill.
--
-- RLS (the 0199 lesson): all three enabled with NO policy at all. Cost and margin are internal; a member must not read or write them through
-- PostgREST. Only service-role routes reach them, each with .eq("tenant_id", tenantId) after the permission check.
--
-- Idempotent; safe to run twice. Hand-applied by the owner (42P01 / 42703 / PGRST205 are read as "not connected").

create table if not exists project_erp_facts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  project_id    uuid not null references contract_projects(id) on delete cascade,
  kind          text not null check (kind in ('cost_actual', 'cost_committed', 'billed', 'received', 'delivered', 'planned_delivery')),
  wbs_code      text not null default '',
  resource_code text not null default '',
  milestone_id  uuid,
  element_code  text,
  amount        numeric(14,2),
  qty           numeric(14,3),
  due_date      date,
  doc_ref       text,
  as_of         timestamptz not null default now(),
  run_id        uuid,
  created_at    timestamptz not null default now()
);
create index if not exists project_erp_facts_project_idx on project_erp_facts (tenant_id, project_id, kind);

create table if not exists project_erp_state (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  project_id  uuid not null references contract_projects(id) on delete cascade,
  kind        text not null check (kind in ('cost_actual', 'cost_committed', 'billed', 'received', 'delivered', 'planned_delivery')),
  linked      boolean not null default false,
  last_ok_at  timestamptz,
  last_status text check (last_status is null or last_status in ('ok', 'failed')),
  row_count   int not null default 0,
  updated_at  timestamptz not null default now(),
  unique (project_id, kind)
);
create index if not exists project_erp_state_project_idx on project_erp_state (tenant_id, project_id);

create table if not exists project_kpi_snapshots (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  project_id       uuid not null references contract_projects(id) on delete cascade,
  taken_on         date not null,
  contract_value   numeric(14,2),
  budget           numeric(14,2),
  actual           numeric(14,2),
  committed        numeric(14,2),
  etg              numeric(14,2),
  billed           numeric(14,2),
  received         numeric(14,2),
  delivered        numeric(14,3),
  planned_delivery numeric(14,3),
  created_at       timestamptz not null default now(),
  unique (project_id, taken_on)
);
create index if not exists project_kpi_snapshots_project_idx on project_kpi_snapshots (tenant_id, project_id, taken_on);

alter table project_erp_facts enable row level security;
alter table project_erp_state enable row level security;
alter table project_kpi_snapshots enable row level security;

commit;
