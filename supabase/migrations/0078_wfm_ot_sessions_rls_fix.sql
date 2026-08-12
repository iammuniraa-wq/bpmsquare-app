-- 0078_wfm_ot_sessions_rls_fix.sql
-- SECURITY FIX for a regression introduced by 0077 the same day.
--
-- 0077 created wfm_ot_sessions with the STANDARD tenant-isolation policy:
--
--   create policy "wfm_ot_sessions: tenant isolation" on wfm_ot_sessions for all
--     using  (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
--     with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
--
-- `for all` = SELECT + INSERT + UPDATE + DELETE. That is exactly the pattern
-- 0062's header forbids for this module, in as many words: "NO insert/update/
-- delete policies at all. Attendance data must not be alterable by employees
-- ('no employee can alter attendance data' is a contract-facing acceptance
-- criterion), and the standard `for all` policy would let any tenant member
-- write rows directly via the REST API with their own session." Every other
-- WFM table (sites, shifts, leave types/records/quotas, holidays, presence
-- events, correction requests, leave requests, roster, rechecks) is select-only.
-- wfm_ot_sessions was the one table that got the generic policy -- and it is
-- the one table that directly drives PAY.
--
-- Impact while it was live: the Supabase anon key is NEXT_PUBLIC_* and the
-- session cookie is intentionally non-httpOnly (a @supabase/ssr architectural
-- requirement), so any authenticated employee had everything needed, in their
-- own browser, to POST straight to /rest/v1/wfm_ot_sessions with
-- {"status":"approved"} and any minutes they liked. getMonthlySummary counts
-- rows on status === "approved" (monthlySummary.ts:194) and prices them at
-- ot_amount = (minutes / 60) * ot_rate_per_hour (:308), so a forged row lands
-- in the supervisor's Monthly Summary and the CA Excel export as legitimate
-- approved overtime. The same policy also allowed UPDATE (self-approving a
-- genuinely pending session, bypassing the supervisor route entirely) and
-- DELETE (destroying a co-worker's OT record).
--
-- Fixed to match 0063's own-rows-or-supervisor SELECT policy, with no write
-- policy at all. The API's writes are unaffected: POST /api/wfm/punch and
-- PATCH /api/wfm/ot-sessions/[id] both use createAdminSupabase(), which
-- bypasses RLS.

drop policy if exists "wfm_ot_sessions: tenant isolation" on wfm_ot_sessions;

create policy "wfm_ot_sessions: own rows or supervisor" on wfm_ot_sessions for select
  using (
    employee_id in (
      select employee_id from tenant_users
      where user_id = auth.uid()
        and tenant_id = wfm_ot_sessions.tenant_id
        and employee_id is not null
    )
    or exists (
      select 1 from tenant_users tu
      left join employees e on e.id = tu.employee_id
      where tu.user_id = auth.uid()
        and tu.tenant_id = wfm_ot_sessions.tenant_id
        and (tu.role = 'admin' or e.wfm_role = 'supervisor')
    )
  );

-- A belt-and-braces CHECK requiring start_event_id/end_event_id to be non-null
-- (the shape a hand-forged row can't produce, since wfm_presence_events has no
-- insert policy) was considered and deliberately NOT added: both columns are
-- `on delete set null`, so the constraint would make deleting a presence event
-- fail outright rather than null the reference. Events are append-only today,
-- but trading a real operational failure mode for defense against a policy
-- regression isn't a good exchange. The RLS policy above is the fix.

-- ── AUDIT (run manually) ──────────────────────────────────────────────────
-- Any row matching either shape was not created by the punch route and should
-- be treated as suspect:
--
--   select id, tenant_id, employee_id, ot_date, minutes, status, resolved_by, created_at
--   from wfm_ot_sessions
--   where start_event_id is null
--      or end_event_id is null
--      or (status <> 'pending' and resolved_by is null)
--   order by created_at;
--
-- Exposure window: 0077 applied -> 0078 applied. Given the module went live
-- with overtime the same day, the expected result is zero rows.
