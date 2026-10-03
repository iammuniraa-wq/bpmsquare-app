-- ⚠️  DO NOT RUN. This script's logic is WRONG. Kept as the record only.
--
-- Status: NEVER APPLIED. Its section 2 was commented out, so when it was run
-- on production on 2026-10-03 only the SELECTs executed. Verified afterwards:
-- all 22 candidate rows still had superseded_by = NULL, and no correction in
-- the tenant is superseded by another correction. BIM's data was not changed.
--
-- Why it is wrong: it groups live corrections by employee + day + kind, which
-- assumes every correction in a group corrects the SAME punch. It does not.
-- An employee can work two shifts, or take two breaks, in one day, and each
-- can carry its own correction. Its own dry-run output showed this plainly:
--
--   68db944d  12 Sep  check_in  16:20 would be superseded by 04:10 -- twelve
--                               hours apart, a second shift
--   bb24ce03  23 Sep  break_start keeps 08:30, break_end keeps 16:10 -- a
--                               morning start paired with an evening end
--
-- The correct test for an orphaned correction is "a live correction that no
-- other event points at". The mapping from orphan to replacement must come
-- from wfm_correction_requests (target_event_id + resolved_at), which still
-- holds the link the overwritten superseded_by destroyed -- it cannot be
-- inferred from the events' timestamps, which is what this tried to do.
--
-- The duplicates this was meant to repair are therefore STILL PRESENT.
--
-- KAN-28 repair: collapse duplicate live corrections onto the newest one.
--
-- RUN SECTION 1 FIRST AND READ IT. Section 2 writes to attendance data that
-- drives pay. Nothing here is automatic; the owner runs both by hand.
--
-- Background
-- ----------
-- Approving a correction superseded the event named on the REQUEST. A second
-- request filed before the first was approved still named the original punch,
-- so approving it overwrote the original's link to the first correction --
-- orphaning that first correction as a live event. Every reader filters
-- `.is("superseded_by", null)`, so the day ended up with two or more live
-- punches of the same kind and the hours came out wrong.
--
-- The code fix (approve now supersedes the HEAD of the chain, and the
-- supersede is guarded on superseded_by being null) stops it happening again.
-- It does not repair rows already in this state. That is what this does.
--
-- The rule: within one employee + day + kind, the MOST RECENTLY CREATED
-- correction is the truth -- that is what KAN-28 says should have won -- and
-- every older live correction in that group is superseded by it.
--
-- Scope note: only rows with source='correction' are touched. A genuine
-- second check-in, or several real breaks in a day, are not corrections and
-- are never matched by this.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. DRY RUN — what would change, and what it would be superseded by.
--    Expect roughly 14 employee-days from the 2026-09-29 audit. If this
--    returns far more than that, STOP and ask before running section 2.
-- ─────────────────────────────────────────────────────────────────────────
with ranked as (
  select
    e.id,
    e.employee_id,
    e.kind,
    e.ts,
    e.created_at,
    date(e.ts) as day,
    row_number() over (
      partition by e.employee_id, date(e.ts), e.kind
      order by e.created_at desc
    ) as rn,
    first_value(e.id) over (
      partition by e.employee_id, date(e.ts), e.kind
      order by e.created_at desc
    ) as keep_id
  from wfm_presence_events e
  where e.tenant_id = (select id from tenants where slug = 'bim')
    and e.superseded_by is null
    and e.source = 'correction'
    and e.ts >= '2026-09-01'
)
select
  r.employee_id,
  r.day,
  r.kind,
  r.id            as will_be_superseded,
  r.ts            as its_time,
  r.keep_id       as superseded_by,
  k.ts            as surviving_time
from ranked r
join wfm_presence_events k on k.id = r.keep_id
where r.rn > 1
order by r.employee_id, r.day, r.kind, r.created_at;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. THE REPAIR — only after section 1 looks right.
--    Re-running is harmless: once a row is superseded it no longer matches.
-- ─────────────────────────────────────────────────────────────────────────
-- begin;
--
-- with ranked as (
--   select
--     e.id,
--     row_number() over (
--       partition by e.employee_id, date(e.ts), e.kind
--       order by e.created_at desc
--     ) as rn,
--     first_value(e.id) over (
--       partition by e.employee_id, date(e.ts), e.kind
--       order by e.created_at desc
--     ) as keep_id
--   from wfm_presence_events e
--   where e.tenant_id = (select id from tenants where slug = 'bim')
--     and e.superseded_by is null
--     and e.source = 'correction'
--     and e.ts >= '2026-09-01'
-- )
-- update wfm_presence_events t
-- set superseded_by = r.keep_id
-- from ranked r
-- where t.id = r.id
--   and r.rn > 1
--   and t.tenant_id = (select id from tenants where slug = 'bim');
--
-- -- Should return zero rows before you commit.
-- select e.employee_id, date(e.ts) as day, e.kind, count(*)
-- from wfm_presence_events e
-- where e.tenant_id = (select id from tenants where slug = 'bim')
--   and e.superseded_by is null and e.source = 'correction' and e.ts >= '2026-09-01'
-- group by 1, 2, 3 having count(*) > 1;
--
-- commit;
