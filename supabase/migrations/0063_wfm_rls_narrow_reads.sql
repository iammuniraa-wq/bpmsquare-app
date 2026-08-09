-- 0063_wfm_rls_narrow_reads.sql
-- Closes a real gap found in the 2026-08-05 security review: the select
-- policies on wfm_presence_events and wfm_correction_requests (0062) were
-- scoped to tenant membership only -- the same "RLS = tenant isolation,
-- role/ownership narrowing = API layer" convention already used for
-- `employees`/`business_roles` in this codebase. That convention is fine
-- for config rows; it is NOT fine here, because it let any authenticated
-- tenant member read every co-worker's live GPS coordinates, selfie
-- storage path, and correction dispute text directly via the Supabase
-- REST API (anon key + their own session JWT) -- bypassing the
-- supervisor-only gating every Next.js route already enforces. Narrowed to:
-- the employee's own rows, or a supervisor/admin of that tenant.
--
-- (employees/business_roles have the identical pre-existing gap for their
-- own, less-sensitive data -- intentionally left alone here; that's a
-- separate, non-WFM-scoped decision.)

drop policy "wfm_presence_events: tenant read" on wfm_presence_events;
create policy "wfm_presence_events: own rows or supervisor" on wfm_presence_events for select
  using (
    employee_id in (
      select employee_id from tenant_users
      where user_id = auth.uid()
        and tenant_id = wfm_presence_events.tenant_id
        and employee_id is not null
    )
    or exists (
      select 1 from tenant_users tu
      left join employees e on e.id = tu.employee_id
      where tu.user_id = auth.uid()
        and tu.tenant_id = wfm_presence_events.tenant_id
        and (tu.role = 'admin' or e.wfm_role = 'supervisor')
    )
  );

drop policy "wfm_correction_requests: tenant read" on wfm_correction_requests;
create policy "wfm_correction_requests: own rows or supervisor" on wfm_correction_requests for select
  using (
    employee_id in (
      select employee_id from tenant_users
      where user_id = auth.uid()
        and tenant_id = wfm_correction_requests.tenant_id
        and employee_id is not null
    )
    or exists (
      select 1 from tenant_users tu
      left join employees e on e.id = tu.employee_id
      where tu.user_id = auth.uid()
        and tu.tenant_id = wfm_correction_requests.tenant_id
        and (tu.role = 'admin' or e.wfm_role = 'supervisor')
    )
  );
