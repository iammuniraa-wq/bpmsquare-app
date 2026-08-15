-- PricingEngine usage metering (spec §15.4): one row per POST /api/v1/price
-- call. Simultaneously the billing meter (call/line-based plans) and the
-- basis for per-key rate limiting. Written best-effort by the service-role
-- adapter (a metering failure never fails a pricing call); until this
-- migration is applied the insert silently no-ops.

create table if not exists pricing_usage (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  calls int not null default 1,
  lines int not null default 0,
  calc_ms int,
  config_version int,
  procedure text,
  created_at timestamptz not null default now()
);

create index if not exists pricing_usage_tenant_time
  on pricing_usage (tenant_id, created_at desc);

alter table pricing_usage enable row level security;

-- Tenant admins can read their own usage (cockpit usage panel); no write
-- policy — only the service-role dispatcher writes, same posture as
-- webhook_deliveries.
create policy "pricing_usage: tenant read" on pricing_usage for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
