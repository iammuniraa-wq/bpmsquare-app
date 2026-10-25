-- run-bundle-28-sales-order-checks-2026-10-24.sql
-- Paste into the Supabase SQL editor of each database (dev, then production). Safe to run twice.
-- = migration 0217: sales_order_checks (the latest Check with ERP result per order and kind: credit, price, stock) and sales_order_transfers
--   (one row per attempt to send an order to the ERP). Both carry a tenant SELECT policy only; every write is the service role.
-- Run AFTER bundle 21 (migration 0212, sales_orders). The app works before and after: until it runs, Check with ERP and Send to ERP say
-- "Needs a database update" and the rest of the order is unchanged.
-- Demo data is separate: run scripts/seed-sales-orders-demo.sql AFTER this to add a passed credit check and a price warning to a demo order.


-- 0217_sales_order_checks.sql
--
-- Sales Order, phase SO3 (docs/design/sales-order.md, "SO3"): Check with ERP (credit, price, stock) and Send to ERP with a
-- transfer log. Needs 0212 (sales_orders).
--
-- 1. sales_order_checks: the latest result of each check on an order (one row per order and kind, replaced by the next run).
--    status passed | warning | failed | not_run, a one-line message, per-line ERP figures for price and stock in detail, and
--    the hash of the lines and customer it was run on, so an edit afterwards shows the result as out of date.
-- 2. sales_order_transfers: one row per attempt to send an order to the ERP (sent, failed with the step that failed, or
--    already sent), who pressed it and the ERP number.
--
-- RLS (MULTI_TENANT_GUARDRAILS.md; same lesson as erp_documents in 0216): both tables carry a tenant SELECT policy and
-- nothing else. A check result and a transfer row are evidence about what the ERP said and did; a member must not be able to
-- write one through PostgREST, so every write goes through the service role from the order code.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, Check with ERP and Send to ERP answer
-- "Needs a database update" and nothing else changes.

create table if not exists sales_order_checks (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  order_id      uuid not null references sales_orders(id) on delete cascade,
  kind          text not null check (kind in ('credit', 'price', 'stock')),
  status        text not null check (status in ('passed', 'warning', 'failed', 'not_run')),
  message       text,
  -- Per-line ERP figures for price and stock (and the exposure behind a credit result).
  detail        jsonb,
  checked_at    timestamptz not null default now(),
  -- Hash of the customer and the lines (product, quantity, price, discount, tax) the check was run on.
  quantity_hash text,
  unique (tenant_id, order_id, kind)
);

create index if not exists sales_order_checks_order on sales_order_checks (tenant_id, order_id);

alter table sales_order_checks enable row level security;

drop policy if exists "sales_order_checks: tenant read" on sales_order_checks;
create policy "sales_order_checks: tenant read" on sales_order_checks for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists sales_order_transfers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  order_id      uuid not null references sales_orders(id) on delete cascade,
  attempted_at  timestamptz not null default now(),
  user_id       uuid,
  result        text not null check (result in ('sent', 'failed', 'already_sent')),
  erp_number    text,
  -- The step that failed (prepare, create, find, link); null on a send that went through.
  step          text,
  message       text
);

create index if not exists sales_order_transfers_order on sales_order_transfers (tenant_id, order_id, attempted_at desc);

alter table sales_order_transfers enable row level security;

drop policy if exists "sales_order_transfers: tenant read" on sales_order_transfers;
create policy "sales_order_transfers: tenant read" on sales_order_transfers for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
