-- 0062_wfm_module.sql
-- WFM (Workforce Management: time, attendance & leave) module — full v1 schema.
-- Design per WFM_INTEGRATION_MAP.md (approved 2026-08-05), with one revision
-- made here: the person model EXTENDS the existing `employees` master-data
-- table (0057) instead of creating a parallel wfm_employees table — 0057
-- landed on develop after the map was written against main, and it is
-- exactly the "existing people table" the requirements say to extend.
-- A login's employee record resolves via the existing tenant_users.employee_id
-- link (Business Users), not a new user_id column.
--
-- RLS model — deliberately STRICTER than the standard tenant pattern:
-- every new table gets tenant-scoped SELECT for session clients, but NO
-- insert/update/delete policies at all. Attendance data must not be
-- alterable by employees ("no employee can alter attendance data" is a
-- contract-facing acceptance criterion), and the standard `for all` policy
-- would let any tenant member write rows directly via the REST API with
-- their own session. All writes therefore go through /api/wfm/** routes
-- using the service-role client with explicit tenant + role checks.
-- Employee-level read narrowing (own rows only) is enforced at the API
-- layer, matching the codebase convention that role gating lives in API
-- routes (see 0052_business_roles.sql header).

-- ── Sites (geofenced punch locations) ────────────────────────────────────

create table wfm_sites (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null,
  lat        double precision not null,
  lng        double precision not null,
  radius_m   integer not null default 150,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create index wfm_sites_tenant_idx on wfm_sites (tenant_id);

alter table wfm_sites enable row level security;
create policy "wfm_sites: tenant read" on wfm_sites for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ── Shifts ───────────────────────────────────────────────────────────────

create table wfm_shifts (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id) on delete cascade,
  name                   text not null,
  start_time             time not null,
  end_time               time not null,
  grace_minutes          integer not null default 10,
  is_night_shift         boolean not null default false,
  night_allowance_amount numeric not null default 0,
  -- end before start = the shift runs past midnight; all events on such a
  -- shift attribute to the shift's START date (rules engine).
  crosses_midnight       boolean generated always as (end_time < start_time) stored,
  active                 boolean not null default true,
  created_at             timestamptz not null default now()
);

create index wfm_shifts_tenant_idx on wfm_shifts (tenant_id);

alter table wfm_shifts enable row level security;
create policy "wfm_shifts: tenant read" on wfm_shifts for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ── Extend the employees master-data table with WFM fields ───────────────

alter table employees
  add column employment_type     text not null default 'full_time'
                                   check (employment_type in ('full_time', 'contractor')),
  add column shift_id            uuid references wfm_shifts(id) on delete set null,
  add column site_id             uuid references wfm_sites(id) on delete set null,
  add column wfm_role            text not null default 'employee'
                                   check (wfm_role in ('employee', 'supervisor')),
  add column technician_id       uuid references technicians(id) on delete set null,
  add column enrolled_photo_path text,
  add column consent_recorded_at timestamptz;

-- Attendance integrity: employees now carries fields that feed lateness and
-- consent logic (shift_id, site_id, consent_recorded_at). The 0057 `for all`
-- policy let ANY tenant member update any employees row directly via REST —
-- e.g. reassign themselves a later shift to dodge late marks. Every
-- legitimate mutation path (api/employees, api/business-users, Data
-- Workbench) is already admin-gated and works fine under an admin-only
-- write policy; member READ stays open (company directory).

drop policy "employees: tenant isolation" on employees;

create policy "employees: tenant read" on employees for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "employees: admin insert" on employees for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'));

create policy "employees: admin update" on employees for update
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'));

create policy "employees: admin delete" on employees for delete
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'));

-- ── Leave types / records / quotas ───────────────────────────────────────

create table wfm_leave_types (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null,
  category   text not null check (category in ('paid', 'unpaid', 'half_day')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create index wfm_leave_types_tenant_idx on wfm_leave_types (tenant_id);

alter table wfm_leave_types enable row level security;
create policy "wfm_leave_types: tenant read" on wfm_leave_types for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- Admin-entered only in v1 (no employee application workflow).
create table wfm_leave_records (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  employee_id   uuid not null references employees(id) on delete cascade,
  leave_type_id uuid not null references wfm_leave_types(id),
  date_from     date not null,
  date_to       date not null,
  half_day      boolean not null default false,
  remarks       text,
  entered_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  check (date_to >= date_from)
);

create index wfm_leave_records_tenant_idx on wfm_leave_records (tenant_id);
create index wfm_leave_records_emp_idx on wfm_leave_records (tenant_id, employee_id, date_from);

alter table wfm_leave_records enable row level security;
create policy "wfm_leave_records: tenant read" on wfm_leave_records for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- employee_id null = the tenant-wide default quota for that leave type;
-- a row with employee_id set overrides it for that employee.
create table wfm_leave_quotas (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  leave_type_id uuid not null references wfm_leave_types(id) on delete cascade,
  employee_id   uuid references employees(id) on delete cascade,
  annual_quota  numeric not null default 0,
  created_at    timestamptz not null default now()
);

create index wfm_leave_quotas_tenant_idx on wfm_leave_quotas (tenant_id);
create unique index wfm_leave_quotas_default_idx
  on wfm_leave_quotas (tenant_id, leave_type_id) where employee_id is null;
create unique index wfm_leave_quotas_override_idx
  on wfm_leave_quotas (tenant_id, leave_type_id, employee_id) where employee_id is not null;

alter table wfm_leave_quotas enable row level security;
create policy "wfm_leave_quotas: tenant read" on wfm_leave_quotas for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ── Holiday calendar ─────────────────────────────────────────────────────

create table wfm_holidays (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  date       date not null,
  name       text not null,
  applies_to text not null default 'all'
               check (applies_to in ('all', 'full_time', 'contractor')),
  created_at timestamptz not null default now(),
  unique (tenant_id, date, applies_to)
);

create index wfm_holidays_tenant_idx on wfm_holidays (tenant_id, date);

alter table wfm_holidays enable row level security;
create policy "wfm_holidays: tenant read" on wfm_holidays for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ── Presence events (the source-agnostic stream — append-only) ───────────
-- Corrections never UPDATE an event: they insert a new event with
-- source='correction' and stamp superseded_by on the old one. Downstream
-- logic reads only rows with superseded_by is null. The id is the client's
-- idempotency key for offline sync (duplicate insert = success).

create table wfm_presence_events (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  employee_id      uuid not null references employees(id) on delete cascade,
  ts               timestamptz not null,
  kind             text not null
                     check (kind in ('check_in', 'check_out', 'break_start', 'break_end')),
  -- extensible later: kiosk | adms | mobile_gps (widen the check then)
  source           text not null
                     check (source in ('web_selfie', 'manual_admin', 'correction')),
  site_id          uuid references wfm_sites(id) on delete set null,
  geo_lat          double precision,
  geo_lng          double precision,
  geo_accuracy_m   numeric,
  within_geofence  boolean,
  selfie_path      text,
  flags            jsonb not null default '{}',
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  superseded_by    uuid references wfm_presence_events(id)
);

create index wfm_presence_events_emp_ts_idx on wfm_presence_events (tenant_id, employee_id, ts);
create index wfm_presence_events_ts_idx on wfm_presence_events (tenant_id, ts);

alter table wfm_presence_events enable row level security;
create policy "wfm_presence_events: tenant read" on wfm_presence_events for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ── Correction requests ──────────────────────────────────────────────────

create table wfm_correction_requests (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  employee_id       uuid not null references employees(id) on delete cascade,
  target_date       date not null,
  target_event_id   uuid references wfm_presence_events(id) on delete set null,
  -- e.g. {"issue":"missing_check_out","proposed_ts":"2026-08-05T18:30:00+05:30"}
  requested_change  jsonb not null,
  reason_text       text not null,
  status            text not null default 'pending'
                      check (status in ('pending', 'approved', 'rejected')),
  supervisor_id     uuid references auth.users(id) on delete set null,
  supervisor_remark text,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index wfm_correction_requests_tenant_idx on wfm_correction_requests (tenant_id, status);
create index wfm_correction_requests_emp_idx on wfm_correction_requests (tenant_id, employee_id);

alter table wfm_correction_requests enable row level security;
create policy "wfm_correction_requests: tenant read" on wfm_correction_requests for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ── Storage: private bucket for punch selfies + enrollment photos ────────
-- PRIVATE (public = false) — selfies are DPDP-sensitive PII and must never
-- be publicly addressable (unlike the public company-assets bucket). No
-- storage.objects policies are created on purpose: only the service-role
-- client (API routes) can write or read objects; supervisors get
-- short-lived signed URLs minted server-side. Path convention:
-- {tenant_id}/{employee_id}/{yyyy-mm}/{uuid}.jpg — first segment is the
-- tenant id, matching the (storage.foldername(name))[1] convention, in
-- case scoped policies are ever added later.

insert into storage.buckets (id, name, public)
values ('wfm', 'wfm', false)
on conflict (id) do nothing;

-- ── Feature flag: demo tenant only ───────────────────────────────────────
-- Same demo-first rollout convention as 0056; a later migration enables it
-- for real tenants once field-tested (like 0060 did for the client).

update tenants
set features = features || '{"wfm": true}'::jsonb
where is_demo = true;
