-- 0129: connector sync plumbing -- the Dynamics 365 connector first, but
-- shaped for any system of record (owner request 2026-10-15: "a standard
-- connector for Dynamics ... master data and fence projects and whatever is
-- possible ... multiple login types").
--
--   connector_links      one row per (BPMSquare record <-> external record):
--                        how a re-sync finds the record it created last time
--                        instead of creating a twin, and how a push knows it
--                        already pushed. Keyed by the external system's own
--                        immutable id, never a name (bpmsquarecore §3).
--   connector_sync_runs  one row per sync/push run, with counts and the
--                        error: the history the settings screen shows and
--                        the cursor an incremental pull continues from.
--
-- RLS: select-only for tenant members; every write is the service-role sync
-- code, which filters by tenant_id explicitly (MULTI_TENANT_GUARDRAILS.md).
-- No custom_data: neither is a user-facing object.

create table if not exists connector_links (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  connector_id  text not null,                 -- e.g. "dynamics365"
  entity        text not null,                 -- connector entity key, e.g. "customers"
  object_type   text not null,                 -- BPMSquare table, e.g. "accounts"
  object_id     uuid not null,
  external_id   text not null,                 -- the external system's id
  external_key  text,                          -- its business key, for display (customer number)
  direction     text not null default 'pull' check (direction in ('pull','push')),
  content_hash  text,                          -- of the mapped values last applied; skips no-op updates
  synced_at     timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (tenant_id, connector_id, entity, external_id)
);

create index if not exists connector_links_object on connector_links (tenant_id, object_type, object_id);

alter table connector_links enable row level security;
drop policy if exists "connector_links: tenant read" on connector_links;
create policy "connector_links: tenant read" on connector_links for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists connector_sync_runs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  connector_id  text not null,
  entity        text not null,
  direction     text not null check (direction in ('pull','push')),
  trigger       text not null default 'manual' check (trigger in ('manual','schedule')),
  status        text not null default 'running' check (status in ('running','succeeded','partial','failed')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  -- {read, created, updated, unchanged, skipped, failed}
  counts        jsonb not null default '{}'::jsonb,
  -- the external modified-since watermark this run reached (incremental pulls)
  watermark     text,
  error         text,
  -- first few row-level problems, for the admin to act on
  issues        jsonb not null default '[]'::jsonb,
  started_by    uuid
);

create index if not exists connector_sync_runs_recent on connector_sync_runs (tenant_id, connector_id, entity, started_at desc);

alter table connector_sync_runs enable row level security;
drop policy if exists "connector_sync_runs: tenant read" on connector_sync_runs;
create policy "connector_sync_runs: tenant read" on connector_sync_runs for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
