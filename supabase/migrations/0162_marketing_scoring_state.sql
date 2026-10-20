-- 0162_marketing_scoring_state.sql
-- Marketing platform M2 shell: the scoring runner's bookmark, one row per
-- tenant (docs/marketing-platform-architecture.md 10, "journey_cursors" in the
-- same family). It remembers how far into domain_event the runner has read, so
-- a run re-scores only the leads whose people did something since, and when the
-- tenant was last visited, so the runner rotates fairly across tenants.
--
-- Written only by the cron (service role). RLS is enabled with NO policy at all:
-- a workspace member cannot read or write it through PostgREST, which is the
-- point -- it is runner state, not content.

create table if not exists marketing_scoring_state (
  tenant_id            uuid primary key references tenants(id) on delete cascade,
  event_cursor_at      timestamptz,
  last_run_at          timestamptz,
  last_decay_at        timestamptz,
  leads_scored         integer not null default 0,
  last_error           text,
  updated_at           timestamptz not null default now()
);

alter table marketing_scoring_state enable row level security;
-- No policy on purpose: service role only.
