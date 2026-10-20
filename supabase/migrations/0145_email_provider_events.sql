-- 0145: which provider webhook deliveries have been processed
-- (docs/newsletter-studio-architecture.md section 12.5).
--
-- Resend retries a webhook until it gets a 2xx, and can deliver one event twice.
-- Most of what the handler does is naturally idempotent, but a complaint also
-- appends to the consent ledger, so each delivery is recorded here by the
-- provider's own event id (the Svix id) and a repeat is acknowledged and ignored.
--
-- RLS: members may SELECT their tenant's rows; there is NO insert/update/delete
-- policy, so nobody can forge or erase a processed-event record through
-- PostgREST. Written only by the webhook route, on the service-role client, with
-- the tenant taken from the stored recipient row (never from the payload).

create table if not exists email_provider_events (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  provider           text not null default 'resend',
  provider_event_id  text not null,
  event_type         text not null,
  recipient_id       uuid,
  created_at         timestamptz not null default now(),
  unique (tenant_id, provider, provider_event_id)
);

create index if not exists email_provider_events_recipient_idx on email_provider_events (tenant_id, recipient_id);

alter table email_provider_events enable row level security;
drop policy if exists "email_provider_events: tenant read" on email_provider_events;
create policy "email_provider_events: tenant read" on email_provider_events for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
