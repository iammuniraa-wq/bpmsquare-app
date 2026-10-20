-- 0165: Journeys, the definitions (docs/marketing-platform-architecture.md 3.1, docs/shells/journeys-shell.md).
-- A journey is a short, linear list of steps that starts from one event. The
-- definition is a closed JSON shape that src/lib/marketing/journeys/definition.ts
-- validates on every write.
--
-- RLS: SELECT-ONLY for members. A definition decides what the runner emails and
-- to whom, so it must not be writable through PostgREST with a member's own
-- session (it would skip the sanitiser and the tenant checks on the foreign ids
-- inside it). Every write goes through /api/journeys with the service-role client,
-- after requireTenantUser(), and every such query chains .eq("tenant_id", ...).
-- This matches `segments` and the WFM convention in MULTI_TENANT_GUARDRAILS.md.
--
-- Pending-migration behaviour: every screen and the runner read 42P01 / 42703 /
-- PGRST205 as "nothing there yet".

create table if not exists journeys (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  ref            text,                                   -- JNY-0001, MASTER_REF_TABLES
  name           text not null,
  status         text not null default 'draft' check (status in ('draft', 'live', 'paused', 'archived')),
  definition     jsonb not null default '{}'::jsonb,
  -- Denormalised so the runner matches an event to journeys without parsing JSON.
  trigger_name   text,
  version        int not null default 1,
  -- Only events at or after this moment enrol people; set when the journey is turned on.
  entry_from     timestamptz,
  went_live_at   timestamptz,
  custom_data    jsonb,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists journeys_tenant_idx on journeys (tenant_id, status, updated_at desc);
create unique index if not exists journeys_tenant_ref_uniq on journeys (tenant_id, ref) where ref is not null;

alter table journeys enable row level security;
drop policy if exists "journeys: tenant read" on journeys;
create policy "journeys: tenant read" on journeys for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
