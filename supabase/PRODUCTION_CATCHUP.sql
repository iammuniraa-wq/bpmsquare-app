-- PRODUCTION_CATCHUP.sql
-- Brings the PRODUCTION database up to the schema that `main` is already
-- running. Written 2026-08-06 during the vikas.bpmsquare.com incident.
--
-- WHY THIS FILE EXISTS
-- Migration 0057 (Employees + Business Users) was merged to main and
-- DEPLOYED, but its SQL was never run against production. The deployed
-- middleware selects tenant_users.is_locked/valid_from/valid_to on every
-- request for a non-platform-admin; those columns did not exist, the query
-- errored, membership came back null, and every real client user was told
-- "This account doesn't have access to Vikas Pioneers". Platform admins were
-- unaffected because they are resolved before that query runs -- which is
-- why the outage was invisible to us.
--
-- Every statement below is idempotent (if not exists / guarded), so this is
-- safe to run more than once and safe to run after the emergency hotfix that
-- added only is_locked, valid_from and valid_to.
--
-- SCOPE: 0057 only -- the gap that main's deployed code actually requires.
-- 0062-0067 (WFM, standard roles, geo address, module flags) are NOT here:
-- that code is on develop and must not be applied to production before the
-- merge. See MERGE_PLAN_develop_to_main.md.

begin;

-- ── 0057: employees ───────────────────────────────────────────────────────
create table if not exists employees (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  first_name    text not null,
  last_name     text not null default '',
  employee_code text,
  email         text,
  phone         text,
  department    text,
  designation   text,
  valid_from    date,
  valid_to      date,
  status        text not null default 'active' check (status in ('active', 'inactive')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, employee_code)
);

create index if not exists employees_tenant_idx
  on employees (tenant_id, last_name, first_name);

alter table employees enable row level security;

-- create policy has no "if not exists"; drop-then-create keeps this re-runnable.
drop policy if exists "employees: tenant isolation" on employees;
create policy "employees: tenant isolation" on employees for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ── 0057: business-user columns on tenant_users ───────────────────────────
-- is_locked / valid_from / valid_to are what the deployed middleware reads.
-- Defaults are deliberately permissive: not locked, no validity bounds, so
-- every EXISTING membership stays active and nobody's access changes.
alter table tenant_users
  add column if not exists employee_id  uuid references employees(id) on delete set null,
  add column if not exists display_name text,
  add column if not exists is_locked    boolean not null default false,
  add column if not exists valid_from   date,
  add column if not exists valid_to     date,
  add column if not exists counted      boolean not null default true;

create unique index if not exists tenant_users_employee_uniq
  on tenant_users (tenant_id, employee_id)
  where employee_id is not null;

commit;

-- PostgREST caches the schema; new columns stay invisible to the API until
-- it reloads. Run this last, and outside the transaction.
notify pgrst, 'reload schema';
