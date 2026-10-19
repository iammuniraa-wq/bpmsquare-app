-- 0137_domain_event.sql
-- Marketing platform phase M0 (docs/marketing-platform-architecture.md 1.2):
-- the shared event stream. Also Piece A of docs/nova-crew-architecture.md and
-- section 5.1 of docs/sales-engine-architecture.md -- one table for all three,
-- written only through emitEvent() (src/lib/events/emit.ts).
--
-- Additive: one new table, nothing existing touched, nothing reads it yet
-- except scoring/journeys in later phases. The app emits into it from the
-- routes that exist today and swallows a missing table, so running this late
-- loses only the events that happened before it.
--
-- RLS: tenant members may SELECT; there is NO insert/update/delete policy at
-- all, so a member cannot forge an event through PostgREST with their own
-- session (the WFM lesson in MULTI_TENANT_GUARDRAILS.md: a stream that drives
-- scores and automations is something a member must not be able to write).
-- The app writes through the service-role client.

create table domain_event (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id) on delete cascade,
  -- "<object>.<verb>"; the catalogue lives in src/lib/events/catalog.ts.
  name                   text not null,
  object_type            text not null,
  object_id              uuid,
  actor_id               uuid,
  source                 text not null default 'app'
    check (source in ('app', 'public_link', 'tracker', 'provider_webhook', 'runner', 'api')),
  -- Who it is about. Deliberately no foreign keys: an event outlives the
  -- record it describes (attribution needs the history of a deleted lead).
  contact_id             uuid,
  account_id             uuid,
  lead_id                uuid,
  visitor_id             uuid,
  -- Common fields shared by every email event (Newsletter Studio 12.1).
  campaign_id            uuid,
  newsletter_id          uuid,
  newsletter_version_id  uuid,
  lang                   text,
  topic                  text,
  -- A recipient who is not a contact carries only the blind-index hash.
  email_hash             text,
  payload                jsonb not null default '{}'::jsonb,
  -- Loop guard: an action run by a rule or journey emits with depth + 1.
  depth                  int not null default 0,
  -- When it happened (a provider webhook arrives late) vs created_at = recorded.
  occurred_at            timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  processed_at           timestamptz,
  -- Natural key: a retry of the same request must not emit twice. See
  -- eventDedupeKey() in src/lib/events/emit.ts.
  dedupe_key             text not null,
  unique (tenant_id, dedupe_key)
);

-- Dispatcher cursor (keyset on created_at, id) and the unprocessed backlog.
create index domain_event_cursor_idx on domain_event (tenant_id, created_at, id);
create index domain_event_unprocessed_idx on domain_event (tenant_id, created_at) where processed_at is null;
-- Scoring reads one person's / one company's recent window.
create index domain_event_contact_idx on domain_event (tenant_id, contact_id, created_at desc) where contact_id is not null;
create index domain_event_account_idx on domain_event (tenant_id, account_id, created_at desc) where account_id is not null;
create index domain_event_object_idx on domain_event (tenant_id, object_type, object_id, created_at desc);

alter table domain_event enable row level security;
create policy "domain_event: tenant read" on domain_event for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
-- No write policy on purpose.
