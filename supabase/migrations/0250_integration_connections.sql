-- Connections you add yourself, and their endpoints (Integration middleware, owner request 2026-11-22: "keep only the endpoints
-- empty for us to add it there; as simple as possible for a connector, with ALL connection types, and easy to connect").
--
-- ADDITIVE: tenant_connectors (Dynamics 365, SAP S/4HANA, ePROMIS, Slack, Gmail, mail server, iCal) is not touched and keeps
-- behaving exactly as before. tenant_connectors is one row per connector id; a client can own several REST or OData systems, so
-- these live in their own tables.
--
--   integration_connections  one row per connection: a name, a type (rest | odata), the non-secret settings in `config`, the
--                            secrets SEALED in `secrets` (sealSecret: client secret, API key, password, token), the sealed
--                            OAuth access token kept until it expires, and the result of the last Test.
--   integration_endpoints    what a connection exposes to BPMSquare: starts EMPTY. A name, the operation (a method and path for REST,
--                            an entity set for OData), a direction, the BPMSquare object it serves, how it runs. Our team adds them
--                            per client; mapping stays in integration_mappings (connection id "conn:<uuid>") and the Monitor shows
--                            what runs.
--
-- RLS stance (MULTI_TENANT_GUARDRAILS, the 0078 and 0199 lessons): integration_connections holds credentials and integration_endpoints
-- steers which address the server calls with them, so a member who could write either through PostgREST could repoint a stored secret
-- at their own host. Both tables: RLS ENABLED and NO POLICY AT ALL (service role only). Every read and write is an admin route on
-- createAdminSupabase() with `.eq("tenant_id", tenantId)`. No column is added to `tenants`.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the Connections table on the Integration middleware page
-- lists the existing connectors only and "Add connection" says an update is needed (42P01 / PGRST205 are read as "not there yet").

create table if not exists integration_connections (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  name               text not null check (char_length(name) between 1 and 80),
  family             text not null check (family in ('rest', 'odata')),
  config             jsonb not null default '{}'::jsonb,
  secrets            jsonb not null default '{}'::jsonb,
  token_cache        text,
  last_test_status   text check (last_test_status in ('ok', 'failed')),
  last_test_at       timestamptz,
  last_test_message  text,
  created_by         uuid,
  updated_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists integration_connections_name_idx on integration_connections (tenant_id, lower(name));
create index if not exists integration_connections_tenant_idx on integration_connections (tenant_id, created_at);

alter table integration_connections enable row level security;   -- deliberately no policy: service role only

create table if not exists integration_endpoints (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  connection_id      uuid not null references integration_connections(id) on delete cascade,
  name               text not null check (char_length(name) between 1 and 80),
  -- REST: method + path. OData: entity set (method GET for a read, POST to create, PATCH to update).
  method             text not null default 'GET' check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  path               text not null check (char_length(path) between 1 and 300),
  direction          text not null check (direction in ('in', 'out')),
  -- The BPMSquare object it serves: the documents the mapping engine already knows.
  object_type        text not null check (object_type in ('quote', 'customers', 'contacts', 'products', 'projects')),
  run_mode           text not null default 'manual' check (run_mode in ('manual', 'schedule', 'on_change')),
  schedule           text check (schedule in ('hourly', 'daily')),
  enabled            boolean not null default false,
  origin             text not null default 'hand' check (origin in ('hand', 'metadata', 'openapi', 'template')),
  template_key       text,
  last_run_at        timestamptz,
  last_run_status    text check (last_run_status in ('ok', 'failed')),
  last_run_message   text,
  created_by         uuid,
  updated_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists integration_endpoints_name_idx on integration_endpoints (tenant_id, connection_id, lower(name));
create index if not exists integration_endpoints_connection_idx on integration_endpoints (tenant_id, connection_id);

alter table integration_endpoints enable row level security;   -- deliberately no policy: service role only
