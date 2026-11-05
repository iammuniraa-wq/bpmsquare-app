-- AI automation, slice S2 (docs/design/nova-crew-agents.md, sections 3.3 and 3.10): the per-workspace bookmark through which the
-- plan cron consumes domain_event (0137), the same shape as journey_cursors (0167). The lease stops two overlapping cron ticks
-- from both advancing the cursor for one workspace.
--
-- RLS enabled, NO policy: only the service-role cron touches it. Idempotent; safe to run twice. Hand-applied by the owner: until
-- it runs the plan cron simply does not wake agents from events (the daily pass is unaffected).

create table if not exists crew_cursors (
  tenant_id       uuid primary key references tenants(id) on delete cascade,
  last_created_at timestamptz,
  last_event_id   uuid,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);

alter table crew_cursors enable row level security;
-- No policy on purpose (deny by default; service role only).
