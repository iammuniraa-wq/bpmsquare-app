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
