-- 0133: item types on products, and a bill of materials (components) table.
-- Owner request 2026-10-19. A product has an item type (finished product,
-- semi-finished, raw material, bought-out component, consumable, custom /
-- made to order, service, tool or equipment, certification or document, BOM /
-- kit). The list of types and what each one means (stocked, sellable,
-- purchasable, can have components) is tenant configuration in
-- tenants.config, with defaults in code, so there is NO check constraint on
-- the column: the app validates against the tenant's own list and a tenant can
-- rename or add types without a migration. Null = not classified yet and
-- behaves exactly as products do today.
alter table products add column if not exists item_type text;
create index if not exists products_tenant_item_type on products (tenant_id, item_type) where item_type is not null;

-- A BOM line says: this (parent) product contains that (component) product.
-- Components can be any item type (raw, bought-out, semi-finished, service,
-- certification, ...) and a semi-finished component can have its own lines
-- (multi-level; the app rejects loops and caps the depth). `line_kind` tells
-- a consumed component from one that is only used (a tool), which is not part
-- of the material cost. No versions or effective dates yet.
-- §3: a line's own id is what update/delete key on; parent_product_id only
-- resolves the relationship at create time.
create table if not exists product_bom_lines (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  parent_product_id    uuid not null references products(id) on delete cascade,
  component_product_id uuid not null references products(id) on delete restrict,
  qty                  numeric(14,4) not null default 1 check (qty > 0),
  uom                  text,
  scrap_pct            numeric(6,2) not null default 0 check (scrap_pct >= 0 and scrap_pct <= 100),
  line_kind            text not null default 'consumed' check (line_kind in ('consumed','used')),
  sort_order           int not null default 0,
  note                 text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (parent_product_id <> component_product_id),
  unique (parent_product_id, component_product_id)
);

create index if not exists product_bom_lines_parent on product_bom_lines (tenant_id, parent_product_id, sort_order);
create index if not exists product_bom_lines_component on product_bom_lines (tenant_id, component_product_id);

alter table product_bom_lines enable row level security;
drop policy if exists "product_bom_lines: tenant isolation" on product_bom_lines;
create policy "product_bom_lines: tenant isolation" on product_bom_lines for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
