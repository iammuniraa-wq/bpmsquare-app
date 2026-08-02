-- 0057_employees_business_users.sql
-- SAP-style user administration, per design-partner feedback that assigning
-- Business Roles via Settings -> Team was too scattered. The flow becomes:
--
--   Employee (master data: created in CRM, imported via Data Workbench, or
--   one day replicated from an HR system)
--     -> Business User (a login bound to that employee: initial password,
--        validity window, admin lock, "counted user" for future seat-based
--        licensing)
--       -> Business Roles (already built, 0052)
--
-- employees is pure master data -- an employee with no business user has no
-- login and consumes nothing. tenant_users (the existing membership/login
-- table) gains the business-user columns rather than a new table, since a
-- business user IS a tenant membership -- inventing a parallel table would
-- just re-create tenant_users with extra steps.

create table employees (
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

create index employees_tenant_idx on employees (tenant_id, last_name, first_name);

alter table employees enable row level security;

create policy "employees: tenant isolation" on employees for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- Business-user columns on the existing membership row. Semantics:
--   employee_id  -- which employee this login belongs to (null = a membership
--                   predating this feature, or one deliberately not tied to an
--                   employee record; nothing breaks either way).
--   display_name -- editable first/last-style label shown in admin screens;
--                   auth email stays the immutable login identifier.
--   is_locked    -- admin-set hard stop, enforced in middleware on every
--                   request: a locked user is cut off immediately even with a
--                   correct password. (Passwords themselves stay entirely in
--                   Supabase Auth -- BPMSquare never stores one.)
--   valid_from / valid_to -- validity window, same middleware enforcement;
--                   null bounds mean open-ended on that side.
--   counted      -- future seat-based licensing marker; stored and shown, not
--                   enforced anywhere yet (same status as tenants.plan).
alter table tenant_users
  add column employee_id  uuid references employees(id) on delete set null,
  add column display_name text,
  add column is_locked    boolean not null default false,
  add column valid_from   date,
  add column valid_to     date,
  add column counted      boolean not null default true;
