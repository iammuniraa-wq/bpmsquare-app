-- Control plane shell (docs/dedicated-instance.md, sections 7.1 and 10): the registry of instances (separate database + app
-- deployment) that the platform admin console at /admin/instances lists, plus the single-use ledger of signed handoffs.
--
-- Deliberately NO tenant_id on any of these three tables: they describe the platform, not a workspace. Because no tenant
-- member may ever read or write them, RLS is enabled with NO policy at all (service role only; the 0199 / 0078 lessons: a member
-- who could write platform_instances.base_url through PostgREST would steer where the server sends a signed request, and one who
-- could delete a platform_handoffs row would replay a handoff). Every read and write is a route behind isPlatformAdmin() or a
-- verified signature, on createAdminSupabase().
--
-- Run on EVERY instance database: the registry stays empty on all but the control plane, while platform_handoffs is what makes a
-- signed handoff single-use on the instance that receives it. Idempotent; safe to run twice. Hand-applied by the owner: until it
-- runs, /admin/instances shows a plain notice and the instance endpoints refuse a handoff (503) rather than skip the ledger.

create table if not exists platform_instances (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  name            text not null,
  base_url        text not null check (base_url like 'https://%'),
  region          text,
  db_host         text,
  branch          text,
  status          text not null default 'planned' check (status in ('planned', 'active', 'retired')),
  notes           text,
  last_seen_at    timestamptz,
  last_summary    jsonb,
  created_at      timestamptz not null default now()
);

create table if not exists platform_instance_events (
  id              uuid primary key default gen_random_uuid(),
  instance_id     uuid not null references platform_instances(id) on delete cascade,
  kind            text not null,
  actor_email     text,
  detail          jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists platform_instance_events_instance_idx
  on platform_instance_events (instance_id, created_at desc);

-- jti is the primary key, so the unique violation (23505) on insert IS the replay check; the row doubles as the audit record
-- on the instance that accepted the handoff (who, for which instance, when).
create table if not exists platform_handoffs (
  jti             text primary key,
  instance_slug   text not null,
  subject         text not null,
  used_at         timestamptz not null default now()
);

alter table platform_instances       enable row level security;
alter table platform_instance_events enable row level security;
alter table platform_handoffs        enable row level security;

revoke all on platform_instances, platform_instance_events, platform_handoffs from anon, authenticated;
