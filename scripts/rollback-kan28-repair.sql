-- ROLLBACK of repair-kan28-duplicate-corrections.sql, run on production
-- 2026-10-03.
--
-- Why: that repair grouped live corrections by employee + day + kind, which
-- assumes every correction in a group corrects the SAME punch. It does not.
-- An employee can work two shifts, or take two breaks, in one day, and each
-- can have its own correction. The repair collapsed those into one. Examples
-- from its own dry-run output:
--
--   68db944d  12 Sep  check_in   16:20 superseded by 04:10  (12 hours apart --
--                                a second shift, not a duplicate)
--   bb24ce03  23 Sep  break_start kept 08:30, break_end kept 16:10
--                                (a morning start paired with an evening end:
--                                an eight-hour "break")
--
-- Nothing was deleted. The repair only set `superseded_by`, and every one of
-- these rows had it NULL beforehand -- that was the repair's own WHERE
-- clause. So restoring NULL on exactly these ids returns the table to its
-- pre-repair state, with no inference involved.
--
-- The ids below are taken verbatim from the dry-run output, which is the
-- authoritative record of what the UPDATE matched.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. CHECK FIRST. Every row should currently show a non-null superseded_by.
--    Expect 22 rows. If any already show NULL, the repair did not commit and
--    there may be nothing to undo -- stop and say so.
-- ─────────────────────────────────────────────────────────────────────────
select id, employee_id, kind, ts, superseded_by
from wfm_presence_events
where tenant_id = (select id from tenants where slug = 'bim')
  and id in (
    '7e380c12-2d0f-4352-a773-f25ef6faaa4f',
    'c584060d-d5e5-4779-9958-1e536425b190',
    'cc6fcc92-ee09-47d7-90c4-12ab9db7c593',
    '4ce5e6ae-b0f5-4d2c-8747-49e49c8d7e4f',
    'afe13289-7b19-4488-add8-74a270a3233c',
    'b84f49ea-0c23-4001-b85a-643d3c09ac9c',
    '108699e3-671b-408a-b3f5-705beb51459c',
    'b11239ef-7d6b-4c01-8393-b4efb2021142',
    '7d5cf632-6f23-423a-9cde-a8da66fdf1b2',
    'f7bbf127-2f00-4db8-aeab-4e34e12f82ff',
    '8e85a7de-bb6e-4b77-b94e-f4109d9816e1',
    '717f8321-9792-4325-8199-ed9aac305f0f',
    '0091094b-cd38-418e-8f54-c1d38cb7d077',
    '98272656-043b-4679-8de4-bc54a2c9a4a2',
    'a21d4d51-527e-45c6-8bf3-2ec8cdbfe2ed',
    'ca871608-7117-45ea-8eb1-0ec8f967bf09',
    '0d2899ed-f9ba-4fb7-9e62-88b72f9c0bb7',
    'ba4cd219-24a4-4c5c-82aa-b8d9078f08b3',
    'ba08a5d2-53dd-43ad-a139-b1a97cc1f785',
    'dd6304b1-334a-4574-9c8a-a079c2b540a6',
    'f9950cd8-6315-42ca-86e6-2e2f4731890c',
    '218de5be-0878-4a84-85e7-030feacdac25'
  )
order by employee_id, ts;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. THE ROLLBACK. Run after section 1 shows 22 rows with a superseded_by.
-- ─────────────────────────────────────────────────────────────────────────
-- begin;
--
-- update wfm_presence_events
-- set superseded_by = null
-- where tenant_id = (select id from tenants where slug = 'bim')
--   and id in (
--     '7e380c12-2d0f-4352-a773-f25ef6faaa4f',
--     'c584060d-d5e5-4779-9958-1e536425b190',
--     'cc6fcc92-ee09-47d7-90c4-12ab9db7c593',
--     '4ce5e6ae-b0f5-4d2c-8747-49e49c8d7e4f',
--     'afe13289-7b19-4488-add8-74a270a3233c',
--     'b84f49ea-0c23-4001-b85a-643d3c09ac9c',
--     '108699e3-671b-408a-b3f5-705beb51459c',
--     'b11239ef-7d6b-4c01-8393-b4efb2021142',
--     '7d5cf632-6f23-423a-9cde-a8da66fdf1b2',
--     'f7bbf127-2f00-4db8-aeab-4e34e12f82ff',
--     '8e85a7de-bb6e-4b77-b94e-f4109d9816e1',
--     '717f8321-9792-4325-8199-ed9aac305f0f',
--     '0091094b-cd38-418e-8f54-c1d38cb7d077',
--     '98272656-043b-4679-8de4-bc54a2c9a4a2',
--     'a21d4d51-527e-45c6-8bf3-2ec8cdbfe2ed',
--     'ca871608-7117-45ea-8eb1-0ec8f967bf09',
--     '0d2899ed-f9ba-4fb7-9e62-88b72f9c0bb7',
--     'ba4cd219-24a4-4c5c-82aa-b8d9078f08b3',
--     'ba08a5d2-53dd-43ad-a139-b1a97cc1f785',
--     'dd6304b1-334a-4574-9c8a-a079c2b540a6',
--     'f9950cd8-6315-42ca-86e6-2e2f4731890c',
--     '218de5be-0878-4a84-85e7-030feacdac25'
--   );
--
-- -- Expect 22. If it is not 22, do NOT commit -- tell me the number.
-- -- (Postgres reports this as "UPDATE 22".)
--
-- commit;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. DID THE REPAIR TOUCH ANYTHING ELSE?
--    The dry-run and the UPDATE ran at different moments. If a correction was
--    approved in between, the UPDATE could have matched a row not listed
--    above. This finds any correction superseded BY ANOTHER CORRECTION, which
--    is the shape the repair created and which the app itself never produces
--    (the app supersedes an original by a correction, not a correction by a
--    correction, now that approve walks to the head of the chain).
-- ─────────────────────────────────────────────────────────────────────────
select victim.id, victim.employee_id, victim.kind, victim.ts,
       winner.id as superseded_by, winner.ts as winner_ts
from wfm_presence_events victim
join wfm_presence_events winner on winner.id = victim.superseded_by
where victim.tenant_id = (select id from tenants where slug = 'bim')
  and victim.source = 'correction'
  and winner.source = 'correction'
  and victim.ts >= '2026-09-01'
order by victim.employee_id, victim.ts;
