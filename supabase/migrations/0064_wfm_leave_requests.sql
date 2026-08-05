-- 0064_wfm_leave_requests.sql
-- Employee-initiated leave requests -- v1 (0062) deliberately had no
-- self-application workflow, admin-entered wfm_leave_records only. Same
-- request -> supervisor approve/reject shape as wfm_correction_requests
-- (0062/0063): approving never edits anything in place, it inserts a real
-- wfm_leave_records row (the only thing that actually affects balance/
-- monthly summary); rejecting just marks the request rejected. RLS is
-- narrowed to "own rows or supervisor/admin" from the start, matching the
-- 0063 fix rather than repeating the original tenant-wide gap it closed.

create table wfm_leave_requests (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  employee_id       uuid not null references employees(id) on delete cascade,
  leave_type_id     uuid not null references wfm_leave_types(id),
  date_from         date not null,
  date_to           date not null,
  half_day          boolean not null default false,
  reason_text       text not null,
  status            text not null default 'pending'
                      check (status in ('pending', 'approved', 'rejected')),
  supervisor_id     uuid references auth.users(id) on delete set null,
  supervisor_remark text,
  resolved_at       timestamptz,
  -- Set only on approval, to the wfm_leave_records row it created --
  -- lets a request's UI reflect the resulting record without a second
  -- lookup, and is the audit trail of "this record came from this request".
  leave_record_id   uuid references wfm_leave_records(id) on delete set null,
  created_at        timestamptz not null default now(),
  check (date_to >= date_from)
);

create index wfm_leave_requests_tenant_idx on wfm_leave_requests (tenant_id, status);
create index wfm_leave_requests_emp_idx on wfm_leave_requests (tenant_id, employee_id);

alter table wfm_leave_requests enable row level security;
create policy "wfm_leave_requests: own rows or supervisor" on wfm_leave_requests for select
  using (
    employee_id in (
      select employee_id from tenant_users
      where user_id = auth.uid()
        and tenant_id = wfm_leave_requests.tenant_id
        and employee_id is not null
    )
    or exists (
      select 1 from tenant_users tu
      left join employees e on e.id = tu.employee_id
      where tu.user_id = auth.uid()
        and tu.tenant_id = wfm_leave_requests.tenant_id
        and (tu.role = 'admin' or e.wfm_role = 'supervisor')
    )
  );
