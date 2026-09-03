-- 0104: WFM Project Costing — attribute worked hours to a project.
-- Design: WFM_PROJECT_COSTING.md (owner approved 2026-09-03).
--
-- Two shape decisions this migration exists to lock in, both cheap here and
-- a rewrite later (see §5 and §6 of the design doc):
--
--   1. project_id lands on wfm_presence_events, NOT on a day record. Sessions
--      already split a day into check_in→check_out stretches, so a session
--      inheriting the project of its own check_in means mid-shift transfer
--      ("labor level transfer" in Kronos terms) is supported by the data
--      model without being built yet. A day-level column would make that a
--      rewrite.
--   2. project↔site is a date-effective many-to-many table, not a column on
--      either side. The attribution fallback asks "the site's sole active
--      project ON THAT DATE"; with a scalar column that silently degrades to
--      "the site's project NOW", which retroactively re-attributes history.
--
-- RLS follows the WFM convention (0062's header), NOT the standard
-- for-all policy products/suppliers use: tenant-scoped SELECT only, no
-- write policy at all, every write through the service-role client behind
-- an app-level role check. Per MULTI_TENANT_GUARDRAILS.md, a table driving
-- cost or billing is one a user has an incentive to forge -- this is the
-- wfm_ot_sessions lesson (0077 → 0078) applied up front rather than after.

-- ── Projects ─────────────────────────────────────────────────────────────

create table if not exists wfm_projects (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  ref         text,                     -- business id (PRJ-####), masterRef-assigned
  name        text not null,
  code        text,                     -- the client's own job/contract number
  -- One level ships (project). parent_id exists so a phase / cost-code level
  -- is a column's worth of work later instead of a migration of history --
  -- every reference system (WBS, labor levels, cost codes) is a hierarchy.
  parent_id   uuid references wfm_projects(id) on delete set null,
  -- Optional Sales link: quoted-vs-actual margin for tenants who have Sales
  -- Cloud. Null and invisible for a WFM-only tenant like BIM.
  account_id  uuid references accounts(id) on delete set null,
  status      text not null default 'active'
                check (status in ('planned','active','on_hold','completed','cancelled')),
  start_date  date,
  end_date    date,
  budget_hours numeric(12,2),
  custom_data jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists wfm_projects_tenant_idx on wfm_projects (tenant_id, name);
create index if not exists wfm_projects_tenant_status_idx on wfm_projects (tenant_id, status);
-- Same partial-unique backstop masterRef relies on elsewhere (0061 shape).
create unique index if not exists wfm_projects_tenant_ref_key
  on wfm_projects (tenant_id, ref) where ref is not null;

alter table wfm_projects enable row level security;
create policy "wfm_projects: tenant read" on wfm_projects for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ── Project ↔ site, date-effective ───────────────────────────────────────

create table if not exists wfm_project_sites (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references wfm_projects(id) on delete cascade,
  site_id    uuid not null references wfm_sites(id) on delete cascade,
  from_date  date not null,
  to_date    date,                      -- null = open-ended
  created_at timestamptz not null default now()
);

create index if not exists wfm_project_sites_site_idx
  on wfm_project_sites (tenant_id, site_id, from_date);
create index if not exists wfm_project_sites_project_idx
  on wfm_project_sites (tenant_id, project_id);

alter table wfm_project_sites enable row level security;
create policy "wfm_project_sites: tenant read" on wfm_project_sites for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ── Attribution carriers ─────────────────────────────────────────────────

-- The supervisor's pre-assignment. Roster is already unique per
-- (tenant_id, employee_id, date) and already carries site_id, so this is the
-- natural home -- one dropdown on a screen that exists, no new workflow for
-- a workforce that will not pick a project at a kiosk.
alter table wfm_roster_assignments
  add column if not exists project_id uuid references wfm_projects(id) on delete set null;

-- Stamped at punch time from resolveProjectForPunch(), never recomputed.
-- on delete set null rather than cascade: deleting a project must never
-- destroy attendance evidence.
alter table wfm_presence_events
  add column if not exists project_id uuid references wfm_projects(id) on delete set null;

create index if not exists wfm_presence_events_project_idx
  on wfm_presence_events (tenant_id, project_id, ts) where project_id is not null;
