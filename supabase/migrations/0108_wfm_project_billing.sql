-- 0108: WFM Project Costing -- bill hours to the linked account.
-- Design: WFM_PROJECT_COSTING.md §11 (owner decisions 2026-09-06).
--
-- Two things, both small:
--
--   1. wfm_projects.bill_rate -- the project-override rung of the rate
--      ladder (project > employment type > workspace default). Nullable:
--      null means "use the rung below", never zero.
--
--   2. wfm_project_invoices -- which PERIOD of which project an invoice
--      covers. This is the double-billing guard: a preview refuses a period
--      that overlaps a row here (unless that invoice was cancelled), and it
--      is what lets a later preview say "3h added since invoiced" instead of
--      folding a post-invoice correction in silently. Deleting a draft
--      invoice cascades here and frees the period; a cancelled invoice keeps
--      its row and the guard ignores it by status.
--
-- RLS follows the WFM convention (0062's header), not the standard for-all
-- policy: tenant-scoped SELECT only, every write through the service-role
-- client behind an app-level admin check. A table that decides what a
-- customer is charged is one a user has an incentive to forge.

alter table wfm_projects
  add column if not exists bill_rate numeric(12,2);

create table if not exists wfm_project_invoices (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  project_id   uuid not null references wfm_projects(id) on delete cascade,
  invoice_id   uuid not null references invoices(id) on delete cascade,
  period_from  date not null,
  period_to    date not null,
  -- 'project' = one line for the whole tree; 'sub_project' = one line per
  -- Level-1 sub-project (owner decision: chosen per invoice, not a setting).
  granularity  text not null default 'project'
                 check (granularity in ('project', 'sub_project')),
  -- What was billed, so a later preview can show the delta.
  minutes      integer not null,
  amount       numeric(14,2) not null,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  check (period_to >= period_from)
);

create index if not exists wfm_project_invoices_project_idx
  on wfm_project_invoices (tenant_id, project_id, period_from);
create index if not exists wfm_project_invoices_invoice_idx
  on wfm_project_invoices (tenant_id, invoice_id);

alter table wfm_project_invoices enable row level security;
drop policy if exists "wfm_project_invoices: tenant read" on wfm_project_invoices;
create policy "wfm_project_invoices: tenant read" on wfm_project_invoices for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
