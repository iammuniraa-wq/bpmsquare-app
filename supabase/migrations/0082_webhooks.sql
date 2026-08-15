-- Outbound webhooks (event push).
--
-- The /api/v1/changes feed already lets a connected system PULL every change
-- via a keyset cursor. Webhooks are the PUSH side of the same primitive: a
-- tenant registers a URL, and a cron dispatcher replays new change_log rows to
-- it, signed with HMAC-SHA256 so the receiver can verify authenticity -- the
-- thing OData/SOAP never offered natively and SAP/Salesforce bury behind
-- middleware.
--
-- A webhook stores its own delivery cursor (last change_log row it received,
-- as created_at|id, exactly the keyset the /changes feed uses). The dispatcher
-- advances the cursor only after a successful POST, so a failed delivery is
-- retried on the next run without gaps or duplicates across the boundary.

create table if not exists webhooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  url text not null,
  secret text not null,                    -- HMAC signing secret; shared config, shown to admins
  object_types jsonb not null default '["*"]'::jsonb,   -- filter: which object_types to deliver; ["*"] = all
  active boolean not null default true,
  cursor_ts timestamptz,                   -- last delivered change_log.created_at
  cursor_id uuid,                          -- ... and its id (keyset tiebreak)
  last_delivery_at timestamptz,
  last_status integer,                     -- HTTP status of the last attempt
  last_error text,
  failure_count integer not null default 0, -- consecutive failures; auto-paused past a threshold
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists webhooks_tenant_idx on webhooks (tenant_id);
create index if not exists webhooks_active_idx on webhooks (active) where active;

alter table webhooks enable row level security;

create policy "webhooks: tenant isolation" on webhooks for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- Append-only delivery log: one row per POST attempt, for observability
-- ("did my endpoint receive this event, and what did it return"). Members read
-- their tenant's log; only the dispatcher (service-role client) writes it.
create table if not exists webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  webhook_id uuid not null references webhooks(id) on delete cascade,
  event_count integer not null default 0,  -- change_log rows in this batch
  status integer,                          -- HTTP status, or null if the request never completed
  ok boolean not null default false,
  error text,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists webhook_deliveries_lookup_idx
  on webhook_deliveries (tenant_id, webhook_id, created_at desc);

alter table webhook_deliveries enable row level security;

-- Read-only for tenant members; no insert/update/delete policy, so writes only
-- ever happen through the service-role dispatcher (same posture as change_log).
create policy "webhook_deliveries: tenant read" on webhook_deliveries for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
