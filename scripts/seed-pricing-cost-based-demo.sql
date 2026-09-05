-- Demo seed for BPMSquare Pricing, cost-based technique (spec §17 batch 1½
-- step 3). Targets the is_demo tenant only. Idempotent. Run AFTER
-- 0111_pricing_documents.sql and 0113_pricing_cost_based.sql, and after
-- scripts/seed-products-demo.sql (it keys on the product refs below).
--
-- What it does:
--   1. Turns on the two flags the quote line needs on the demo.
--   2. Gives three demo products the shapes the walk needs:
--        PRD-0007 Motor Rewinding 45 kW  -- a MADE part: copper, labour, salvage
--        PRD-0008 Controller Retrofit    -- a BOUGHT-IN part with a fresh ERP cost
--        PRD-0009 Door Operator Assembly -- a BOUGHT-IN part with a STALE ERP cost
--                                           (so the ladder falls through and the
--                                           quote line asks for an RFQ)
--   3. A supplier with an email address, so "Send RFQ" has someone to write to
--      (the demo redirects every email to the internal inbox anyway).
-- The Price Book itself is created in the app: Pricing -> Pricing setup ->
-- Cost-based -> numbers -> Go live. That is part of the walk on purpose.

-- 1. Flags
update tenants
   set features = coalesce(features, '{}'::jsonb) || '{"pricing_engine": true, "pricing_engine_quotes": true}'::jsonb
 where is_demo = true;

-- 2. Cost sheets and cost-price dates
with demo as (select id from tenants where is_demo = true limit 1)
update products p
   set cost_sheet = '[{"path":"material.rate_per_unit","qty":18},{"path":"labour.rate_per_hour","qty":12},{"path":"salvage.credit_per_unit","qty":6}]'::jsonb,
       cost_price_as_of = current_date
  from demo
 where p.tenant_id = demo.id and p.ref = 'PRD-0007';

with demo as (select id from tenants where is_demo = true limit 1)
update products p
   set cost_sheet = null,
       cost_price_as_of = current_date - 3
  from demo
 where p.tenant_id = demo.id and p.ref = 'PRD-0008';

with demo as (select id from tenants where is_demo = true limit 1)
update products p
   set cost_sheet = null,
       cost_price_as_of = current_date - 95
  from demo
 where p.tenant_id = demo.id and p.ref = 'PRD-0009';

-- 3. A supplier to ask
with demo as (select id from tenants where is_demo = true limit 1)
insert into suppliers (tenant_id, ref, name, type, city, phone, email, status)
select demo.id, 'SUP-0090', 'Meridian Door Systems', 'vendor', 'Pune', null, 'quotes@meridian-doors.example', 'active'
  from demo
 where not exists (select 1 from suppliers s where s.tenant_id = demo.id and s.name = 'Meridian Door Systems');

-- Check
with demo as (select id from tenants where is_demo = true limit 1)
select p.ref, p.name, p.cost_price, p.cost_price_as_of, p.cost_sheet
  from products p, demo
 where p.tenant_id = demo.id and p.ref in ('PRD-0007', 'PRD-0008', 'PRD-0009')
 order by p.ref;
