-- run-bundle-10-middleware-2026-10-21.sql
-- Integration middleware. Paste into the Supabase SQL editor of each database (dev, then production).
-- = migration 0201, then the demo switch (which only touches is_demo workspaces).
-- Safe to run twice. Needs nothing before it; the ERP connection itself needs
-- run-bundle-9-connectors-2026-10-21.sql (the connector tables) to have been run.
-- Run bundle 9 FIRST: the one-send-per-quote index on connector_links is only created
-- when that table exists, so if bundle 9 comes later, run this bundle again after it.

-- 0201_integration_middleware.sql
--
-- Integration middleware (docs/design/integration-middleware.md, S2 of
-- docs/design/message-monitor.md): one row per message the middleware sends or
-- receives that no other table already records -- a Standard Quote sent to the
-- ERP, a connector run, a v1 API call. The monitor reads this table together
-- with email_log, rfq_messages, whatsapp_messages, webhook_deliveries and
-- connector_sync_runs.
--
-- Access: service role ONLY -- RLS is enabled and there is deliberately NO
-- policy, not even a read one. The app reads the table only through
-- createAdminSupabase() with an explicit tenant_id filter, and reading a row's
-- detail is itself written to the change log by the route; a PostgREST read with
-- an admin's own session token would skip that record, and a row can carry a
-- request body when payload capture is on. Nobody can forge a "sent" row either
-- (the 0078 / 0199 lesson). src/lib/rlsPolicies.test.ts fails the build if a
-- policy is ever added.
--
-- The same migration adds the "claim" index on connector_links that makes
-- sending one quote to the ERP twice impossible (see the end of this file).
--
-- Additive and idempotent. Until it is applied the app shows "database update
-- needed" on the middleware page and sends nothing; it never errors.

create table if not exists integration_messages (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  direction       text not null check (direction in ('in', 'out')),
  channel         text not null check (channel in ('email', 'whatsapp', 'webhook', 'connector', 'api')),
  connector_id    text,                       -- e.g. 'dynamics365'
  entity          text,                       -- 'quote' | 'project' | a connector entity | the v1 object
  object_type     text,                       -- BPMSquare table of the related record
  object_id       uuid,
  ref_label       text,                       -- its readable ref (SQ-0012), never a GUID
  status          text not null check (status in ('ok', 'failed', 'pending', 'skipped', 'redirected')),
  http_status     integer,
  error           text,                       -- the ERP's own message, for the "Details" toggle
  duration_ms     integer,
  correlation_id  text,                       -- ties a connector run to its rows
  summary         jsonb not null default '{}'::jsonb,   -- plain facts: outcome, headline, fix, erp number, counts
  payload         jsonb,                      -- redacted body; only when payload capture is on; pruned at 30 days
  created_at      timestamptz not null default now()
);

create index if not exists integration_messages_tenant_time_idx
  on integration_messages (tenant_id, created_at desc);
create index if not exists integration_messages_tenant_status_time_idx
  on integration_messages (tenant_id, status, created_at desc);
-- "what happened to this quote": the Resync tab and the idempotent retry look rows up by record.
create index if not exists integration_messages_object_idx
  on integration_messages (tenant_id, object_type, object_id);

alter table integration_messages enable row level security;

-- Service role only: no policy. (The drop covers a database that ran an earlier draft of this file.)
drop policy if exists "integration_messages: admin read" on integration_messages;

-- One send per quote. The dispatcher inserts the quote's connector_links row with
-- external_id 'pending:<uuid>' BEFORE it calls the ERP; this index lets only one
-- such insert win, so two overlapping sends (the automatic one plus Send now, or
-- two Retry presses) cannot both create a quote or project in the customer's ERP.
-- Scoped to the middleware's own entity: the fence push writes entity
-- 'fence_projects' and the customer sync writes direction 'pull', so neither can
-- clash. Skipped if the connector tables have not been created on this database.
do $$ begin
  if to_regclass('public.connector_links') is null then
    return;
  end if;
  execute 'create unique index if not exists connector_links_quote_claim_idx
    on connector_links (tenant_id, connector_id, entity, object_id)
    where direction = ''push'' and entity = ''standard_quotes''';
end $$;

-- Ask PostgREST to reload its schema so the table is visible straight away.
notify pgrst, 'reload schema';

-- ---- seed: scripts/seed-middleware-demo.sql ----
-- Integration middleware: demo switch for the is_demo workspace(s).
-- Run AFTER supabase/migrations/0201_integration_middleware.sql.
-- Idempotent. Touches ONLY tenants where is_demo = true; never a client.
--
-- It switches the integration_middleware flag on and nothing else: the rules
-- start at their defaults (automatic on awarded, rejected closes the ERP quote;
-- fence selection = summary + quantity lines; estimate selection = summary +
-- quote lines, bom and wbs for Project targets, internal costs OFF). Nothing is
-- sent anywhere until an ERP connection is saved and a quote is awarded.

update tenants
   set features = coalesce(features, '{}'::jsonb) || '{"integration_middleware": true}'::jsonb
 where is_demo = true
   and coalesce((features ->> 'integration_middleware')::boolean, false) = false;
