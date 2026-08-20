-- 0094: narrow two WFM tables whose SELECT policy is looser than the app.
--
-- Both tables are read in the app ONLY through the service-role client
-- (createAdminSupabase, which bypasses RLS), so tightening the policy that
-- governs DIRECT PostgREST access (a member's own JWT + the public anon
-- key) changes NOTHING for the application and closes a member-to-member
-- data leak. Same own-row-or-supervisor shape 0063 applied to
-- wfm_presence_events / wfm_correction_requests.
--
-- 1. wfm_face_enrollments — was tenant-wide (0092): any logged-in member
--    could enumerate every colleague's biometric enrollment (status,
--    consent time, Rekognition template ids, photo paths) via
--    GET /rest/v1/wfm_face_enrollments. The API route already narrows
--    non-supervisors to their own row; RLS did not back it.
-- 2. wfm_leave_records — was tenant-wide (0062): any member could read
--    every colleague's leave dates and free-text `remarks` (health-
--    adjacent PII). Inconsistent with wfm_leave_requests, whose reason_text
--    0064 already scoped to own-or-supervisor.
--
-- Writes stay service-role-only on both (no insert/update/delete policy is
-- added here, and none existed — the WFM select-only convention).

drop policy if exists "wfm_face_enrollments: tenant read" on wfm_face_enrollments;
create policy "wfm_face_enrollments: own rows or supervisor" on wfm_face_enrollments for select
  using (
    employee_id in (
      select employee_id from tenant_users
      where user_id = auth.uid()
        and tenant_id = wfm_face_enrollments.tenant_id
        and employee_id is not null
    )
    or exists (
      select 1 from tenant_users tu
      left join employees e on e.id = tu.employee_id
      where tu.user_id = auth.uid()
        and tu.tenant_id = wfm_face_enrollments.tenant_id
        and (tu.role = 'admin' or e.wfm_role = 'supervisor')
    )
  );

drop policy if exists "wfm_leave_records: tenant read" on wfm_leave_records;
create policy "wfm_leave_records: own rows or supervisor" on wfm_leave_records for select
  using (
    employee_id in (
      select employee_id from tenant_users
      where user_id = auth.uid()
        and tenant_id = wfm_leave_records.tenant_id
        and employee_id is not null
    )
    or exists (
      select 1 from tenant_users tu
      left join employees e on e.id = tu.employee_id
      where tu.user_id = auth.uid()
        and tu.tenant_id = wfm_leave_records.tenant_id
        and (tu.role = 'admin' or e.wfm_role = 'supervisor')
    )
  );
