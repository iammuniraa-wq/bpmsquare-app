-- Fence Configurator materials -- BIGBLUE tenant (client wants to see real
-- data, not the generic demo scaffold). Same content as
-- seed-fence-materials-demo.sql, targeting slug = 'bigblue' instead of
-- is_demo = true. Run AFTER 0122_fence_projects.sql (already applied).
-- Idempotent: every insert skips a row that already exists (by sku /
-- label); the category-tree update APPENDS to bigblue's existing
-- REBAR/DOWEL_BARS/BEARINGS/FASTENERS/SAFETY_GEAR/BIRD_CONTROL categories
-- (from seed-bigblue-sample.sql) rather than replacing them.
--
-- This is explicitly TEST DATA the owner intends to remove later --
-- scripts/seed-fence-materials-bigblue-cleanup.sql is its companion,
-- written surgically (deletes only fence-tagged rows) because bigblue
-- also holds real prospect data the cleanup must not touch.
--
-- Coating is PVC coated only for every row, same v1 gap as the demo seed
-- (resolution keys on fence_kind + pipe_class/mesh_spec + coating, not
-- post diameter yet).

-- ── 0. Guard -- mirrors seed-bigblue-sample.sql's own guard (refuses if
--       bigblue is somehow is_demo) plus the reverse check (refuses if
--       'bigblue' doesn't exist, or resolves to more than one tenant). ────
do $$
declare
  bigblue_count int;
begin
  select count(*) into bigblue_count from tenants where slug = 'bigblue';
  if bigblue_count = 0 then
    raise exception 'No tenant with slug bigblue -- create it in /admin/tenants/new first.';
  end if;
  if bigblue_count > 1 then
    raise exception '% tenants have slug bigblue -- slug should be unique. Investigate before re-running.', bigblue_count;
  end if;
  if exists (select 1 from tenants where slug = 'bigblue' and is_demo) then
    raise exception 'bigblue is flagged is_demo -- refusing to run the bigblue-specific seed against it.';
  end if;
  raise notice 'Seeding fence materials into tenant: bigblue';
end $$;

-- ── 1. Security profiles ────────────────────────────────────────────────────
with t as (select id from tenants where slug = 'bigblue')
insert into fence_security_profiles (tenant_id, label, blurb, post_spacing_m, embedment_m, pipe_class, sort_order)
select t.id, v.label, v.blurb, v.post_spacing_m, v.embedment_m, v.pipe_class, v.sort_order
from t,
(values
  ('General yard & storage',      'Fenced boundary, low foot traffic',        3.0, 0.9, 'Schedule 40', 1),
  ('Vehicle & equipment compound','Forklifts, trucks, heavier impact loads',  2.5, 1.0, 'SS20',        2),
  ('Bonded / high-value storage', 'Customs-bonded or high-value goods',       2.0, 1.2, 'SS40',        3)
) as v(label, blurb, post_spacing_m, embedment_m, pipe_class, sort_order)
where not exists (
  select 1 from fence_security_profiles p where p.tenant_id = t.id and p.label = v.label
);

-- ── 2. Post materials -- one per (kind x pipe class), PVC coated ───────────
with t as (select id from tenants where slug = 'bigblue')
insert into products (tenant_id, name, sku, category, sub_category, uom, list_price, cost_price, tax_percent, status, custom_data)
select t.id, v.name, v.sku, 'FENCE_PIPES', v.sub_category, 'meter', v.list_price, v.cost_price, 0.00, 'active', v.custom_data
from t,
(values
  ('Line post -- Schedule 40 (PVC coated)',      'FNC-LP-SCH40-PVC', 'SCH40', 55.00, 42.00, jsonb_build_object('fence_kind','line_post','pipe_class','Schedule 40','coating','PVC coated')),
  ('Line post -- SS20 (PVC coated)',             'FNC-LP-SS20-PVC',  'SS20',  62.00, 47.00, jsonb_build_object('fence_kind','line_post','pipe_class','SS20','coating','PVC coated')),
  ('Line post -- SS40 (PVC coated)',             'FNC-LP-SS40-PVC',  'SS40',  71.00, 54.00, jsonb_build_object('fence_kind','line_post','pipe_class','SS40','coating','PVC coated')),
  ('Straining post -- Schedule 40 (PVC coated)', 'FNC-SP-SCH40-PVC', 'SCH40', 75.00, 58.00, jsonb_build_object('fence_kind','straining_post','pipe_class','Schedule 40','coating','PVC coated')),
  ('Straining post -- SS20 (PVC coated)',        'FNC-SP-SS20-PVC',  'SS20',  84.00, 65.00, jsonb_build_object('fence_kind','straining_post','pipe_class','SS20','coating','PVC coated')),
  ('Straining post -- SS40 (PVC coated)',        'FNC-SP-SS40-PVC',  'SS40',  96.00, 74.00, jsonb_build_object('fence_kind','straining_post','pipe_class','SS40','coating','PVC coated')),
  ('Corner post -- Schedule 40 (PVC coated)',    'FNC-CP-SCH40-PVC', 'SCH40', 75.00, 58.00, jsonb_build_object('fence_kind','corner_post','pipe_class','Schedule 40','coating','PVC coated')),
  ('Corner post -- SS20 (PVC coated)',           'FNC-CP-SS20-PVC',  'SS20',  84.00, 65.00, jsonb_build_object('fence_kind','corner_post','pipe_class','SS20','coating','PVC coated')),
  ('Corner post -- SS40 (PVC coated)',           'FNC-CP-SS40-PVC',  'SS40',  96.00, 74.00, jsonb_build_object('fence_kind','corner_post','pipe_class','SS40','coating','PVC coated')),
  ('Terminal post -- Schedule 40 (PVC coated)',  'FNC-TP-SCH40-PVC', 'SCH40', 75.00, 58.00, jsonb_build_object('fence_kind','terminal_post','pipe_class','Schedule 40','coating','PVC coated')),
  ('Terminal post -- SS20 (PVC coated)',         'FNC-TP-SS20-PVC',  'SS20',  84.00, 65.00, jsonb_build_object('fence_kind','terminal_post','pipe_class','SS20','coating','PVC coated')),
  ('Terminal post -- SS40 (PVC coated)',         'FNC-TP-SS40-PVC',  'SS40',  96.00, 74.00, jsonb_build_object('fence_kind','terminal_post','pipe_class','SS40','coating','PVC coated')),
  ('Gate post -- Schedule 40 (PVC coated)',      'FNC-GP-SCH40-PVC', 'SCH40', 124.00, 95.00, jsonb_build_object('fence_kind','gate_post','pipe_class','Schedule 40','coating','PVC coated')),
  ('Gate post -- SS20 (PVC coated)',             'FNC-GP-SS20-PVC',  'SS20',  138.00, 106.00, jsonb_build_object('fence_kind','gate_post','pipe_class','SS20','coating','PVC coated')),
  ('Gate post -- SS40 (PVC coated)',             'FNC-GP-SS40-PVC',  'SS40',  156.00, 120.00, jsonb_build_object('fence_kind','gate_post','pipe_class','SS40','coating','PVC coated'))
) as v(name, sku, sub_category, list_price, cost_price, custom_data)
where not exists (select 1 from products p where p.tenant_id = t.id and p.sku = v.sku);

-- ── 3. Fabric -- one per mesh spec, PVC coated ─────────────────────────────
with t as (select id from tenants where slug = 'bigblue')
insert into products (tenant_id, name, sku, category, sub_category, uom, list_price, cost_price, tax_percent, status, custom_data)
select t.id, v.name, v.sku, 'FENCE_FABRIC', v.sub_category, 'sqm', v.list_price, v.cost_price, 0.00, 'active', v.custom_data
from t,
(values
  ('Chain-link 50x50 . 2.5mm (PVC coated)',              'FNC-FB-5025-PVC', 'STANDARD',     36.00, 28.00, jsonb_build_object('fence_kind','fabric','mesh_spec','Chain-link 50x50 . 2.5mm','coating','PVC coated')),
  ('Chain-link 25x25 . 3.0mm high-security (PVC coated)','FNC-FB-2530-PVC', 'HIGH_SECURITY',52.00, 40.00, jsonb_build_object('fence_kind','fabric','mesh_spec','Chain-link 25x25 . 3.0mm (high security)','coating','PVC coated')),
  ('Chain-link 16x16 . 4.9mm mini-mesh (PVC coated)',    'FNC-FB-1649-PVC', 'MINI_MESH',    68.00, 52.00, jsonb_build_object('fence_kind','fabric','mesh_spec','Chain-link 16x16 . 4.9mm (mini-mesh)','coating','PVC coated'))
) as v(name, sku, sub_category, list_price, cost_price, custom_data)
where not exists (select 1 from products p where p.tenant_id = t.id and p.sku = v.sku);

-- ── 4. Hardware -- one per BOM kind, PVC coated ────────────────────────────
with t as (select id from tenants where slug = 'bigblue')
insert into products (tenant_id, name, sku, category, sub_category, uom, list_price, cost_price, tax_percent, status, custom_data)
select t.id, v.name, v.sku, 'FENCE_HARDWARE', v.sub_category, v.uom, v.list_price, v.cost_price, 0.00, 'active', v.custom_data
from t,
(values
  ('Tension band (PVC coated)',        'FNC-HW-TBAND-PVC', 'BANDS',    'pcs',  7.50,   6.00, jsonb_build_object('fence_kind','tension_band','coating','PVC coated')),
  ('Brace band (PVC coated)',          'FNC-HW-BBAND-PVC', 'BANDS',    'pcs',  9.00,   7.00, jsonb_build_object('fence_kind','brace_band','coating','PVC coated')),
  ('Rail end (PVC coated)',            'FNC-HW-RAILEND-PVC','FITTINGS','pcs', 11.50,   9.00, jsonb_build_object('fence_kind','rail_end','coating','PVC coated')),
  ('Carriage bolt & nut set',          'FNC-HW-BOLT-SET',  'FASTENERS','sets', 2.00,   1.50, jsonb_build_object('fence_kind','carriage_bolt_set','coating','PVC coated')),
  ('Truss rod & turnbuckle set',       'FNC-HW-TRUSS-SET', 'BRACING',  'sets',82.00,  65.00, jsonb_build_object('fence_kind','truss_rod_set','coating','PVC coated')),
  ('Tension wire Ø3.15',               'FNC-HW-TWIRE',     'WIRE',     'm',    2.70,   2.10, jsonb_build_object('fence_kind','tension_wire','coating','PVC coated')),
  ('Tie wire Ø2.0',                    'FNC-HW-TIEWIRE',   'WIRE',     'kg',  48.00,  38.00, jsonb_build_object('fence_kind','tie_wire','coating','PVC coated')),
  ('Barbed wire Ø2.5 (double twist)',  'FNC-HW-BARBED',    'WIRE',     'm',    3.20,   2.50, jsonb_build_object('fence_kind','barbed_wire','coating','PVC coated'))
) as v(name, sku, sub_category, uom, list_price, cost_price, custom_data)
where not exists (select 1 from products p where p.tenant_id = t.id and p.sku = v.sku);

-- ── 5. Category tree -- APPEND, never replace. bigblue's existing
--       REBAR/DOWEL_BARS/BEARINGS/FASTENERS/SAFETY_GEAR/BIRD_CONTROL
--       categories (seed-bigblue-sample.sql) must survive this. ──────────
update tenants
set config = jsonb_set(
  coalesce(config, '{}'::jsonb),
  '{product_categories}',
  coalesce(config -> 'product_categories', '[]'::jsonb) || '[
    {"code": "FENCE_PIPES",    "name": "Pipes",            "subs": [{"code": "SCH40", "name": "Schedule 40"}, {"code": "SS20", "name": "SS20"}, {"code": "SS40", "name": "SS40"}, {"code": "COMMERCIAL", "name": "Commercial pipe"}]},
    {"code": "FENCE_FABRIC",   "name": "Chain-link fabric","subs": [{"code": "STANDARD", "name": "50x50 standard"}, {"code": "HIGH_SECURITY", "name": "25x25 high security"}, {"code": "MINI_MESH", "name": "16x16 mini-mesh"}]},
    {"code": "FENCE_HARDWARE", "name": "Accessories",      "subs": [{"code": "BANDS", "name": "Tension/brace bands"}, {"code": "FITTINGS", "name": "Rail ends & fittings"}, {"code": "FASTENERS", "name": "Fasteners"}, {"code": "BRACING", "name": "Truss & bracing"}, {"code": "WIRE", "name": "Wire"}]}
  ]'::jsonb,
  true
)
where slug = 'bigblue'
  and not (coalesce(config -> 'product_categories', '[]'::jsonb) @> '[{"code": "FENCE_PIPES"}]'::jsonb);

-- ── 6. Feature flag on for bigblue ──────────────────────────────────────────
update tenants
set features = coalesce(features, '{}'::jsonb) || '{"fence_projects": true}'::jsonb
where slug = 'bigblue';

-- ── 7. Check ────────────────────────────────────────────────────────────────
with t as (select id from tenants where slug = 'bigblue')
select 'fence_security_profiles' as tbl, count(*) from fence_security_profiles, t where tenant_id = t.id
union all select 'fence products', count(*) from products, t where tenant_id = t.id and sku like 'FNC-%'
order by 1;
-- Expected: fence_security_profiles 3, fence products 26.
