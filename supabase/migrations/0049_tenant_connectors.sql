-- 0049_tenant_connectors.sql
-- Foundation for the connector framework: one row per tenant per connector
-- they've configured. `credentials` holds whatever the connector's auth_type
-- needs (an encrypted api_key, or an encrypted access/refresh token pair for
-- a future oauth2 connector) -- encrypted at rest via the same encrypt()/
-- decrypt() PII already uses (lib/encryption.ts), never plaintext.
create table if not exists tenant_connectors (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  connector_id  text not null,            -- catalog key, e.g. "custom_webhook" (see lib/connectors/registry.ts)
  status        text not null default 'connected' check (status in ('connected', 'error')),
  credentials   jsonb not null default '{}'::jsonb,  -- encrypted string values only, shape is connector-specific
  config        jsonb not null default '{}'::jsonb,  -- non-secret settings (e.g. target URL)
  last_error    text,
  connected_by  uuid references auth.users(id),
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, connector_id)
);

alter table tenant_connectors enable row level security;

drop policy if exists "tenant_connectors: tenant isolation" on tenant_connectors;
create policy "tenant_connectors: tenant isolation" on tenant_connectors for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
