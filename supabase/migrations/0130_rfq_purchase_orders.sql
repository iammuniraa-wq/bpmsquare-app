-- 0130: RFQ awards -> purchase orders (docs/rfq-architecture.md §3 step 9).
-- A PO raised from an RFQ remembers the RFQ, and each PO line remembers the
-- awarded supplier response it came from -- which is how the RFQ knows a
-- line is already ordered and never orders it twice. product_id on a PO line
-- is the catalog item bought (PO lines only ever pointed at stocked
-- inventory items before; an RFQ is usually about a catalog product).
--
-- All nullable, all "on delete set null": deleting an RFQ or a response must
-- never take a purchase order with it. Existing RLS on both tables covers
-- the new columns. Run AFTER 0128 (the referenced tables).

alter table purchase_orders      add column if not exists rfq_id uuid references rfqs(id) on delete set null;
alter table purchase_orders      add column if not exists standard_quote_id uuid references standard_quotes(id) on delete set null;
alter table purchase_order_lines add column if not exists product_id uuid references products(id) on delete set null;
alter table purchase_order_lines add column if not exists rfq_response_id uuid references rfq_responses(id) on delete set null;

create index if not exists purchase_orders_tenant_rfq on purchase_orders (tenant_id, rfq_id) where rfq_id is not null;
create index if not exists purchase_order_lines_rfq_response on purchase_order_lines (tenant_id, rfq_response_id) where rfq_response_id is not null;
