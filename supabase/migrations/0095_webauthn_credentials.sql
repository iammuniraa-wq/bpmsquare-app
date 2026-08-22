-- 0095: passkey (WebAuthn) credentials for portal sign-in.
--
-- A passkey lets an employee sign in with their phone's own biometric
-- (Face ID / fingerprint) -- the phone stores the private key and unlocks it
-- locally; we hold only the PUBLIC key, so no biometric data ever reaches
-- the server. One row per registered device credential.
--
-- RLS: own-rows SELECT only (a member may see their own registered devices).
-- No insert/update/delete policy -- every write goes through the service-role
-- client in the passkey API routes (same convention as the WFM tables).
-- The login-verify route must find a credential BEFORE a session exists, so
-- it uses the admin client with an explicit tenant filter.

create table if not exists webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null,
  -- base64url credential id as the authenticator reports it; globally unique
  -- by construction, and unique-indexed so a replayed registration upserts
  -- cleanly instead of duplicating.
  credential_id text not null unique,
  public_key text not null,          -- base64 COSE public key
  counter bigint not null default 0, -- signature counter (clone detection)
  transports text[],                 -- e.g. {internal,hybrid}
  device_label text,                 -- "iPhone", "Android" -- shown to the user
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists webauthn_credentials_tenant_user_idx
  on webauthn_credentials (tenant_id, user_id);

alter table webauthn_credentials enable row level security;

create policy "webauthn_credentials: own rows" on webauthn_credentials for select
  using (user_id = auth.uid());
