-- 0123_wfm_advance_requests_and_clarifications.sql
-- WFM: a single "Requests" surface for the two punch types that had no
-- pre-approval step at all (OT, work-from-home), plus a real back-and-forth
-- clarification thread instead of the one-shot correction/recheck reply.
-- Same conventions as every prior WFM migration (0062/0063/0072/0064): own-
-- rows-or-supervisor SELECT only, no insert/update/delete policy -- every
-- write goes through the API layer on the admin client (see that module's
-- header in 0062 for why: "no employee can alter attendance data").

-- ── Advance requests (OT / WFH) ──────────────────────────────────────────
-- Leave already has its own mature request→approve flow (wfm_leave_requests,
-- 0064) with its own balance/record side-effects -- this is NOT folded into
-- that table. OT and WFH are structurally identical to each other (a date
-- range + a reason, approved or rejected, no side-effect record to write),
-- so they share ONE table with a `kind` discriminator instead of two nearly-
-- identical tables.
--
-- Owner decision 2026-09-09: OT stays exactly as it works today -- you punch
-- OT in/out first, a supervisor approves the ALREADY-WORKED session after
-- (wfm_ot_sessions, unchanged). An `ot` row here is advance notice only ("I
-- expect to work late tonight") and never gates the ot_in/ot_out punch.
-- WFH is the opposite: mobile_work_start is BLOCKED unless an approved `wfh`
-- row here covers today (enforced in api/wfm/punch/route.ts via
-- isWfhApprovedForDate(), lib/wfm/advanceRequests.ts) -- this is the actual
-- gate the original brainstorm item asked for, scoped to WFH only.

create table wfm_advance_requests (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  employee_id       uuid not null references employees(id) on delete cascade,
  kind              text not null check (kind in ('ot', 'wfh')),
  date_from         date not null,
  date_to           date not null,
  reason_text       text not null,
  status            text not null default 'pending'
                      check (status in ('pending', 'approved', 'rejected')),
  supervisor_id     uuid references auth.users(id) on delete set null,
  supervisor_remark text,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  check (date_to >= date_from)
);

create index wfm_advance_requests_tenant_idx on wfm_advance_requests (tenant_id, status);
create index wfm_advance_requests_emp_idx on wfm_advance_requests (tenant_id, employee_id);
-- The WFH punch gate checks this exact shape on every mobile_work_start --
-- kind+status narrows it to a handful of rows before the date range compare.
create index wfm_advance_requests_wfh_gate_idx
  on wfm_advance_requests (tenant_id, employee_id, kind, status, date_from, date_to);

alter table wfm_advance_requests enable row level security;
create policy "wfm_advance_requests: own rows or supervisor" on wfm_advance_requests for select
  using (
    employee_id in (
      select employee_id from tenant_users
      where user_id = auth.uid()
        and tenant_id = wfm_advance_requests.tenant_id
        and employee_id is not null
    )
    or exists (
      select 1 from tenant_users tu
      left join employees e on e.id = tu.employee_id
      where tu.user_id = auth.uid()
        and tu.tenant_id = wfm_advance_requests.tenant_id
        and (tu.role = 'admin' or e.wfm_role = 'supervisor')
    )
  );

-- ── Clarification threads ────────────────────────────────────────────────
-- Generalizes the one-shot "correction request + single supervisor remark"
-- and "recheck request + single employee reply" into an actual multi-message
-- thread either side can start, anchored to whichever specific record the
-- question is about -- so "which day are we even talking about" never comes
-- up. wfm_correction_requests/wfm_recheck_requests are UNCHANGED: those stay
-- the system of record for approve/reject *decisions*; a thread is the
-- conversation around one, or around a plain punch/OT session, or (anchor
-- 'general') not tied to a specific record at all.
--
-- Exactly one of the three target_* columns is set, matching the anchor_type
-- -- explicit typed FKs rather than one untyped polymorphic id, so referential
-- integrity is real (same reasoning as wfm_correction_requests.target_event_id).

create table wfm_clarification_threads (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  -- Whose attendance this is about -- always set, even when a supervisor
  -- opened the thread (mirrors wfm_recheck_requests.employee_id).
  employee_id     uuid not null references employees(id) on delete cascade,
  anchor_type     text not null check (anchor_type in ('general', 'punch', 'correction', 'ot_session')),
  target_event_id      uuid references wfm_presence_events(id) on delete set null,
  target_correction_id uuid references wfm_correction_requests(id) on delete set null,
  target_ot_session_id uuid references wfm_ot_sessions(id) on delete set null,
  subject         text not null,
  status          text not null default 'open' check (status in ('open', 'resolved')),
  opened_by_role  text not null check (opened_by_role in ('employee', 'supervisor')),
  resolved_by     uuid references auth.users(id) on delete set null,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  -- Bumped on every new message so the unified inbox can sort by recency
  -- without a join into the messages table.
  updated_at      timestamptz not null default now(),
  check (
    (anchor_type = 'general'    and target_event_id is null and target_correction_id is null and target_ot_session_id is null) or
    (anchor_type = 'punch'      and target_event_id is not null and target_correction_id is null and target_ot_session_id is null) or
    (anchor_type = 'correction' and target_event_id is null and target_correction_id is not null and target_ot_session_id is null) or
    (anchor_type = 'ot_session' and target_event_id is null and target_correction_id is null and target_ot_session_id is not null)
  )
);

create index wfm_clarification_threads_tenant_idx on wfm_clarification_threads (tenant_id, status, updated_at desc);
create index wfm_clarification_threads_emp_idx on wfm_clarification_threads (tenant_id, employee_id, updated_at desc);

alter table wfm_clarification_threads enable row level security;
create policy "wfm_clarification_threads: own rows or supervisor" on wfm_clarification_threads for select
  using (
    employee_id in (
      select employee_id from tenant_users
      where user_id = auth.uid()
        and tenant_id = wfm_clarification_threads.tenant_id
        and employee_id is not null
    )
    or exists (
      select 1 from tenant_users tu
      left join employees e on e.id = tu.employee_id
      where tu.user_id = auth.uid()
        and tu.tenant_id = wfm_clarification_threads.tenant_id
        and (tu.role = 'admin' or e.wfm_role = 'supervisor')
    )
  );

create table wfm_clarification_messages (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  thread_id      uuid not null references wfm_clarification_threads(id) on delete cascade,
  -- Denormalized from the thread (never a per-row lookup) so this table's own
  -- RLS policy stays a flat comparison, same performance reasoning as every
  -- other WFM table in this module.
  employee_id    uuid not null references employees(id) on delete cascade,
  sender_role    text not null check (sender_role in ('employee', 'supervisor')),
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  body           text not null,
  created_at     timestamptz not null default now()
);

create index wfm_clarification_messages_thread_idx on wfm_clarification_messages (thread_id, created_at);

alter table wfm_clarification_messages enable row level security;
create policy "wfm_clarification_messages: own rows or supervisor" on wfm_clarification_messages for select
  using (
    employee_id in (
      select employee_id from tenant_users
      where user_id = auth.uid()
        and tenant_id = wfm_clarification_messages.tenant_id
        and employee_id is not null
    )
    or exists (
      select 1 from tenant_users tu
      left join employees e on e.id = tu.employee_id
      where tu.user_id = auth.uid()
        and tu.tenant_id = wfm_clarification_messages.tenant_id
        and (tu.role = 'admin' or e.wfm_role = 'supervisor')
    )
  );
