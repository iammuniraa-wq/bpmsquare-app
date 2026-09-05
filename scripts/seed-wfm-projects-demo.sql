-- Sample project costing data for the DEMO tenant -- run AFTER
-- 0104_wfm_projects.sql, 0105_wfm_project_links.sql and 0107 (all applied).
--
-- What it seeds, so every screen has something to show end to end:
--   * two projects for the demo tenant's first two accounts, one standalone,
--     one completed last month -- with sub-projects to Level 2
--   * standing links: a site feeds one project, a person feeds a sub-project,
--     a shift feeds the standalone project (the three lower attribution rungs)
--   * three weeks of weekday punches for up to four employees, STAMPED with a
--     project at insert exactly as the punch route would have stamped them,
--     including one employee left unassigned so the "Unassigned" slice on
--     the Projects screen is real
--   * next week's roster: one person put on a sub-project by date (rung 1),
--     so the roster's "On a project" table and the punch screen's "Project:"
--     line have something to say
--   * the wfm and wfm_projects feature flags on for the demo tenant
--
-- Idempotent. Every seeded row has a fixed id (the 0000-...-c0xx family) or a
-- WHERE NOT EXISTS on its natural key, so re-running adds nothing. Refs are
-- taken from the tenant's next free PRJ number on first run and then kept.
-- Times are IST (Asia/Kolkata) written as UTC: 09:00 -> 03:30Z, 18:00 -> 12:30Z.

-- ── Projects ───────────────────────────────────────────────────────────────
with demo as (select id from tenants where is_demo = true limit 1),
seq as (
  select coalesce(max((substring(p.ref from '^PRJ-(\d+)$'))::int), 0) as n
  from wfm_projects p, demo where p.tenant_id = demo.id and p.ref ~ '^PRJ-\d+$'
),
acct as (
  select a.id, row_number() over (order by a.name) as rn
  from accounts a, demo where a.tenant_id = demo.id
)
insert into wfm_projects (id, tenant_id, ref, name, code, parent_id, account_id, status, start_date, end_date, budget_hours)
select v.id, demo.id,
       'PRJ-' || lpad((seq.n + v.k)::text, 4, '0'),
       v.name, v.code, null,
       (select acct.id from acct where acct.rn = v.acct_rn),
       v.status, v.start_date::date, v.end_date::date, v.budget_hours
from demo, seq,
(values
  ('00000000-0000-4000-8000-00000000c001'::uuid, 1, 'Conveyor Retrofit — Plant 2',  'PO-4471', 1, 'active',    (current_date - 35)::text, (current_date + 40)::text, 640),
  ('00000000-0000-4000-8000-00000000c002'::uuid, 2, 'Office Fit-out — Gowribidanur', null,      null, 'active',  (current_date - 20)::text, (current_date + 25)::text, 220),
  ('00000000-0000-4000-8000-00000000c003'::uuid, 3, 'Tower Z — Lift Overhaul',       'PO-4402', 2, 'completed', (current_date - 70)::text, (current_date - 32)::text, 180)
) as v(id, k, name, code, acct_rn, status, start_date, end_date, budget_hours)
where not exists (select 1 from wfm_projects x where x.id = v.id);

-- Sub-projects, numbered inside their parent the way the app does it.
with demo as (select id from tenants where is_demo = true limit 1)
insert into wfm_projects (id, tenant_id, ref, name, parent_id, status)
select v.id, demo.id, p.ref || v.suffix, v.name, v.parent_id, 'active'
from demo,
(values
  ('00000000-0000-4000-8000-00000000c011'::uuid, '00000000-0000-4000-8000-00000000c001'::uuid, '.1', 'Civil works'),
  ('00000000-0000-4000-8000-00000000c012'::uuid, '00000000-0000-4000-8000-00000000c001'::uuid, '.2', 'Mechanical'),
  ('00000000-0000-4000-8000-00000000c013'::uuid, '00000000-0000-4000-8000-00000000c001'::uuid, '.3', 'Electrical'),
  ('00000000-0000-4000-8000-00000000c021'::uuid, '00000000-0000-4000-8000-00000000c002'::uuid, '.1', 'Partitions & ceilings'),
  ('00000000-0000-4000-8000-00000000c022'::uuid, '00000000-0000-4000-8000-00000000c002'::uuid, '.2', 'Electrical & data')
) as v(id, parent_id, suffix, name)
join wfm_projects p on p.id = v.parent_id
where not exists (select 1 from wfm_projects x where x.id = v.id);

-- Level 2 under Civil works.
with demo as (select id from tenants where is_demo = true limit 1)
insert into wfm_projects (id, tenant_id, ref, name, parent_id, status)
select v.id, demo.id, p.ref || v.suffix, v.name, v.parent_id, 'active'
from demo,
(values
  ('00000000-0000-4000-8000-00000000c111'::uuid, '00000000-0000-4000-8000-00000000c011'::uuid, '.1', 'Foundation'),
  ('00000000-0000-4000-8000-00000000c112'::uuid, '00000000-0000-4000-8000-00000000c011'::uuid, '.2', 'Steel structure')
) as v(id, parent_id, suffix, name)
join wfm_projects p on p.id = v.parent_id
where not exists (select 1 from wfm_projects x where x.id = v.id);

-- ── Standing links (attribution rungs 2-4) ──────────────────────────────────
-- "Employee 1..4" is the demo's active employees in a stable order (code,
-- then name), repeated as a CTE in each statement below rather than a temp
-- table: the SQL editor may commit per statement, which would drop it.

-- Site feeds the retrofit project (rung 4); employee 2 feeds Electrical
-- (rung 2); the second shift feeds the fit-out (rung 3).
with demo as (select id from tenants where is_demo = true limit 1),
emp as (
  select e.id, row_number() over (order by e.employee_code nulls last, e.first_name, e.last_name) as rn
  from employees e
  join tenants t on t.id = e.tenant_id and t.is_demo = true
  where e.status = 'active'
)
insert into wfm_project_links (id, tenant_id, project_id, site_id, employee_id, shift_id)
select v.id, demo.id, v.project_id, v.site_id, v.employee_id, v.shift_id
from demo,
(values
  ('00000000-0000-4000-8000-00000000c201'::uuid, '00000000-0000-4000-8000-00000000c001'::uuid,
     (select s.id from wfm_sites s join tenants t on t.id = s.tenant_id and t.is_demo = true order by s.name limit 1), null::uuid, null::uuid),
  ('00000000-0000-4000-8000-00000000c202'::uuid, '00000000-0000-4000-8000-00000000c013'::uuid,
     null::uuid, (select id from emp where rn = 2), null::uuid),
  ('00000000-0000-4000-8000-00000000c203'::uuid, '00000000-0000-4000-8000-00000000c002'::uuid,
     null::uuid, null::uuid, (select s.id from wfm_shifts s join tenants t on t.id = s.tenant_id and t.is_demo = true order by s.start_time desc limit 1))
) as v(id, project_id, site_id, employee_id, shift_id)
where num_nonnulls(v.site_id, v.employee_id, v.shift_id) = 1
  and not exists (select 1 from wfm_project_links x where x.id = v.id);

-- ── Three weeks of punches, stamped with their project ─────────────────────
-- Employee 1: Foundation for two weeks, then Steel structure.
-- Employee 2: Electrical throughout (matches their standing link).
-- Employee 3: the fit-out's Partitions & ceilings.
-- Employee 4: no project at all -- the honest "Unassigned" slice.
with demo as (select id from tenants where is_demo = true limit 1),
emp as (
  select e.id, row_number() over (order by e.employee_code nulls last, e.first_name, e.last_name) as rn
  from employees e
  join tenants t on t.id = e.tenant_id and t.is_demo = true
  where e.status = 'active'
),
site as (select s.id from wfm_sites s join tenants t on t.id = s.tenant_id and t.is_demo = true order by s.name limit 1),
days as (
  select d::date as day
  from generate_series(current_date - 21, current_date - 1, interval '1 day') d
  where extract(isodow from d) between 1 and 5
),
plan as (
  select e.id as employee_id, d.day,
    case e.rn
      when 1 then case when d.day < current_date - 7 then '00000000-0000-4000-8000-00000000c111'::uuid else '00000000-0000-4000-8000-00000000c112'::uuid end
      when 2 then '00000000-0000-4000-8000-00000000c013'::uuid
      when 3 then '00000000-0000-4000-8000-00000000c021'::uuid
      else null::uuid
    end as project_id
  from emp e cross join days d
  where e.rn <= 4
),
punches as (
  select p.employee_id, p.day, p.project_id, k.kind, k.at_utc
  from plan p
  cross join (values
    ('check_in',    time '03:30'),
    ('break_start', time '07:30'),
    ('break_end',   time '08:00'),
    ('check_out',   time '12:30')
  ) as k(kind, at_utc)
)
insert into wfm_presence_events (tenant_id, employee_id, ts, kind, source, site_id, project_id, within_geofence, flags)
select demo.id, pu.employee_id, (pu.day + pu.at_utc) at time zone 'UTC', pu.kind, 'manual_admin',
       (select id from site), pu.project_id, true, '{"seed": "wfm-projects-demo"}'::jsonb
from demo, punches pu
where not exists (
  select 1 from wfm_presence_events x
  where x.tenant_id = demo.id and x.employee_id = pu.employee_id
    and x.ts = (pu.day + pu.at_utc) at time zone 'UTC' and x.kind = pu.kind
);

-- ── Next week's roster (rung 1) ────────────────────────────────────────────
-- Employee 1 goes on Mechanical; employee 4 -- the one with no project in
-- their history above -- goes on Electrical, so the person whose past hours
-- sit in "Unassigned" is the one whose punch screen now says "Project:".
-- Each insert is guarded on the employee existing, so a demo with fewer
-- people simply seeds fewer rows instead of failing on a null employee.
with demo as (select id from tenants where is_demo = true limit 1),
emp as (
  select e.id, row_number() over (order by e.employee_code nulls last, e.first_name, e.last_name) as rn
  from employees e
  join tenants t on t.id = e.tenant_id and t.is_demo = true
  where e.status = 'active'
),
days as (
  select d::date as day
  from generate_series(current_date + 1, current_date + 10, interval '1 day') d
  where extract(isodow from d) between 1 and 5
  limit 5
),
who as (
  select e.id as employee_id, v.project_id, v.note
  from (values
    (1, '00000000-0000-4000-8000-00000000c012'::uuid, 'seed: on Mechanical this week'),
    (4, '00000000-0000-4000-8000-00000000c013'::uuid, 'seed: on Electrical this week')
  ) as v(rn, project_id, note)
  join emp e on e.rn = v.rn
)
insert into wfm_roster_assignments (tenant_id, employee_id, date, project_id, is_day_off, note)
select demo.id, who.employee_id, days.day, who.project_id, false, who.note
from demo, who, days
where not exists (
  select 1 from wfm_roster_assignments x
  where x.tenant_id = demo.id and x.employee_id = who.employee_id and x.date = days.day
);

-- ── Feature flags on for the demo tenant only ──────────────────────────────
update tenants
set features = coalesce(features, '{}'::jsonb) || '{"wfm": true, "wfm_projects": true}'::jsonb
where is_demo = true;
