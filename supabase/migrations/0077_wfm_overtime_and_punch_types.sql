-- 0077_wfm_overtime_and_punch_types.sql
--
-- Adds the punch types behind the ADP-style punch-type dropdown, and makes
-- overtime a first-class, separately-approved, separately-paid session.
--
-- Client (Vikas) rules this implements:
--   * OT is punched as its own in/out pair -- the employee checks OUT of the
--     regular shift first, then punches OT in. The state machine
--     (src/lib/wfm/types.ts) only allows ot_in from the `out` state, so OT
--     can never be nested between a check-in and a check-out.
--   * OT is paid hour-wise on ACTUAL minutes -- no rounding anywhere.
--   * OT counts toward pay only after a supervisor approves it.
--   * An OT stretch may run past midnight (potentially all night); the
--     session row carries its own ot_date = the day it STARTED, so it stays
--     one payable block instead of splitting across two calendar days.

-- ── 1. New punch kinds ──────────────────────────────────────────────────────
-- mobile_work_* and business_trip_* are ordinary working time under a
-- different label (the hours engine treats them exactly like check_in/out);
-- ot_* is the separate session type described above.
alter table wfm_presence_events drop constraint if exists wfm_presence_events_kind_check;
alter table wfm_presence_events add constraint wfm_presence_events_kind_check
  check (kind in (
    'check_in', 'check_out', 'break_start', 'break_end',
    'ot_in', 'ot_out',
    'mobile_work_start', 'mobile_work_end',
    'business_trip_start', 'business_trip_end'
  ));

-- ── 2. Overtime sessions ────────────────────────────────────────────────────
create table if not exists wfm_ot_sessions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  employee_id     uuid not null references employees(id) on delete cascade,
  -- Shift-day the session started on (tenant timezone), NOT derived at read
  -- time: an all-night OT stretch must stay attributed to its start day.
  ot_date         date not null,
  start_event_id  uuid references wfm_presence_events(id) on delete set null,
  end_event_id    uuid references wfm_presence_events(id) on delete set null,
  started_at      timestamptz not null,
  ended_at        timestamptz not null,
  -- Exact minutes worked. No rounding -- pay is hour-wise on actuals.
  minutes         integer not null check (minutes >= 0),
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected')),
  supervisor_remark text,
  resolved_by     uuid,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists wfm_ot_sessions_tenant_status_idx
  on wfm_ot_sessions (tenant_id, status, ot_date desc);
create index if not exists wfm_ot_sessions_employee_idx
  on wfm_ot_sessions (tenant_id, employee_id, ot_date desc);
-- One session per closing punch: makes the offline-sync retry that replays an
-- ot_out idempotent instead of creating a duplicate payable block.
create unique index if not exists wfm_ot_sessions_end_event_uniq
  on wfm_ot_sessions (end_event_id) where end_event_id is not null;

alter table wfm_ot_sessions enable row level security;

create policy "wfm_ot_sessions: tenant isolation" on wfm_ot_sessions for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
