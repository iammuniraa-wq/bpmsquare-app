-- KAN-13: employee codes must be unique per tenant CASE-INSENSITIVELY.
--
-- 0057 added `unique (tenant_id, employee_code)`, which is case-sensitive, so
-- "EMP001" and "emp001" were accepted as two different codes. Add a
-- case-insensitive unique index (partial, so several NULL codes are still
-- allowed) to reject case-variant duplicates. The create/update routes already
-- map a 23505 unique-violation to "Employee code already exists", so no route
-- change is needed -- a case-variant duplicate now fails cleanly with that
-- message.
--
-- NOTE: if a tenant already has case-variant duplicates (e.g. EMP001 + emp001),
-- this index creation will fail -- resolve/rename those rows first, then re-run.
create unique index if not exists employees_tenant_code_ci_uniq
  on employees (tenant_id, lower(employee_code))
  where employee_code is not null;
