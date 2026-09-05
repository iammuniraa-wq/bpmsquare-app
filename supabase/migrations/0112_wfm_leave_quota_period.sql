-- 0112: leave quota period (BIM, 2026-09-06 follow-up to 0109).
--
-- BIM's quotas are per MONTH ("1 CompOff a month", "1 paid Sick day a
-- month"), not per year. The quota number stays in wfm_leave_quotas
-- (annual_quota -- the column name is historical); this says what period
-- it covers. A monthly quota also acts as the month's cap, and balances
-- read "left this month". Numbered 0112: 0110 and 0111 are taken by the
-- parked pricing work.

alter table wfm_leave_types
  add column if not exists quota_period text not null default 'year'
    check (quota_period in ('year', 'month'));
