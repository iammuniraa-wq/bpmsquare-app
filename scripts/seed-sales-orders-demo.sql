-- Sample sales orders for the DEMO tenant. Run AFTER supabase/migrations/0212_sales_orders.sql
-- (and, for product-linked lines, after scripts/seed-products-demo.sql; without products the lines are plain text).
-- Idempotent: the order type is created once, an order is skipped when its ref exists, lines are added only to an
-- order that has none. Touches ONLY tenants where is_demo = true; never a client. Also switches the sales_orders
-- feature on for demo tenants. Sends nothing anywhere.

-- 1. One default order type per demo workspace.
insert into sales_order_types (tenant_id, name, prefix, pricing_mode, template, rules, is_default, active, sort_order)
select t.id, 'Standard order', 'SO', 'internal', '{}'::jsonb, '[]'::jsonb, true, true, 0
from tenants t
where t.is_demo = true
  and not exists (select 1 from sales_order_types x where x.tenant_id = t.id and x.name = 'Standard order')
  and not exists (select 1 from sales_order_types x where x.tenant_id = t.id and x.is_default);

-- 2. Three sample orders on the first three demo accounts.
with demo as (select id, coalesce(nullif(config ->> 'currency', ''), 'INR') as currency from tenants where is_demo = true limit 1),
     acc as (
       select a.id, row_number() over (order by a.name) as rn
       from accounts a, demo where a.tenant_id = demo.id
     ),
     ty as (select s.id, s.tenant_id from sales_order_types s, demo where s.tenant_id = demo.id and s.name = 'Standard order')
insert into sales_orders (tenant_id, ref, type_id, origin, status, spine, account_id, customer_po, source_type, currency, pricing_mode,
                          requested_date, notes, confirmed_at, created_at)
select demo.id, v.ref, (select id from ty), 'bpmsquare', v.status, case when v.status = 'cancelled' then 'cancelled' else 'open' end,
       acc.id, v.customer_po, 'direct', demo.currency, 'internal',
       (current_date + v.requested_in)::date, v.notes,
       case when v.status = 'confirmed' then now() - (v.age_days || ' days')::interval + interval '1 hour' else null end,
       now() - (v.age_days || ' days')::interval
from demo,
(values
  ('SO-0001', 1, 'confirmed', 'PO-44871', 30, 'Two passenger elevators for the new wing.', 9),
  ('SO-0002', 2, 'draft',     null,        45, 'Goods lift for the warehouse; waiting for the customer PO.', 2),
  ('SO-0003', 3, 'confirmed', 'PO-9012',   10, 'Spares for the monthly service round.', 14)
) as v(ref, acc_rn, status, customer_po, requested_in, notes, age_days)
join acc on acc.rn = v.acc_rn
where not exists (select 1 from sales_orders o where o.tenant_id = demo.id and o.ref = v.ref);

-- 3. Lines (product-linked when the demo products exist).
with demo as (select id from tenants where is_demo = true limit 1)
insert into sales_order_lines (tenant_id, order_id, line_no, product_id, description, printed_text, qty, uom, unit_price, discount_pct, tax_pct, line_total,
                               requested_date, confirmed_qty, confirmed_date, availability_source, availability_at)
select demo.id, o.id, v.line_no,
       (select p.id from products p where p.tenant_id = demo.id and p.ref = v.product_ref limit 1),
       v.description, v.printed_text, v.qty, v.uom, v.unit_price, v.discount_pct, 18,
       round(v.qty * v.unit_price * (1 - v.discount_pct / 100), 2),
       o.requested_date, v.confirmed_qty, v.confirmed_date, case when v.confirmed_qty is null then null else 'master' end,
       case when v.confirmed_qty is null then null else now() end
from demo
join sales_orders o on o.tenant_id = demo.id
join (values
  ('SO-0001', 1, 'PRD-0001', 'Passenger Elevator 8P (630 kg)', 'Machine-room-less, 630 kg, 8 floors. Includes installation and commissioning.', 2, 'Nos', 1850000.00, 5, 2, (current_date + 28)::date),
  ('SO-0001', 2, 'PRD-0005', 'Elevator AMC - Comprehensive', 'First year of comprehensive maintenance, parts and 24x7 callout.', 2, 'Yr', 96000.00, 0, 2, (current_date + 28)::date),
  ('SO-0002', 1, 'PRD-0003', 'Hydraulic Goods Lift 2T', null, 1, 'Nos', 1150000.00, 0, null, null),
  ('SO-0002', 2, 'PRD-0009', 'Door Operator Assembly', 'Centre-opening, VVVF drive.', 2, 'Nos', 118000.00, 0, null, null),
  ('SO-0003', 1, 'PRD-0009', 'Door Operator Assembly', null, 4, 'Nos', 118000.00, 0, 4, (current_date + 24)::date),
  ('SO-0003', 2, 'PRD-0010', 'Wire Rope 13mm (per metre)', null, 200, 'Mtr', 420.00, 0, 120, (current_date + 40)::date)
) as v(ref, line_no, product_ref, description, printed_text, qty, uom, unit_price, discount_pct, confirmed_qty, confirmed_date)
  on v.ref = o.ref
where not exists (select 1 from sales_order_lines l where l.order_id = o.id);

-- 4. Totals and the expected delivery date, derived the way the app derives them.
with demo as (select id from tenants where is_demo = true limit 1),
     agg as (
       select l.order_id,
              sum(l.qty * l.unit_price) as gross,
              sum(l.line_total) as net,
              sum(l.line_total * l.tax_pct / 100) as tax,
              max(l.confirmed_date) as latest
       from sales_order_lines l, demo where l.tenant_id = demo.id
       group by l.order_id
     )
update sales_orders o
set subtotal = round(agg.gross, 2),
    discount_total = round(agg.gross - agg.net, 2),
    tax_total = round(agg.tax, 2),
    total = round(agg.net + agg.tax + o.shipping_amount, 2),
    expected_date = agg.latest
from agg
where o.id = agg.order_id and o.total = 0;

-- 5. Feature flag on for the demo tenant only.
update tenants
set features = coalesce(features, '{}'::jsonb) || '{"sales_orders": true}'::jsonb
where is_demo = true;

-- 4. A sample invoice and delivery on SO-0001, so the ERP tab and the order path have something to show on the demo workspace.
-- Run AFTER supabase/migrations/0216_erp_documents.sql (scripts/run-bundle-27-erp-documents-2026-10-24.sql); a database without
-- erp_documents skips this part. These are SAMPLE rows (numbers start SAMPLE-, raw_ref starts sample-): nothing came from an ERP.
do $erp$
begin
  if to_regclass('public.erp_documents') is null then
    raise notice 'erp_documents does not exist yet: run the 0216 bundle, then this script again for the sample ERP documents.';
    return;
  end if;
  insert into erp_documents (tenant_id, order_id, kind, erp_number, doc_date, due_date, amount, currency, status, status_spine, raw_ref)
  select o.tenant_id, o.id, v.kind, v.erp_number, (current_date - v.age_days)::date, v.due_in, round(o.total * v.share, 2), o.currency, v.status, v.spine, v.raw_ref
  from sales_orders o
  join tenants t on t.id = o.tenant_id and t.is_demo = true
  join (values
    ('delivery', 'SAMPLE-DLV-0001', 'Delivered', 'delivered', 'sample-delivery-0001', 1.0, 6, null::date),
    ('invoice',  'SAMPLE-INV-0001', 'Active',    'open',      'sample-invoice-0001',  0.5, 5, (current_date + 25)::date)
  ) as v(kind, erp_number, status, spine, raw_ref, share, age_days, due_in) on true
  where o.ref = 'SO-0001'
    and not exists (select 1 from erp_documents d where d.tenant_id = o.tenant_id and d.order_id = o.id and d.kind = v.kind and d.raw_ref = v.raw_ref);
end
$erp$;

-- 5. A Check with ERP result on the draft SO-0002, so the ERP tab shows what a check looks like on the demo workspace.
-- Run AFTER supabase/migrations/0217_sales_order_checks.sql (scripts/run-bundle-28-sales-order-checks-2026-10-24.sql); a database without
-- sales_order_checks skips this part. These are SAMPLE results (the message starts with "Sample:"): nothing came from an ERP.
-- No quantity_hash is stored, so the sample never reads as out of date; the first real check replaces both rows.
do $checks$
begin
  if to_regclass('public.sales_order_checks') is null then
    raise notice 'sales_order_checks does not exist yet: run the 0217 bundle, then this script again for the sample checks.';
    return;
  end if;
  insert into sales_order_checks (tenant_id, order_id, kind, status, message, detail, checked_at)
  select o.tenant_id, o.id, v.kind, v.status, v.message, v.detail::jsonb, now() - interval '20 minutes'
  from sales_orders o
  join tenants t on t.id = o.tenant_id and t.is_demo = true
  join (values
    ('credit', 'passed',  'Sample: within the credit limit, nothing on hold.', '{"sample": true}'),
    ('price',  'warning', 'Sample: 1 of 2 lines is priced differently from the ERP price list.', '{"sample": true, "lines": [{"line_no": 2, "bpm_price": 118000, "erp_price": 121500}]}')
  ) as v(kind, status, message, detail) on true
  where o.ref = 'SO-0002'
  on conflict (tenant_id, order_id, kind) do nothing;
end
$checks$;
