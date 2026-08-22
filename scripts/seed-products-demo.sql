-- Sample products for the DEMO tenant (run AFTER 0098_products.sql AND
-- 0099_product_subcategory.sql). Idempotent: skips any name that already
-- exists for the tenant, and safe to RE-RUN on a tenant seeded before 0099 —
-- the sub-category backfill and category-tree config below update in place.
-- Also turns the products feature on for the demo tenant.

with demo as (select id from tenants where is_demo = true limit 1)
insert into products (tenant_id, ref, name, sku, category, uom, description, list_price, cost_price, tax_percent, status)
select demo.id, v.ref, v.name, v.sku, v.category, v.uom, v.description, v.list_price, v.cost_price, v.tax_percent, 'active'
from demo,
(values
  ('PRD-0001', 'Passenger Elevator 8P (630 kg)', 'ELV-P8-630',  'Elevators',    'Nos', '8-passenger machine-room-less elevator, 630 kg, up to 8 floors', 1850000.00, 1425000.00, 18.00),
  ('PRD-0002', 'Passenger Elevator 13P (1000 kg)','ELV-P13-1000','Elevators',    'Nos', '13-passenger elevator, 1000 kg, gearless traction',              2650000.00, 2080000.00, 18.00),
  ('PRD-0003', 'Hydraulic Goods Lift 2T',         'GDL-H-2000',  'Goods lifts',  'Nos', 'Hydraulic goods lift, 2000 kg, 2-4 floors',                       1150000.00,  880000.00, 18.00),
  ('PRD-0004', 'Home Lift 4P Compact',            'ELV-H4-320',  'Elevators',    'Nos', 'Compact residential home lift, 320 kg, shaftless option',         1275000.00,  960000.00, 18.00),
  ('PRD-0005', 'Elevator AMC — Comprehensive',    'AMC-COMP-1Y', 'Service plans','Yr',  'Comprehensive annual maintenance: parts + labour + 24x7 callout',    96000.00,   52000.00, 18.00),
  ('PRD-0006', 'Elevator AMC — Non-comprehensive','AMC-NC-1Y',   'Service plans','Yr',  'Non-comprehensive AMC: labour + preventive visits, parts billed',    54000.00,   28000.00, 18.00),
  ('PRD-0007', 'Motor Rewinding 45 kW',           'SVC-RW-45',   'Services',     'Job', 'Rewinding service for 45 kW traction motor incl. varnish + test',    68000.00,   41000.00, 18.00),
  ('PRD-0008', 'Controller Retrofit Kit V3',      'KIT-CTRL-V3', 'Modernisation','Nos', 'Microprocessor controller retrofit kit with ARD and COP/LOP',       385000.00,  265000.00, 18.00),
  ('PRD-0009', 'Door Operator Assembly',          'PRT-DOOR-01', 'Spares',       'Nos', 'Automatic door operator assembly, centre-opening, VVVF',            118000.00,   82000.00, 18.00),
  ('PRD-0010', 'Wire Rope 13mm (per metre)',      'PRT-ROPE-13', 'Spares',       'Mtr', '13 mm 8x19 traction wire rope',                                        420.00,     290.00, 18.00)
) as v(ref, name, sku, category, uom, description, list_price, cost_price, tax_percent)
where not exists (
  select 1 from products p where p.tenant_id = demo.id and p.name = v.name
);

-- Sub-category backfill (0099): keyed by ref so it also fixes a tenant that
-- was seeded before sub_category existed.
with demo as (select id from tenants where is_demo = true limit 1)
update products p
set sub_category = v.sub_category
from demo,
(values
  ('PRD-0001', 'Passenger'),
  ('PRD-0002', 'Passenger'),
  ('PRD-0003', 'Hydraulic'),
  ('PRD-0004', 'Home lifts'),
  ('PRD-0005', 'Comprehensive'),
  ('PRD-0006', 'Non-comprehensive'),
  ('PRD-0007', 'Repairs'),
  ('PRD-0008', 'Controllers'),
  ('PRD-0009', 'Doors'),
  ('PRD-0010', 'Ropes')
) as v(ref, sub_category)
where p.tenant_id = demo.id and p.ref = v.ref and p.sub_category is distinct from v.sub_category;

-- Demo category tree (Settings -> Sales config -> Product categories).
-- Matches the seeded rows so the dependent dropdowns demo properly.
update tenants
set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('product_categories', '[
  {"name": "Elevators",     "subs": ["Passenger", "Home lifts", "Hospital"]},
  {"name": "Goods lifts",   "subs": ["Hydraulic", "Traction"]},
  {"name": "Service plans", "subs": ["Comprehensive", "Non-comprehensive"]},
  {"name": "Services",      "subs": ["Repairs", "Inspections"]},
  {"name": "Modernisation", "subs": ["Controllers", "Cabins"]},
  {"name": "Spares",        "subs": ["Doors", "Ropes", "Safety"]}
]'::jsonb)
where is_demo = true;

-- Feature flag on for the demo tenant only.
update tenants
set features = coalesce(features, '{}'::jsonb) || '{"products": true}'::jsonb
where is_demo = true;
