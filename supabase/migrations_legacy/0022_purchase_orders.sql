-- Migration 0022: purchase_orders + purchase_order_lines
-- Core product objects (every tenant). A PO always has a supplier; quote_id/case_id are
-- independent optional links (which quote this is fulfilling / which repair job needed the
-- part) -- no account_id, it's derivable through either link when needed.

create table if not exists purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  ref           text not null,
  supplier_id   uuid not null references suppliers(id) on delete restrict,
  quote_id      uuid references quotes(id) on delete set null,
  case_id       uuid references service_cases(id) on delete set null,
  status        text not null default 'draft'
                  check (status in ('draft','sent','partially_received','received','cancelled')),
  order_date    date,
  expected_date date,
  notes         text,
  terms         text,
  total         numeric(12,2) not null default 0,
  custom_data   jsonb,
  created_by    uuid,
  created_at    timestamptz not null default now()
);

create unique index if not exists purchase_orders_tenant_ref_uniq on purchase_orders (tenant_id, ref);
create index if not exists purchase_orders_tenant_idx on purchase_orders (tenant_id);
create index if not exists purchase_orders_tenant_supplier_idx on purchase_orders (tenant_id, supplier_id);

create table if not exists purchase_order_lines (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  po_id             uuid not null references purchase_orders(id) on delete cascade,
  inventory_item_id uuid references inventory_items(id) on delete set null,
  sl_no             integer,
  description       text not null,
  uom               text,
  qty_ordered       numeric(12,2) not null default 1,
  qty_received      numeric(12,2) not null default 0,
  rate              numeric(12,2) not null default 0,
  amount            numeric(12,2) not null default 0
);

create index if not exists purchase_order_lines_po_idx on purchase_order_lines (po_id);

-- Soft link only -- no automatic stock mutation from quote lines in v1.
alter table quote_lines add column if not exists inventory_item_id uuid references inventory_items(id) on delete set null;

-- RLS
alter table purchase_orders enable row level security;
alter table purchase_order_lines enable row level security;

create policy "tenant members can read purchase_orders" on purchase_orders for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can insert purchase_orders" on purchase_orders for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can update purchase_orders" on purchase_orders for update
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can delete purchase_orders" on purchase_orders for delete
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "tenant members can read purchase_order_lines" on purchase_order_lines for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can insert purchase_order_lines" on purchase_order_lines for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can update purchase_order_lines" on purchase_order_lines for update
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can delete purchase_order_lines" on purchase_order_lines for delete
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
