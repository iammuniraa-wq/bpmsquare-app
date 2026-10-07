-- KAN-29 -- per-employee remote punch flag.
--
-- tenants.config.wfm.employee_self_service is a workspace-wide switch: off
-- means everyone punches at the kiosk. BIM needs the exception -- one named
-- person allowed to punch from their phone -- so the employee row carries an
-- optional override that is consulted before the workspace default.
--
-- Nullable with NO default on purpose: NULL means "follow the workspace
-- setting", and a default would turn every existing row into an explicit
-- decision nobody made.
--
-- No RLS change: `employees` already has tenant-scoped select and admin-only
-- insert/update/delete policies (0062), and a new column inherits them -- so
-- a plain member can read the flag but cannot write it, even straight through
-- PostgREST. The app writes it via the admin-only PATCH route.

alter table employees
  add column if not exists self_service_override boolean;

comment on column employees.self_service_override is
  'KAN-29. NULL = follow tenants.config.wfm.employee_self_service. true/false
   overrides it for this employee. Permanent until an admin changes it.';
