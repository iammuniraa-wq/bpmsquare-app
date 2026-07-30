-- Migration 0021: inventory_items + inventory_transactions
-- Core product objects (every tenant). qty_on_hand is only ever mutated through
-- adjust_inventory_qty(), which updates the counter and inserts a ledger row atomically --
-- avoids a lost-update race if two receipts/adjustments land concurrently, and guarantees
-- every stock change is audited.

create table if not exists inventory_items (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  sku           text,
  name          text not null,
  description   text,
  category      text,
  uom           text not null default 'Nos',
  supplier_id   uuid references suppliers(id) on delete set null,
  qty_on_hand   numeric(12,2) not null default 0,
  reorder_level numeric(12,2),
  unit_cost     numeric(12,2),
  status        text not null default 'active' check (status in ('active','inactive')),
  notes         text,
  custom_data   jsonb,
  created_at    timestamptz not null default now()
);

create unique index if not exists inventory_items_tenant_sku_uniq
  on inventory_items (tenant_id, sku) where sku is not null;
create index if not exists inventory_items_tenant_idx on inventory_items (tenant_id);
create index if not exists inventory_items_tenant_supplier_idx on inventory_items (tenant_id, supplier_id);

create table if not exists inventory_transactions (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  type              text not null check (type in ('receipt','adjustment')),
  qty_delta         numeric(12,2) not null,
  balance_after     numeric(12,2) not null,
  reference_type    text check (reference_type in ('purchase_order_line','manual')),
  reference_id      uuid,
  note              text,
  created_by        uuid,
  created_at        timestamptz not null default now()
);

create index if not exists inventory_transactions_item_idx
  on inventory_transactions (tenant_id, inventory_item_id, created_at desc);

create or replace function adjust_inventory_qty(
  p_tenant_id uuid, p_item_id uuid, p_delta numeric,
  p_type text, p_reference_type text, p_reference_id uuid,
  p_note text, p_created_by uuid
) returns numeric language plpgsql as $$
declare v_new numeric;
begin
  update inventory_items set qty_on_hand = qty_on_hand + p_delta
    where id = p_item_id and tenant_id = p_tenant_id
    returning qty_on_hand into v_new;
  if v_new is null then
    raise exception 'inventory item not found';
  end if;
  insert into inventory_transactions
    (tenant_id, inventory_item_id, type, qty_delta, balance_after, reference_type, reference_id, note, created_by)
    values (p_tenant_id, p_item_id, p_type, p_delta, v_new, p_reference_type, p_reference_id, p_note, p_created_by);
  return v_new;
end;
$$;

-- RLS -- same tenant-isolation pattern as every other table (see 0009_suppliers.sql)
alter table inventory_items enable row level security;
alter table inventory_transactions enable row level security;

create policy "tenant members can read inventory_items" on inventory_items for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can insert inventory_items" on inventory_items for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can update inventory_items" on inventory_items for update
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can delete inventory_items" on inventory_items for delete
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "tenant members can read inventory_transactions" on inventory_transactions for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can insert inventory_transactions" on inventory_transactions for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
