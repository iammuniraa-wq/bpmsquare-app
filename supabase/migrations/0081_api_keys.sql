-- Scoped API keys.
--
-- Until now every tenant had exactly one v1 credential: the plaintext
-- tenants.api_key, which grants full read+write on every object. That single
-- all-or-nothing key is fine for "connect my own integration" but wrong for
-- "give this partner read-only access to quotations" -- the exact thing an
-- OData/SOAP shop expects and neither SAP C4C nor Salesforce makes pleasant.
--
-- This table adds real scoped keys alongside the legacy one (which keeps
-- working -- see resolveApiAuth in src/app/api/v1/_auth.ts). A key is stored
-- only as a SHA-256 hash; the plaintext is shown once at creation and never
-- again, same posture as GitHub/Stripe keys. `scopes` gates read vs write and
-- which objects the key may touch.
--
-- scopes shape (validated app-side, kept flexible here):
--   { "read": true, "write": false, "objects": ["quotations","accounts"] }
--   objects: ["*"] means every object.

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  token_prefix text not null,              -- first chars, shown in the UI to identify a key
  token_hash text not null unique,         -- sha256 hex of the full token; the token itself is never stored
  scopes jsonb not null default '{"read":true,"write":true,"objects":["*"]}'::jsonb,
  last_used_at timestamptz,
  expires_at timestamptz,                  -- null = never expires
  revoked_at timestamptz,                  -- null = active
  created_by uuid,                         -- tenant_users.user_id who minted it
  created_at timestamptz not null default now()
);

create index if not exists api_keys_tenant_idx on api_keys (tenant_id);
-- The hot lookup path: hash of the presented token among live keys.
create index if not exists api_keys_active_hash_idx
  on api_keys (token_hash) where revoked_at is null;

alter table api_keys enable row level security;

-- Tenant isolation for the management UI (session client). The v1 auth path
-- resolves keys via the service-role client (bypasses RLS) and always filters
-- by tenant_id itself, exactly like every other admin-client query.
create policy "api_keys: tenant isolation" on api_keys for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
