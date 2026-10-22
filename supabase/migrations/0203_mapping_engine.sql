-- 0203_mapping_engine.sql
--
-- Mapping engine (docs/design/mapping-engine.md): any BPMSquare object to any target, with value mapping.
--
--   integration_mappings    one MappingDocument per (connection, document): the fields of the target as fetched
--                           (a Dataverse quote has 100+ attributes), the rows that map them, a version number.
--                           status: active = what the engine runs; previous = the last 10 versions, kept;
--                           draft = a fetched field list not yet saved as a mapping (one per connection and document).
--   integration_value_lists one list per kind of value (Unit, Currency, Country, ...) per connection: a two-column
--                           table BPMSquare value | ERP code, used outbound and (reversed) inbound.
--
-- Access: BOTH tables are SERVICE ROLE ONLY -- RLS enabled and NO policy, deliberately (the 0199 lesson: a mapping
-- steers what the server sends to a third party, and a member must never write it with their own session). No secret is
-- ever stored here (credentials stay sealed on the connector or the webhook). src/lib/rlsPolicies.test.ts fails the
-- build if a policy for either table ever appears. Nothing is added to `tenants`, so the column-grant rule of 0200
-- does not apply.
--
-- Call webhooks can take their body from a mapping: payload_mode gains 'mapping', and the webhook gains `mapping_id` and
-- `response_key_path` (the readable id in the response). That block runs only when the webhooks table exists (0082) and
-- its payload_mode column exists (0202); if 0202 lands later, run this file again -- every statement is idempotent.
--
-- Additive and idempotent. Until it is applied the Mapping tab answers "database update needed" and dispatch, pull and the
-- webhook sender behave exactly as before (a missing table reads as "no mapping document").

create table if not exists integration_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  connection_id text not null,
  document text not null,
  direction text not null check (direction in ('out', 'in')),
  version integer not null default 1,
  status text not null default 'active' check (status in ('active', 'previous', 'draft')),
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create unique index if not exists integration_mappings_active_idx
  on integration_mappings (tenant_id, connection_id, document) where status = 'active';
create unique index if not exists integration_mappings_draft_idx
  on integration_mappings (tenant_id, connection_id, document) where status = 'draft';
create index if not exists integration_mappings_tenant_idx
  on integration_mappings (tenant_id, connection_id, document, version desc);

alter table integration_mappings enable row level security;   -- deliberately no policy

create table if not exists integration_value_lists (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  connection_id text not null,
  kind text not null,
  label text not null,
  rows jsonb not null default '[]'::jsonb,
  default_in text,
  unknown_in jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (tenant_id, connection_id, kind)
);

alter table integration_value_lists enable row level security;   -- deliberately no policy

-- Call webhooks can take their body from a mapping (guarded: only when 0202 has run).
do $$ begin
  if to_regclass('public.webhooks') is null then
    return;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'webhooks' and column_name = 'payload_mode') then
    execute 'alter table webhooks drop constraint if exists webhooks_payload_mode_check';
    execute $s$ alter table webhooks add constraint webhooks_payload_mode_check check (payload_mode in ('standard', 'template', 'mapping')) $s$;
    execute 'alter table webhooks add column if not exists mapping_id uuid references integration_mappings(id) on delete set null';
    execute 'alter table webhooks add column if not exists response_key_path text';
  end if;
end $$;

-- Ask PostgREST to reload its schema so the new tables and columns are visible straight away.
notify pgrst, 'reload schema';
