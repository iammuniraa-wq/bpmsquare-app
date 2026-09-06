-- Sample deals for the DEMO tenant (run AFTER 0120_opportunities.sql and
-- scripts/seed-products-demo.sql). Idempotent: skips any title that already
-- exists for the tenant. Six deals across the default stages for the demo
-- accounts, one lost with a reason. Also turns the pipeline feature on for
-- the demo tenant (docs/sales-engine-architecture.md §4.6).

with demo as (select id from tenants where is_demo = true limit 1),
     acc as (
       select a.id, a.name, row_number() over (order by a.name) as rn
       from accounts a, demo where a.tenant_id = demo.id
     ),
     pick as (
       select
         (select id from acc where name ilike 'Demo Motor%' limit 1)      as motor,
         (select id from acc where name ilike 'Demo Company North%' limit 1) as north,
         (select id from acc where name ilike 'Demo Company' limit 1)     as demo_co,
         (select id from acc where rn = 1) as any1,
         (select id from acc where rn = 2) as any2
     )
insert into opportunities (tenant_id, ref, account_id, title, description, stage, outcome, loss_reason, expected_close, amount, probability, source, competitor, team, created_at)
select demo.id, v.ref, coalesce(v.account_id, pick.any1), v.title, v.description, v.stage, v.outcome, v.loss_reason, v.expected_close, v.amount, v.probability, v.source, v.competitor, '[]'::jsonb, now() - (v.age_days || ' days')::interval
from demo, pick,
(values
  ('OPP-0001', (select motor from pick),   'Two passenger elevators — new wing',        'Customer is adding a wing; needs two 8P elevators, wants a comparison with 13P.', 'propose',   'open', null,         (current_date + 35)::date, 3700000.00, 50, 'direct',   'Otis',     21),
  ('OPP-0002', (select north from pick),   'Goods lift for the warehouse',              '2T hydraulic goods lift, 3 floors.',                                             'qualify',   'open', null,         (current_date + 60)::date, 1150000.00, 20, 'lead',     null,        4),
  ('OPP-0003', (select demo_co from pick), 'Comprehensive AMC — 6 elevators',           'Renewal; currently on non-comprehensive with a competitor.',                     'negotiate', 'open', null,         (current_date + 12)::date,  576000.00, 75, 'referral', 'Kone',     40),
  ('OPP-0004', (select motor from pick),   'Controller modernisation, block B',         'Retrofit kits for 3 cars.',                                                       'propose',   'open', null,         (current_date + 25)::date, 1155000.00, 50, 'campaign', null,       12),
  ('OPP-0005', (select any2 from pick),    'Home lift — director''s residence',         'Compact shaftless home lift.',                                                    'won',       'won',  null,         (current_date - 5)::date,  1275000.00, 100, 'direct',  null,       55),
  ('OPP-0006', (select north from pick),   'Motor rewinding — annual contract',         'Lost on price to a local rewinder.',                                              'lost',      'lost', 'price',      (current_date - 20)::date,  340000.00, 0,  'direct',   'Local shop', 70)
) as v(ref, account_id, title, description, stage, outcome, loss_reason, expected_close, amount, probability, source, competitor, age_days)
where not exists (select 1 from opportunities o where o.tenant_id = demo.id and o.title = v.title);

update opportunities o
set closed_at = o.created_at + interval '30 days'
from tenants t
where o.tenant_id = t.id and t.is_demo = true and o.outcome <> 'open' and o.closed_at is null;

-- Feature flag on for the demo tenant only.
update tenants
set features = coalesce(features, '{}'::jsonb) || '{"pipeline": true}'::jsonb
where is_demo = true;
