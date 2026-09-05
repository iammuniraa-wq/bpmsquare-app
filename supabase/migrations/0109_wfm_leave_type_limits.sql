-- 0109: leave type limits (BIM request, 2026-09-06).
--
-- Two per-type rules the client's policy needs and 0062's leave types could
-- not express:
--   monthly_limit        -- at most this many days of the type per calendar
--                           month (e.g. CompOff: 1). Enforced when a request
--                           or an admin-entered record is created; counts
--                           approved records plus pending requests.
--   paid_days_per_month  -- the first N days of the type in a month are paid;
--                           any beyond count as UNPAID in the monthly summary
--                           and the payroll export (e.g. Sick: 1). Null = the
--                           type's category applies to every day, as today.
--
-- Deleting a type stays a route-level rule (only when nothing refers to it);
-- wfm_leave_records/requests keep their FK without cascade, so a type in use
-- cannot be deleted by accident at the database level either.

alter table wfm_leave_types
  add column if not exists monthly_limit numeric check (monthly_limit is null or monthly_limit > 0),
  add column if not exists paid_days_per_month numeric check (paid_days_per_month is null or paid_days_per_month >= 0);
