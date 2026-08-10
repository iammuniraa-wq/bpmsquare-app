-- 0072_wfm_roster_recheck_supervisor.sql
-- WFM v2: per-date shift roster, supervisor-initiated recheck requests, and
-- an explicit supervisor→employee reporting line. Same conventions as
-- 0062/0063 (see those headers for the full rationale).

-- ── Roster assignments (per-date shift, replacing the single standing
--    shift for any date that has an explicit row) ──────────────────────────
-- employees.shift_id (0062) stays as the FALLBACK "standing shift" used
-- whenever no roster row exists for a given date -- rostering is additive,
-- not a replacement, so a tenant that never touches this table keeps
-- working exactly as before. Not GPS/selfie data, so this follows the
-- plain tenant-read pattern (like wfm_shifts/wfm_sites), not the narrowed
-- own-rows-or-supervisor pattern 0063 introduced for presence/corrections.

create table wfm_roster_assignments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  date        date not null,
  shift_id    uuid references wfm_shifts(id) on delete set null,
  site_id     uuid references wfm_sites(id) on delete set null,
  -- shift_id null = an explicit day OFF (overrides the standing shift),
  -- distinct from "no roster row" (falls back to the standing shift).
  is_day_off  boolean not null default false,
  note        text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (tenant_id, employee_id, date)
);

create index wfm_roster_assignments_tenant_date_idx on wfm_roster_assignments (tenant_id, date);
create index wfm_roster_assignments_emp_idx on wfm_roster_assignments (tenant_id, employee_id, date);

alter table wfm_roster_assignments enable row level security;
create policy "wfm_roster_assignments: tenant read" on wfm_roster_assignments for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ── Recheck requests (supervisor → employee, full separate workflow) ─────
-- Deliberately its own table, not a variant of wfm_correction_requests --
-- direction and lifecycle both run the other way: a supervisor opens it
-- (flagging a punch/selfie as questionable), the employee responds
-- (acknowledge, explain, or file an actual correction request referencing
-- this recheck), and the supervisor closes it out. target_event_id is
-- nullable because a supervisor can flag a whole day (e.g. "no selfie on
-- any punch today") without pointing at one specific event.
-- Same "own rows or supervisor" narrowing as 0063 -- an employee's response
-- text and a supervisor's note about them are exactly the same sensitivity
-- class as correction dispute text.

create table wfm_recheck_requests (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  employee_id           uuid not null references employees(id) on delete cascade,
  target_date           date not null,
  target_event_id       uuid references wfm_presence_events(id) on delete set null,
  recheck_type          text not null default 'both'
                          check (recheck_type in ('time', 'selfie', 'both')),
  supervisor_id         uuid not null references auth.users(id) on delete cascade,
  message               text not null,
  status                text not null default 'pending'
                          check (status in ('pending', 'responded', 'resolved', 'dismissed')),
  employee_response_text text,
  employee_responded_at  timestamptz,
  -- set when the employee's response was to file a real correction request,
  -- so a supervisor reviewing the recheck can jump straight to it.
  linked_correction_id   uuid references wfm_correction_requests(id) on delete set null,
  resolved_by            uuid references auth.users(id) on delete set null,
  resolved_at             timestamptz,
  created_at              timestamptz not null default now()
);

create index wfm_recheck_requests_tenant_idx on wfm_recheck_requests (tenant_id, status);
create index wfm_recheck_requests_emp_idx on wfm_recheck_requests (tenant_id, employee_id);

alter table wfm_recheck_requests enable row level security;
create policy "wfm_recheck_requests: own rows or supervisor" on wfm_recheck_requests for select
  using (
    employee_id in (
      select employee_id from tenant_users
      where user_id = auth.uid()
        and tenant_id = wfm_recheck_requests.tenant_id
        and employee_id is not null
    )
    or exists (
      select 1 from tenant_users tu
      left join employees e on e.id = tu.employee_id
      where tu.user_id = auth.uid()
        and tu.tenant_id = wfm_recheck_requests.tenant_id
        and (tu.role = 'admin' or e.wfm_role = 'supervisor')
    )
  );

-- ── Explicit reporting line ──────────────────────────────────────────────
-- Without this, "supervisor" is tenant-wide (any wfm_role=supervisor
-- employee can see/approve everyone) -- fine for a small team, not for
-- routing notifications or scoping queues once a tenant has several
-- supervisors. Nullable: unset = falls back to the existing tenant-wide
-- behavior everywhere (requireWfmSupervisor() is unchanged by this column).
alter table employees
  add column supervisor_id uuid references employees(id) on delete set null;

create index employees_supervisor_idx on employees (tenant_id, supervisor_id);

-- ── email_log: widen kind for the new WFM notification sends ────────────

alter table email_log drop constraint email_log_kind_check;
alter table email_log add constraint email_log_kind_check check (kind in ('quote', 'campaign', 'wfm'));
