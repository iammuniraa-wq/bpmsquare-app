-- 0168: Journeys, tasks for the owner (the "Create a task" step).
-- The product has no task object yet, so the shell keeps the smallest possible
-- one: a titled to-do for a person, tied to an account and the journey run that
-- made it. A member can mark a task done through /api/journeys/tasks/[id];
-- nothing else is writable.
--
-- RLS: SELECT-ONLY for members; the runner creates rows and the route completes
-- them, both with the service-role client and a tenant filter. Requires 0165, 0166.

create table if not exists journey_tasks (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  journey_id     uuid not null references journeys(id) on delete cascade,
  run_id         uuid references journey_runs(id) on delete set null,
  step_id        text,
  account_id     uuid,
  contact_id     uuid,
  -- The owner at the time: the winning Coverage team's lead, else the account owner. Null when nobody owns it.
  owner_user_id  uuid,
  title          text not null,
  due_on         date,
  status         text not null default 'open' check (status in ('open', 'done')),
  created_at     timestamptz not null default now(),
  done_at        timestamptz,
  unique (run_id, step_id)
);

create index if not exists journey_tasks_owner_idx on journey_tasks (tenant_id, owner_user_id, status, due_on);

alter table journey_tasks enable row level security;
drop policy if exists "journey_tasks: tenant read" on journey_tasks;
create policy "journey_tasks: tenant read" on journey_tasks for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
