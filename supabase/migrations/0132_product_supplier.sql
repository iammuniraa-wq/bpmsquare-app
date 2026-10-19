-- 0132: a preferred (current) supplier on each product.
-- Owner request 2026-10-19: it is common to have a supplier on the product and
-- the supplier master data already exists. One supplier per product for now
-- (the one the RFQ pre-selects as "current supplier"); a product with several
-- approved suppliers would be a later product_suppliers table.
--
-- Nullable, on delete set null: removing a supplier never deletes a product.
-- The route code verifies the supplier belongs to the same tenant before
-- saving it (a foreign id from a request body is never trusted), and every
-- reader degrades when the column is missing (42703) so nothing breaks while
-- this migration is pending.
alter table products add column if not exists supplier_id uuid references suppliers(id) on delete set null;
create index if not exists products_tenant_supplier on products (tenant_id, supplier_id) where supplier_id is not null;
