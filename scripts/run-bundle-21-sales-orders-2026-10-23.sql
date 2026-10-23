-- run-bundle-21-sales-orders-2026-10-23.sql
-- Paste into the Supabase SQL editor of each database (dev, then production). Safe to run twice.
-- = migration 0212: sales_order_types, sales_orders, sales_order_lines, sales_order_attachments (+ private bucket order-attachments)
--   and products.lead_time_days. Independent of the other bundles; needs accounts, contacts, products and opportunities (0120).
-- The app works before and after: until it runs the Sales Orders module shows an empty list. Demo data is separate:
-- run scripts/seed-sales-orders-demo.sql AFTER this (is_demo tenants only), then switch the flag on per client in /admin/tenants.


-- 0212_sales_orders.sql
--
-- Sales Order, phase SO1 (docs/design/sales-order.md, docs/design/sales-order-build-spec-so1.md).
-- Order types, the order and its lines, files and links on an order, and a lead time on products
-- (the master-data availability estimate). Nothing here replicates to an ERP (SO2/SO3).
--
-- RLS (MULTI_TENANT_GUARDRAILS.md): every table has tenant_id and a tenant-isolation policy in this
-- file. sales_orders, sales_order_lines and sales_order_attachments are CRM documents edited by their
-- users, so they carry the standard "for all" policy (the edit rule orderEditable() is enforced in the
-- API, like the quote status rules). sales_order_types steers how every order prints and which pricing
-- mode it gets, so members may only READ it; writing needs a workspace admin (same pattern as 0207).
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs the app shows an empty
-- list / hides the module and never crashes.

alter table products add column if not exists lead_time_days int;

create table if not exists sales_order_types (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  name          text not null,
  prefix        text not null check (prefix ~ '^[A-Z][A-Z0-9]{1,9}$'),
  pricing_mode  text not null default 'internal' check (pricing_mode in ('internal', 'external')),
  -- { blocks, accent_color, logo_position }: the standard_quote_templates block model (0054).
  template      jsonb not null default '{}'::jsonb,
  -- First match wins: [{ "field": "customer_group" | "region" | "source_type", "equals": "..." }]. Empty = never auto-selected.
  rules         jsonb not null default '[]'::jsonb,
  is_default    boolean not null default false,
  active        boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, name)
);

create index if not exists sales_order_types_tenant on sales_order_types (tenant_id, sort_order);
-- At most one default type per workspace.
create unique index if not exists sales_order_types_one_default on sales_order_types (tenant_id) where is_default;

alter table sales_order_types enable row level security;

drop policy if exists "sales_order_types: tenant read" on sales_order_types;
create policy "sales_order_types: tenant read" on sales_order_types for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
drop policy if exists "sales_order_types: admin insert" on sales_order_types;
create policy "sales_order_types: admin insert" on sales_order_types for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'));
drop policy if exists "sales_order_types: admin update" on sales_order_types;
create policy "sales_order_types: admin update" on sales_order_types for update
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'));
drop policy if exists "sales_order_types: admin delete" on sales_order_types;
create policy "sales_order_types: admin delete" on sales_order_types for delete
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'));

create table if not exists sales_orders (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  ref              text not null,
  type_id          uuid references sales_order_types(id) on delete set null,
  origin           text not null default 'bpmsquare' check (origin in ('bpmsquare', 'erp')),
  status           text not null default 'draft' check (status in ('draft', 'confirmed', 'cancelled')),
  -- The ERP's own wording when the ERP owns the status (SO2); null otherwise.
  status_label     text,
  spine            text not null default 'open' check (spine in ('open', 'in_progress', 'completed', 'cancelled')),
  account_id       uuid not null references accounts(id) on delete restrict,
  contact_id       uuid references contacts(id) on delete set null,
  bill_to          jsonb,
  ship_to          jsonb,
  customer_po      text,
  source_type      text not null default 'direct' check (source_type in ('standard_quote', 'quotation', 'opportunity', 'lead', 'email', 'order', 'direct', 'erp')),
  source_id        uuid,
  opportunity_id   uuid references opportunities(id) on delete set null,
  currency         text not null,
  pricing_mode     text not null default 'internal' check (pricing_mode in ('internal', 'external')),
  subtotal         numeric(14,2) not null default 0,
  discount_total   numeric(14,2) not null default 0,
  tax_total        numeric(14,2) not null default 0,
  shipping_amount  numeric(14,2) not null default 0,
  total            numeric(14,2) not null default 0,
  requested_date   date,
  -- Latest confirmed date across the lines; derived, never typed.
  expected_date    date,
  notes            text,
  terms            text,
  owner_user_id    uuid,
  confirmed_at     timestamptz,
  cancelled_at     timestamptz,
  cancel_reason    text,
  sent_at          timestamptz,
  custom_data      jsonb,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, ref)
);

create index if not exists sales_orders_tenant_created on sales_orders (tenant_id, created_at desc);
create index if not exists sales_orders_tenant_account on sales_orders (tenant_id, account_id);
create index if not exists sales_orders_tenant_status on sales_orders (tenant_id, status);
create index if not exists sales_orders_tenant_source on sales_orders (tenant_id, source_type, source_id) where source_id is not null;

alter table sales_orders enable row level security;

drop policy if exists "sales_orders: tenant isolation" on sales_orders;
create policy "sales_orders: tenant isolation" on sales_orders for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists sales_order_lines (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  order_id            uuid not null references sales_orders(id) on delete cascade,
  line_no             int not null default 1,
  product_id          uuid references products(id) on delete set null,
  description         text not null,
  -- Prints on the PDF under the line.
  printed_text        text,
  qty                 numeric(12,2) not null default 1,
  uom                 text,
  unit_price          numeric(14,2) not null default 0,
  -- Four decimals: an order made from a quote folds the quote's header discount into each line.
  discount_pct        numeric(8,4) not null default 0,
  tax_pct             numeric(6,3) not null default 0,
  line_total          numeric(14,2) not null default 0,
  requested_date      date,
  confirmed_qty       numeric(12,2),
  confirmed_date      date,
  availability_source text check (availability_source in ('erp', 'master')),
  availability_at     timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists sales_order_lines_order on sales_order_lines (tenant_id, order_id);

alter table sales_order_lines enable row level security;

drop policy if exists "sales_order_lines: tenant isolation" on sales_order_lines;
create policy "sales_order_lines: tenant isolation" on sales_order_lines for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- Files and links on an order (mirrors standard_quote_attachments, 0119). A file lives in a PRIVATE
-- bucket under {tenant_id}/{order_id}/{uuid}.{ext}; the API uploads and signs download links with the
-- service role and no storage policy grants clients direct access. A link is an https URL.
create table if not exists sales_order_attachments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  order_id    uuid not null references sales_orders(id) on delete cascade,
  kind        text not null default 'other' check (kind in ('customer_po', 'drawing', 'other')),
  type        text not null check (type in ('file', 'link')),
  name        text not null,
  -- Storage path for a file, URL for a link.
  ref         text not null,
  mime_type   text,
  size_bytes  bigint,
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create index if not exists sales_order_attachments_order on sales_order_attachments (tenant_id, order_id);

alter table sales_order_attachments enable row level security;

drop policy if exists "sales_order_attachments: tenant isolation" on sales_order_attachments;
create policy "sales_order_attachments: tenant isolation" on sales_order_attachments for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

insert into storage.buckets (id, name, public)
values ('order-attachments', 'order-attachments', false)
on conflict (id) do nothing;
