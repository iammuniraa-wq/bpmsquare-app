-- 0167: Journeys, the runner's own bookkeeping (docs/marketing-platform-architecture.md 3.3).
--
-- journey_cursors: per tenant, the last domain_event the runner has read, as a keyset
--   on (created_at, id), so each tick reads only new events.
-- journey_runner_lock: one row per tenant; the runner takes it with a conditional
--   update so two overlapping cron invocations cannot both work on the same tenant.
--
-- RLS: enabled with NO policy at all. Members have no business reading or writing
-- either table; the runner uses the service-role client (tenant-filtered). Requires 0137.

create table if not exists journey_cursors (
  tenant_id        uuid primary key references tenants(id) on delete cascade,
  last_created_at  timestamptz,
  last_event_id    uuid,
  updated_at       timestamptz not null default now()
);

alter table journey_cursors enable row level security;

create table if not exists journey_runner_lock (
  tenant_id     uuid primary key references tenants(id) on delete cascade,
  locked_until  timestamptz not null default 'epoch',
  last_run_at   timestamptz,
  last_error    text
);

alter table journey_runner_lock enable row level security;
