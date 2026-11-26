-- run-bundle-pf-0261-forecast-etg-2026-11-24.sql
-- Paste into the Supabase SQL editor of each database (dev, then production, then PCBS). Safe to run twice. No seed.
-- Needs contract_projects (0226). = migration 0261: project_forecast_etg, the project manager's typed estimate to go per cost cell
--   (RLS on, NO policy: only service-role routes read or write it; cost and margin are internal).
-- The app works before and after: the module is the platform-admin flag project_dashboards (off for every workspace until the owner turns it on);
--   until this has run the Forecast tab says an estimate cannot be saved yet and every other figure is unaffected. Wrapped in one transaction.

begin;

-- 0261: the project manager's typed "estimate to go" per cost cell (docs/design/pcbs-project-dashboards.md, section 3 and decision 3).
-- A cost cell is a WBS item x resource type; wbs_code is '' for a project without a WBS (or cost in no item), resource_code is '' for a line
-- with no resource type. One row per (project, wbs_code, resource_code); a person editing the forecast replaces the rows they changed.
-- Only the forecast screen reads or writes it, through service-role routes that have checked the tenant, the project and the caller's right
-- to see cost and margin (workspace setting finance_visibility).
--
-- RLS (MULTI_TENANT_GUARDRAILS.md, the 0199 lesson): enabled with NO policy at all. A member who could read or write this through PostgREST
-- could skip the cost-and-margin permission, so only the service role reaches it. Every read and write is an API route with
-- .eq("tenant_id", tenantId) after the permission check.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the Forecast tab says the estimate cannot be saved yet and every
-- other figure is unaffected (42P01 / 42703 / PGRST205 are read as "not there yet").

create table if not exists project_forecast_etg (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  project_id    uuid not null references contract_projects(id) on delete cascade,
  wbs_code      text not null default '' check (char_length(wbs_code) <= 100),
  resource_code text not null default '' check (char_length(resource_code) <= 40),
  amount        numeric(14,2) not null check (amount >= 0),
  note          text check (note is null or char_length(note) <= 500),
  entered_by    uuid,
  entered_at    timestamptz not null default now(),
  unique (project_id, wbs_code, resource_code)
);

create index if not exists project_forecast_etg_project_idx on project_forecast_etg (tenant_id, project_id);

alter table project_forecast_etg enable row level security;

commit;
