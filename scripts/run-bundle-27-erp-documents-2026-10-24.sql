-- run-bundle-27-erp-documents-2026-10-24.sql
-- Paste into the Supabase SQL editor of each database (dev, then production). Safe to run twice.
-- = migration 0216: erp_documents (deliveries and invoices an ERP reports for a sales order; select-only RLS, service-role writes),
--   sales_orders.account_id made nullable, sales_orders.erp_customer_name and sales_orders.erp_docs_checked_at.
-- Run AFTER bundle 21 (migration 0212, sales_orders). The app works before and after: until it runs the order ERP tab is empty
-- and the Sales orders entity on Integration middleware > Links says a database update is needed.
-- Demo data is separate: run scripts/seed-sales-orders-demo.sql AFTER this to add a sample invoice and delivery to a demo order.


-- 0216_erp_documents.sql
--
-- Sales Order, phase SO2 (docs/design/sales-order.md, "SO2"): orders and their invoices and deliveries coming back from
-- the ERP (Dynamics 365 Sales first). Needs 0212 (sales_orders).
--
-- 1. sales_orders.account_id becomes nullable. An order read from the ERP whose customer has not been synced to an Account
--    yet is kept, with the customer's name from the ERP in erp_customer_name, instead of failing the sync.
-- 2. sales_orders.erp_docs_checked_at: when the follow-up job (or Refresh, or the ERP's webhook) last asked the ERP for this
--    order's invoices. It orders the job's batches and holds a second refresh of the same order for ten seconds.
-- 3. erp_documents: the deliveries and invoices an ERP reports for an order, read-only mirrors. Dataverse invoices are
--    written today; the delivery kind is written only when a connector returns one (Finance & Operations and SAP are SO4).
--
-- RLS (MULTI_TENANT_GUARDRAILS.md; same lesson as the 2026-10-21 credential tables): erp_documents carries a tenant SELECT
-- policy and nothing else. The ERP is the source of truth and a member must not be able to forge or edit a document that
-- drives "Invoiced" and "Paid" on the order path, so every write goes through the service role from the connector code.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs the ERP tab is empty and the Sales orders
-- entity of the middleware says a database update is needed; nothing else changes.

alter table sales_orders alter column account_id drop not null;
alter table sales_orders add column if not exists erp_customer_name text;
alter table sales_orders add column if not exists erp_docs_checked_at timestamptz;

create table if not exists erp_documents (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  order_id      uuid not null references sales_orders(id) on delete cascade,
  kind          text not null check (kind in ('delivery', 'invoice')),
  -- The number a person reads in the ERP (invoicenumber).
  erp_number    text,
  doc_date      date,
  due_date      date,
  amount        numeric(14,2),
  currency      text,
  -- The ERP's own wording of the status, and the spine the screens act on:
  -- invoice: open | closed | paid | cancelled; delivery: open | delivered | cancelled.
  status        text,
  status_spine  text,
  -- The ERP's own id of the document (invoiceid).
  raw_ref       text not null,
  fetched_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (tenant_id, order_id, kind, raw_ref)
);

create index if not exists erp_documents_order on erp_documents (tenant_id, order_id);

alter table erp_documents enable row level security;

drop policy if exists "erp_documents: tenant read" on erp_documents;
create policy "erp_documents: tenant read" on erp_documents for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
