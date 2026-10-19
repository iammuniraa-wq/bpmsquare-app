-- 0139_consent_ledger.sql
-- Marketing platform phase M0 (docs/marketing-platform-architecture.md 1.3):
-- consent is a LEDGER, not a flag.
--
--   consent_events  append-only: every grant and withdrawal, with the basis,
--                   the jurisdiction, where it came from and the evidence
--   consent_state   the current answer per (contact, channel, topic), kept by
--                   the writer (recordConsent) so canContact() is one lookup
--   suppressions    addresses that must not be mailed whatever the ledger
--                   says (hard bounce, complaint, invalid, manual)
--
-- Additive: three new tables, nothing existing touched. accounts.marketing_opt_out
-- (0040) stays exactly as it is and canContact() keeps reading it, so today's
-- unsubscribe link and the campaign send route are unaffected.
--
-- RLS: members may SELECT their tenant's rows; there is NO insert/update/delete
-- policy. These tables record what a person agreed to; a member who could write
-- them through PostgREST could forge an opt-in (the WFM lesson in
-- MULTI_TENANT_GUARDRAILS.md). All writes go through server code on the
-- service-role client (src/lib/marketing/consentWrite.ts).

create table consent_events (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  -- The person. A company-level row (legacy account opt-out) carries only
  -- account_id; an anonymous web visitor carries only visitor_id (M4).
  contact_id    uuid references contacts(id) on delete set null,
  account_id    uuid references accounts(id) on delete set null,
  visitor_id    uuid,
  channel       text not null check (channel in ('email', 'whatsapp', 'sms', 'phone', 'web_tracking')),
  -- null = every topic; otherwise a key from config.marketing.topics.
  topic         text,
  status        text not null check (status in ('granted', 'withdrawn')),
  basis         text not null check (basis in ('consent', 'existing_customer', 'contract', 'legitimate_interest')),
  jurisdiction  text not null default 'other' check (jurisdiction in ('SA', 'AE', 'QA', 'KW', 'OM', 'BH', 'IN', 'EU', 'other')),
  source        text not null check (source in ('form', 'preference_centre', 'unsubscribe_link', 'import', 'rep', 'api', 'provider_webhook')),
  -- The exact consent text shown, form id, ip_hash, user agent family,
  -- double-opt-in token, rep user id -- whatever proves how it was given.
  evidence      jsonb not null default '{}'::jsonb,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  check (contact_id is not null or account_id is not null or visitor_id is not null)
);

create index consent_events_contact_idx on consent_events (tenant_id, contact_id, created_at desc) where contact_id is not null;
create index consent_events_account_idx on consent_events (tenant_id, account_id, created_at desc) where account_id is not null;

alter table consent_events enable row level security;
create policy "consent_events: tenant read" on consent_events for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table consent_state (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  contact_id    uuid not null references contacts(id) on delete cascade,
  channel       text not null check (channel in ('email', 'whatsapp', 'sms', 'phone', 'web_tracking')),
  -- '' = every topic (not null so the unique key below works).
  topic         text not null default '',
  status        text not null check (status in ('granted', 'withdrawn')),
  basis         text not null check (basis in ('consent', 'existing_customer', 'contract', 'legitimate_interest')),
  jurisdiction  text not null default 'other' check (jurisdiction in ('SA', 'AE', 'QA', 'KW', 'OM', 'BH', 'IN', 'EU', 'other')),
  since         timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, contact_id, channel, topic)
);

alter table consent_state enable row level security;
create policy "consent_state: tenant read" on consent_state for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table suppressions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  channel       text not null check (channel in ('email', 'whatsapp', 'sms', 'phone')),
  -- Blind-index hash of the address (contacts.email_hash), never the address.
  address_hash  text not null,
  reason        text not null check (reason in ('bounced_hard', 'complained', 'invalid', 'manual')),
  created_at    timestamptz not null default now(),
  unique (tenant_id, channel, address_hash)
);

alter table suppressions enable row level security;
create policy "suppressions: tenant read" on suppressions for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
