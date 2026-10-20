-- 0166: Journeys, who is in a journey and what happened to them
-- (docs/marketing-platform-architecture.md 3.3, docs/shells/journeys-shell.md).
--
-- journey_runs: one row per person (or per company, see subject_key) per journey.
--   The unique index on (journey_id, subject_key) IS the "enrol at most once"
--   rule: two ticks seeing the same event cannot enrol twice.
-- journey_run_steps: append-only record of every step that finished, was
--   skipped or failed. unique (run_id, step_id, attempt) is what makes a retried
--   tick unable to write a step twice.
--
-- RLS: SELECT-ONLY for members on both. Run data feeds nothing a member should be
-- able to forge (the WFM lesson in MULTI_TENANT_GUARDRAILS.md); only the runner
-- (service-role client, tenant-filtered) writes. Requires 0165.

create table if not exists journey_runs (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  journey_id          uuid not null references journeys(id) on delete cascade,
  journey_version     int not null default 1,
  -- "c:<contact id>" or "a:<account id>" when the journey allows one person per company.
  subject_key         text not null,
  contact_id          uuid,
  account_id          uuid,
  trigger_event_id    uuid,
  trigger_event_name  text,
  -- References and numbers from the event, used for merge tokens and the task text. No PII.
  trigger_payload     jsonb not null default '{}'::jsonb,
  status              text not null default 'active' check (status in ('active', 'done', 'exited', 'stalled')),
  -- Id of the next step to run; null once the run is finished.
  current_step_id     text,
  next_due_at         timestamptz,
  -- Plain words about why a waiting run has not moved ("Waiting for quiet hours to end"),
  -- and the short machine reason behind it (see src/lib/marketing/journeys/reasons.ts).
  last_note           text,
  note_reason         text,
  exit_reason         text,
  entered_at          timestamptz not null default now(),
  finished_at         timestamptz
);

create unique index if not exists journey_runs_once_uniq on journey_runs (tenant_id, journey_id, subject_key);
create index if not exists journey_runs_due_idx on journey_runs (tenant_id, next_due_at) where status = 'active';
create index if not exists journey_runs_journey_idx on journey_runs (tenant_id, journey_id, entered_at desc);

alter table journey_runs enable row level security;
drop policy if exists "journey_runs: tenant read" on journey_runs;
create policy "journey_runs: tenant read" on journey_runs for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists journey_run_steps (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  run_id             uuid not null references journey_runs(id) on delete cascade,
  journey_id         uuid not null references journeys(id) on delete cascade,
  step_id            text not null,
  step_kind          text not null,
  attempt            int not null default 1,
  status             text not null check (status in ('done', 'skipped', 'failed')),
  -- Short machine reason: sent, no_consent, quiet_hours ... see journeys/reasons.ts.
  reason             text,
  detail             text,
  contact_id         uuid,
  -- The recipient row the newsletter send path wrote, so a retry can see the email already went.
  recipient_id       uuid,
  -- True only for a step that really sent a message; the daily cap counts these.
  sent               boolean not null default false,
  at                 timestamptz not null default now(),
  unique (run_id, step_id, attempt)
);

create index if not exists journey_run_steps_run_idx on journey_run_steps (tenant_id, run_id);
create index if not exists journey_run_steps_cap_idx on journey_run_steps (tenant_id, contact_id, at desc) where sent;

alter table journey_run_steps enable row level security;
drop policy if exists "journey_run_steps: tenant read" on journey_run_steps;
create policy "journey_run_steps: tenant read" on journey_run_steps for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
