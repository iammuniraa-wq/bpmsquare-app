-- 0098: Products — sellable catalog master data (client roadmap 2026-08-22,
-- first item built from PROJECT.md §12). Distinct from inventory_items
-- (stocked parts): a product is what you SELL (goods or service), with an
-- external list price and an internal cost for margin work; the pricing
-- engine and Campaign-studio placeholders build on it later.
--
-- §3b: tenant_id + RLS isolation in the same migration, custom_data from
-- day one. Standard tenant-isolation policy (not the WFM select-only
-- convention -- products are ordinary user-editable master data like
-- suppliers/inventory).

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  ref text,                        -- business id (PRD-####), masterRef-assigned
  name text not null,
  sku text,
  category text,
  uom text,                        -- unit of measure (Nos, Hrs, Kg, ...)
  description text,
  list_price numeric(12,2),        -- external / selling price
  cost_price numeric(12,2),        -- internal cost (margin work; not shown to API consumers by default)
  tax_percent numeric(5,2),        -- GST rate for this product
  status text not null default 'active' check (status in ('active','inactive')),
  custom_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_tenant_idx on products (tenant_id, name);
-- Same partial-unique backstop shape masterRef relies on elsewhere.
create unique index if not exists products_tenant_ref_key on products (tenant_id, ref) where ref is not null;

alter table products enable row level security;

create policy "products: tenant isolation" on products for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- Quote lines can reference the product they were priced from. Resolution
-- happens at pick time; the line keeps its own copied particulars/rate, so
-- deleting a product never breaks an existing quote (§3: the ref is only a
-- create-time link).
alter table quote_lines add column if not exists product_id uuid references products(id) on delete set null;
