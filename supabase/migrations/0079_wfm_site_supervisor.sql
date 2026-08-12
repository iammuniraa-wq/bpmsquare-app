-- 0079_wfm_site_supervisor.sql
-- The site's supervisor — the first hop of the WFM reporting tree.
--
-- Client's org model (2026-08-12): one site has one supervisor; an employee's
-- supervisor is whoever runs the site they are ASSIGNED TO for that week or
-- month, not a fixed per-person link. Supervisors in turn report to a manager
-- via the existing employees.supervisor_id, and that chain can go deeper.
--
-- So the hierarchy needs exactly one new column. Everything else is derived:
--
--   employee ──(site they're rostered to on that date)──▶ wfm_sites.supervisor_id
--   supervisor ──employees.supervisor_id──▶ manager
--   manager    ──employees.supervisor_id──▶ (deeper, if ever needed)
--
-- A "manager" is therefore not a role and not a config value -- it is simply a
-- supervisor who has other supervisors in their subtree. Adding a regional
-- layer later is one field edit, with no migration and no new role.
--
-- Deliberately NOT unique: one person may supervise several sites (confirmed
-- with the client). The one-supervisor-per-site direction is what the column
-- being single-valued already enforces.
--
-- Nullable, and left null on purpose: a site with no supervisor has NO
-- approver, and the app warns about that at config time rather than silently
-- escalating to a tenant admin -- an unnoticed silent fallback would put one
-- site's overtime in front of someone who never witnessed the work.

alter table wfm_sites
  add column if not exists supervisor_id uuid references employees(id) on delete set null;

-- Lookup direction that actually gets used: "which sites does this person
-- supervise" (building a supervisor's visible-employee set on every request).
create index if not exists wfm_sites_supervisor_idx
  on wfm_sites (tenant_id, supervisor_id);
