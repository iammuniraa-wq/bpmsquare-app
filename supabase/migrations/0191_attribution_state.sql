-- 0191: where the attribution cron is for each workspace (docs/shells/attribution-shell.md).
-- A per-workspace bookmark (the last domain_event read, keyset on created_at and id), a lock so two
-- overlapping cron calls cannot both work on one workspace, and when it last ran and what it found.
--
-- RLS: enabled with NO policy; only the cron and the "Recompute now" route (service-role client, tenant on
-- every query) read or write it. Members see "last updated" through the results table, not this one.

create table if not exists attribution_state (
  tenant_id         uuid primary key references tenants(id) on delete cascade,
  last_created_at   timestamptz,
  last_event_id     uuid,
  locked_until      timestamptz not null default '1970-01-01T00:00:00Z',
  last_run_at       timestamptz,
  last_error        text,
  touches_total     int not null default 0,
  updated_at        timestamptz not null default now()
);

alter table attribution_state enable row level security;
-- No policy on purpose.
