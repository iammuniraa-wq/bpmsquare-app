-- 0201_integration_middleware.sql
--
-- Integration middleware (docs/design/integration-middleware.md, S2 of
-- docs/design/message-monitor.md): one row per message the middleware sends or
-- receives that no other table already records -- a Standard Quote sent to the
-- ERP, a connector run, a v1 API call. The monitor reads this table together
-- with email_log, rfq_messages, whatsapp_messages, webhook_deliveries and
-- connector_sync_runs.
--
-- Access: SELECT for the ADMINS of the workspace only (the monitor is an admin
-- screen and a row can carry a request body when payload capture is on). NO
-- insert / update / delete policy: every write is the service-role code, which
-- names the tenant explicitly, so a member cannot forge a "sent" row through
-- PostgREST with their own session (the 0078 / 0199 lesson).
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

drop policy if exists "integration_messages: admin read" on integration_messages;
create policy "integration_messages: admin read" on integration_messages for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'));

-- Ask PostgREST to reload its schema so the table is visible straight away.
notify pgrst, 'reload schema';
