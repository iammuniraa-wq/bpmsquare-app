-- One-off ops fix: missing check-outs on 2026-08-22 (BIM UAT).
--
-- A client-side crash on the punch screen stopped UAT employees from
-- punching out at 19:00 IST. Their check_in rows exist; the closing
-- check_out rows do not, so the day reads as "Present" forever and the
-- hours/monthly summary for the day is wrong.
--
-- This inserts the missing check_out events at 19:00 IST, attributed
-- honestly: source = 'manual_admin' (an admin wrote them, not the
-- employee's phone) with the reason in flags, so the audit trail shows
-- exactly what happened and why. site_id is copied from the employee's
-- own check_in that day so the row stays consistent with where they were.
--
-- SAFETY: the insert only touches employees who (a) belong to the BIM
-- tenant, (b) have a check_in on 2026-08-22 IST, and (c) have NO
-- check_out that day. Re-running it is a no-op — condition (c) stops
-- matching once the rows exist. Step 1 is a preview; run it, eyeball
-- the names, then run step 2.

-- ── STEP 1 — PREVIEW: who will be fixed, and is any break left open? ────────
with tz as (select 'Asia/Kolkata'::text as zone),
day_bounds as (
  select (timestamp '2026-08-22 00:00' at time zone zone) as day_start,
         (timestamp '2026-08-23 00:00' at time zone zone) as day_end
  from tz
),
todays as (
  select e.id as employee_id,
         e.first_name || ' ' || coalesce(e.last_name, '') as name,
         p.kind, p.ts, p.site_id
  from employees e
  join tenants t on t.id = e.tenant_id and t.slug = 'bim'
  join wfm_presence_events p on p.employee_id = e.id and p.tenant_id = e.tenant_id
  cross join day_bounds b
  where p.ts >= b.day_start and p.ts < b.day_end
)
select name,
       min(ts) filter (where kind = 'check_in')                     as checked_in_at,
       count(*) filter (where kind = 'check_out')                   as check_outs,
       count(*) filter (where kind = 'break_start')                 as break_starts,
       count(*) filter (where kind = 'break_end')                   as break_ends,
       case when count(*) filter (where kind = 'break_start')
               > count(*) filter (where kind = 'break_end')
            then 'DANGLING BREAK — fix this first' else 'ok' end    as break_state
from todays
group by name
having count(*) filter (where kind = 'check_in') > 0
order by name;

-- If any row above says DANGLING BREAK, tell me before running step 2 —
-- an unclosed break makes the hours engine subtract the rest of the day.


-- ── STEP 2 — THE FIX: insert the missing 19:00 IST check-outs ───────────────
-- Excludes anyone who already has a check_out that day (so your own
-- record, and anyone who punched out normally, are left alone).

insert into wfm_presence_events
  (tenant_id, employee_id, ts, kind, source, site_id, flags, created_by)
select
  e.tenant_id,
  e.id,
  (timestamp '2026-08-22 19:00' at time zone 'Asia/Kolkata'),
  'check_out',
  'manual_admin',
  (select p2.site_id
     from wfm_presence_events p2
    where p2.employee_id = e.id
      and p2.kind = 'check_in'
      and p2.ts >= (timestamp '2026-08-22 00:00' at time zone 'Asia/Kolkata')
      and p2.ts <  (timestamp '2026-08-23 00:00' at time zone 'Asia/Kolkata')
    order by p2.ts
    limit 1),
  jsonb_build_object(
    'admin_fix', true,
    'reason', 'punch screen crash 2026-08-22 blocked 19:00 punch-out (UAT)'
  ),
  null
from employees e
join tenants t on t.id = e.tenant_id and t.slug = 'bim'
where
  -- has a check_in that day
  exists (
    select 1 from wfm_presence_events p
     where p.employee_id = e.id and p.kind = 'check_in'
       and p.ts >= (timestamp '2026-08-22 00:00' at time zone 'Asia/Kolkata')
       and p.ts <  (timestamp '2026-08-23 00:00' at time zone 'Asia/Kolkata')
  )
  -- and no check_out that day
  and not exists (
    select 1 from wfm_presence_events p
     where p.employee_id = e.id and p.kind = 'check_out'
       and p.ts >= (timestamp '2026-08-22 00:00' at time zone 'Asia/Kolkata')
       and p.ts <  (timestamp '2026-08-23 00:00' at time zone 'Asia/Kolkata')
  )
  -- and the check_in was BEFORE 19:00 (never close a punch that opened later)
  and (
    select min(p.ts) from wfm_presence_events p
     where p.employee_id = e.id and p.kind = 'check_in'
       and p.ts >= (timestamp '2026-08-22 00:00' at time zone 'Asia/Kolkata')
       and p.ts <  (timestamp '2026-08-23 00:00' at time zone 'Asia/Kolkata')
  ) < (timestamp '2026-08-22 19:00' at time zone 'Asia/Kolkata');

-- ── STEP 3 — VERIFY ────────────────────────────────────────────────────────
-- Re-run STEP 1: every fixed employee should now show check_outs = 1.
