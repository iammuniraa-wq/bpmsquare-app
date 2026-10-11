-- KAN-29, part 2 -- WHICH kind of remote working an employee is allowed.
--
-- 0126 gave each employee a yes/no override for punching from their phone. BIM
-- (2026-10-11) needs to say why: a supervisor allows an employee to work from
-- home, on a site visit, or both -- and the phone then offers exactly those
-- punches, so every remote day is labelled rather than being an anonymous
-- check-in from somewhere.
--
-- Nullable with NO default, like 0126: NULL means "no remote mode set". It is
-- only meaningful together with self_service_override = true; the PATCH route
-- clears it whenever the override is anything else, so the pair cannot drift.
-- An employee already allowed from their phone under 0126 (override = true,
-- remote_mode NULL) keeps exactly the behaviour they have now: any punch.
--
-- A text column with a check rather than a Postgres enum, so adding a mode
-- later is a one-line constraint change instead of an ALTER TYPE.
--
-- No RLS change: a new column on `employees` inherits its policies (0062) --
-- tenant-scoped select, admin-only writes -- and the app writes it through the
-- supervisor PATCH route using the service role.

alter table employees
  add column if not exists remote_mode text
  check (remote_mode in ('wfh', 'site', 'both'));

comment on column employees.remote_mode is
  'KAN-29 part 2. Which remote punches this employee may use from their phone:
   wfh = Work from home, site = Site visit, both. NULL with
   self_service_override = true means any punch (the 0126 behaviour). Only
   meaningful when self_service_override is true.';
