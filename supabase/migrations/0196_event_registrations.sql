-- 0196: who registered for an event and whether they came (docs/shells/events-shell.md).
-- One row per person per event (unique), written by the form hook, a rep adding a person, and staff checking people
-- in. A row says "this person registered" and "this person was at the door": a trust claim that drives follow-up
-- journeys, the show rate and attribution, so it is SELECT-ONLY for members (the WFM attendance lesson in
-- MULTI_TENANT_GUARDRAILS.md) and every write goes through the app on the service-role client after
-- requireTenantUser(), with the tenant on every query.
--
-- Status moves: registered -> attended | no_show | cancelled, no_show -> attended, cancelled -> registered
-- (src/lib/marketing/events/rules.ts). `follow_up_started_at` stamps the person once the follow-up journey has
-- been started for them, so pressing the button twice enrols nobody twice.

create table if not exists event_registrations (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id) on delete cascade,
  event_id               uuid not null references marketing_events(id) on delete cascade,
  contact_id             uuid not null references contacts(id) on delete cascade,
  account_id             uuid references accounts(id) on delete set null,
  status                 text not null default 'registered' check (status in ('registered', 'attended', 'no_show', 'cancelled')),
  source                 text not null default 'form' check (source in ('form', 'rep', 'import')),
  -- Where it came from: the form submission (0171) when there is one. No foreign key, same reason as 0195.
  form_submission_id     uuid,
  registered_at          timestamptz not null default now(),
  checked_in_at          timestamptz,
  checked_in_by          uuid,
  follow_up_started_at   timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists event_registrations_person_uniq on event_registrations (tenant_id, event_id, contact_id);
create index if not exists event_registrations_event_idx on event_registrations (tenant_id, event_id, status);
create index if not exists event_registrations_contact_idx on event_registrations (tenant_id, contact_id);

alter table event_registrations enable row level security;
drop policy if exists "event_registrations: tenant read" on event_registrations;
create policy "event_registrations: tenant read" on event_registrations for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
-- No insert/update/delete policy on purpose.
