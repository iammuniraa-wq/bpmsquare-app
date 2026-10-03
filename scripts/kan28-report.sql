-- KAN-28 backfill, rebuilt from the REQUESTS rather than from the events.
--
-- Read this header before running anything. Queries A and B are read-only
-- proofs; C is the report; D writes and is commented out.
--
-- Why this version and not the first one
-- --------------------------------------
-- The first attempt grouped live corrections by employee + day + kind, which
-- cannot distinguish two corrections of ONE punch from one correction each of
-- TWO punches. An employee who works two shifts, or takes two breaks, has
-- both -- and it would have collapsed them. It was never applied.
--
-- The link that the bug destroyed is still recorded elsewhere:
-- wfm_correction_requests.target_event_id says which punch each request was
-- filed against, and resolved_at says when it was approved. A punch that was
-- corrected twice therefore shows up as TWO approved requests naming the SAME
-- target_event_id. A second shift or a second break names a DIFFERENT target
-- and can never be caught by this.
--
-- The one weak point, which query A exists to test
-- -----------------------------------------------
-- A request does not record the event its approval created -- there is no
-- such column (0062_wfm_module.sql). So a request is matched to its event by
-- (employee_id, ts = proposed_ts, source = 'correction'), because that is
-- exactly what the approve route inserts. That join is only trustworthy if it
-- is one-to-one. Query A proves it. If A returns ANY rows, stop: the mapping
-- is ambiguous for those rows and C must not be trusted for them.
--
-- Note on scope: only requests with target_event_id set are considered. A
-- missing_check_in has no original punch to supersede, so it cannot produce
-- this bug.

-- ─────────────────────────────────────────────────────────────────────────
-- A. AMBIGUITY PROOF. Must return ZERO rows before anything below is used.
--    Catches a request matching several events, or an event matching several
--    requests -- either of which would make the mapping a guess.
-- ─────────────────────────────────────────────────────────────────────────
with approved as (
  select r.id as request_id, r.employee_id, r.target_event_id, r.resolved_at,
         (r.requested_change->>'proposed_ts')::timestamptz as proposed_ts
  from wfm_correction_requests r
  where r.tenant_id = (select id from tenants where slug = 'bim')
    and r.status = 'approved'
    and r.target_event_id is not null
    and r.requested_change->>'proposed_ts' is not null
),
pairs as (
  select a.request_id, e.id as event_id
  from approved a
  join wfm_presence_events e
    on e.tenant_id = (select id from tenants where slug = 'bim')
   and e.employee_id = a.employee_id
   and e.ts = a.proposed_ts
   and e.source = 'correction'
)
select 'request matches many events' as problem, request_id::text as id, count(*) as n
from pairs group by request_id having count(*) > 1
union all
select 'event matches many requests', event_id::text, count(*)
from pairs group by event_id having count(*) > 1;

-- ─────────────────────────────────────────────────────────────────────────
-- B. HOW MANY PUNCHES WERE CORRECTED MORE THAN ONCE.
--    Sanity scale check. Expect a handful.
-- ─────────────────────────────────────────────────────────────────────────
select r.target_event_id, count(*) as approved_corrections
from wfm_correction_requests r
where r.tenant_id = (select id from tenants where slug = 'bim') and r.status = 'approved' and r.target_event_id is not null
group by r.target_event_id
having count(*) > 1
order by 2 desc;

-- ─────────────────────────────────────────────────────────────────────────
-- C. THE REPORT. One row per correction event, for every punch corrected more
--    than once: what the original punch was, every correction against it in
--    approval order, and which one survives.
--
--    CHECK A FEW OF THESE AGAINST WHAT THE PERSON ACTUALLY WORKED before
--    running D. "verdict" tells you what D would do to that row.
-- ─────────────────────────────────────────────────────────────────────────
with approved as (
  select r.id as request_id, r.employee_id, r.target_event_id, r.target_date, r.resolved_at,
         (r.requested_change->>'proposed_ts')::timestamptz as proposed_ts
  from wfm_correction_requests r
  where r.tenant_id = (select id from tenants where slug = 'bim')
    and r.status = 'approved'
    and r.target_event_id is not null
    and r.requested_change->>'proposed_ts' is not null
),
linked as (
  select a.*, e.id as event_id, e.kind, e.superseded_by
  from approved a
  join wfm_presence_events e
    on e.tenant_id = (select id from tenants where slug = 'bim')
   and e.employee_id = a.employee_id
   and e.ts = a.proposed_ts
   and e.source = 'correction'
),
contested as (
  select target_event_id from linked group by target_event_id having count(*) > 1
),
ranked as (
  select l.*,
         row_number() over (partition by l.target_event_id order by l.resolved_at desc) as rn,
         first_value(l.event_id) over (partition by l.target_event_id order by l.resolved_at desc) as winner_event_id
  from linked l
  join contested c on c.target_event_id = l.target_event_id
)
select
  emp.employee_code,
  r.target_date,
  r.kind,
  orig.ts                                            as original_punch,
  r.proposed_ts                                      as this_correction,
  r.resolved_at                                      as approved_at,
  case when r.rn = 1 then 'SURVIVES' else 'superseded' end as verdict,
  r.superseded_by                                    as currently_superseded_by,
  r.event_id,
  r.winner_event_id
from ranked r
join wfm_presence_events orig on orig.id = r.target_event_id
left join employees emp on emp.id = r.employee_id
order by emp.employee_code, r.target_date, r.kind, r.resolved_at;

-- ─────────────────────────────────────────────────────────────────────────
-- D. THE WRITE. Only after A returns zero rows and C has been spot-checked.
--    Supersedes every non-surviving correction by the surviving one, and ONLY
--    where it is still live -- a row already superseded is left alone.
-- ─────────────────────────────────────────────────────────────────────────
-- begin;
--
-- with -- approved as (
--   select r.id as request_id, r.employee_id, r.target_event_id, r.resolved_at,
--          (r.requested_change->>'proposed_ts')::timestamptz as proposed_ts
--   from wfm_correction_requests r
--   where r.tenant_id = (select id from tenants where slug = 'bim')
--     and r.status = 'approved'
--     and r.target_event_id is not null
--     and r.requested_change->>'proposed_ts' is not null
-- ),
-- linked as (
--   select a.*, e.id as event_id
--   from approved a
--   join wfm_presence_events e
--     on e.tenant_id = (select id from tenants where slug = 'bim')
--    and e.employee_id = a.employee_id
--    and e.ts = a.proposed_ts
--    and e.source = 'correction'
-- ),
-- contested as (
--   select target_event_id from linked group by target_event_id having count(*) > 1
-- ),
-- ranked as (
--   select l.*,
--          row_number() over (partition by l.target_event_id order by l.resolved_at desc) as rn,
--          first_value(l.event_id) over (partition by l.target_event_id order by l.resolved_at desc) as winner_event_id
--   from linked l
--   join contested c on c.target_event_id = l.target_event_id
-- )
-- update wfm_presence_events e
-- set superseded_by = r.winner_event_id
-- from ranked r
-- where e.id = r.event_id
--   and e.tenant_id = (select id from tenants where slug = 'bim')
--   and r.rn > 1
--   and e.superseded_by is null
--   and e.id <> r.winner_event_id;
--
-- -- Re-run C here: every row should now read 'superseded' except the
-- -- SURVIVES one in each group. Then commit.
--
-- commit;
