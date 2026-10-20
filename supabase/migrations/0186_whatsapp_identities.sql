-- 0186: the workspace's WhatsApp identity (docs/shells/whatsapp-shell.md).
-- One row per workspace: which provider adapter sends for it, the business number shown to
-- customers, and the credentials that adapter needs.
--
-- Secrets: `display_number` and every value inside `credentials` are encrypted with
-- src/lib/encryption.ts (AES-256-GCM) before they are written, the same way
-- tenant_connectors (0049) holds connector credentials. Nothing secret is in tenants.config.
-- `webhook_key` is the random, public part of the inbound URL; it names this row and is NOT
-- a credential on its own: the request must also carry a signature made with the secret in
-- `credentials.webhook_secret`. The tenant for an inbound call is read from THIS row, never from
-- the request body.
--
-- RLS: enabled with NO policy at all. Even encrypted, credentials are not something a member should
-- be able to pull through PostgREST with their own session; the app reads and writes this table
-- only through the service-role client after requireTenantUser() and an admin check, with the tenant
-- on every query. (A deliberate departure from the "tenant isolation" template: that template would
-- let any member read the ciphertext.)

create table if not exists whatsapp_identities (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  provider        text not null default 'sandbox',
  display_number  text,                                   -- encrypted
  credentials     jsonb not null default '{}'::jsonb,     -- encrypted values
  webhook_key     text not null,
  status          text not null default 'active' check (status in ('active', 'disabled')),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists whatsapp_identities_tenant_uniq on whatsapp_identities (tenant_id);
create unique index if not exists whatsapp_identities_key_uniq on whatsapp_identities (webhook_key);

alter table whatsapp_identities enable row level security;
-- No policy on purpose: only the service-role client reads or writes this table.
