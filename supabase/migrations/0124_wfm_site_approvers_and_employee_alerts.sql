-- 0124: additional approvers per site, and a claim table for the two new
-- employee push alerts (break overrun, holiday this week).
--
-- Client request (BIM, 2026-09-10): "a config to maintain supervisor or
-- supervisorS based on site to approve". Today a site has exactly one
-- approver -- wfm_sites.supervisor_id (0079) -- and authority resolves
-- through it plus the employees.supervisor_id chain (lib/wfm/scope.ts). A
-- single named supervisor is a single point of failure: when they are on
-- leave, every comp-off / sick-leave / WFH request at that site waits.
--
-- Deliberately an ADDITIVE join table rather than widening wfm_sites:
--   * wfm_sites.supervisor_id keeps its exact current meaning (the site's
--     primary supervisor, and the person the scope tree hangs off). Nothing
--     that reads it today changes behaviour.
--   * every row here is an ADDITIONAL approver for that site -- peers, not a
--     hierarchy. canApproveFor() accepts any of them; resolveWfmScope() lets
--     them see that site's people.
-- So a tenant that never adds a row is byte-for-byte where it was.

create table if not exists wfm_site_approvers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  site_id     uuid not null references wfm_sites(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- Naming the same person twice for one site is a no-op, not two approvers.
  unique (site_id, employee_id)
);

create index if not exists wfm_site_approvers_site_idx
  on wfm_site_approvers (tenant_id, site_id);
-- The hot lookup is the other direction: "which sites may THIS person approve?"
create index if not exists wfm_site_approvers_employee_idx
  on wfm_site_approvers (tenant_id, employee_id);

alter table wfm_site_approvers enable row level security;
-- WFM convention (0062 header): tenant-scoped SELECT only, no write policy --
-- writes go through the tenant-admin-only site routes on the service-role
-- client. Who may approve whose attendance is not something a tenant member
-- gets to edit through PostgREST with their own session.
drop policy if exists "wfm_site_approvers: tenant read" on wfm_site_approvers;
create policy "wfm_site_approvers: tenant read" on wfm_site_approvers for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));


-- ── Employee alert claims (break overrun, holiday this week) ───────────────
-- Same job as wfm_hours_alerts (0106) does for the long-day alert: claim the
-- row BEFORE sending, so a cron that runs every 15 minutes cannot buzz the
-- same phone every 15 minutes.
--
-- A SEPARATE table rather than a `kind` column on wfm_hours_alerts, on
-- purpose: that table backs the one push alert BIM already relies on in
-- production, and its cron inserts a fixed column list. Adding a column there
-- would mean the running long-day alert breaks for as long as this migration
-- is pending. A new table can simply not exist yet -- the new features
-- no-op (42P01, per bpmsquarecore.md §3b) and the working one is untouched.
create table if not exists wfm_employee_alerts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  -- 'break_overrun' | 'holiday_week'. Text rather than an enum so a third
  -- alert kind is a code change, not a migration.
  kind        text not null,
  -- The window this claim covers: the shift-day for a break alert, the week's
  -- Monday for the holiday digest.
  day_key     date not null,
  sent_at     timestamptz not null default now(),
  unique (tenant_id, employee_id, kind, day_key)
);

create index if not exists wfm_employee_alerts_day_idx
  on wfm_employee_alerts (tenant_id, kind, day_key);

alter table wfm_employee_alerts enable row level security;
drop policy if exists "wfm_employee_alerts: tenant read" on wfm_employee_alerts;
create policy "wfm_employee_alerts: tenant read" on wfm_employee_alerts for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
