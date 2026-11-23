-- Turns the project cost and profitability dashboards on for the DEMO tenant(s) only (is_demo = true) that already own Contract projects.
-- Run AFTER 0261 (scripts/run-bundle-pf-0261-forecast-etg-2026-11-24.sql) if you want the estimate to go to be savable; the screens work without it.
-- Idempotent: setting the flag twice changes nothing. It touches no real workspace, writes no cost data and creates no project: the figures on
-- the demo tenant's own contract projects (planned margin, buy-out, billing plan, lights) are real; everything that needs the ERP shows
-- "Not connected". To switch the module on for a real workspace (PCBS), the platform admin ticks "Project cost and profitability dashboards"
-- in /admin/tenants; this script never does that.

update tenants
set features = coalesce(features, '{}'::jsonb) || '{"project_dashboards": true}'::jsonb
where is_demo = true
  and coalesce((features ->> 'contract_projects')::boolean, false) = true
  and coalesce((features ->> 'project_dashboards')::boolean, false) = false;
