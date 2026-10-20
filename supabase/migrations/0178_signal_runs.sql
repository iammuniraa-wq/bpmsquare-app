-- 0178: Buying signals shell (docs/signals-architecture.md section 7.4).
-- signal_runs: one row per tenant per recompute. The cron uses the newest
-- finished row to take the least recently scored tenant first (round-robin, the
-- RFQ mailbox poller's shape), and the list page shows "Updated 2 h ago" from it.
--
-- RLS: members SELECT their tenant's rows; NO write policy -- the cron writes
-- with the service-role client, every query tenant-filtered.

create table if not exists signal_runs (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  source           text not null default 'rescore',
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  accounts_scored  int not null default 0,
  stage_changes    int not null default 0,
  alerts           int not null default 0,
  error            text
);

create index if not exists signal_runs_tenant_idx on signal_runs (tenant_id, started_at desc);

alter table signal_runs enable row level security;
drop policy if exists "signal_runs: tenant read" on signal_runs;
create policy "signal_runs: tenant read" on signal_runs for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
-- No write policy on purpose.
