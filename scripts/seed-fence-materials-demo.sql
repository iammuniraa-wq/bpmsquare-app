-- Fence Configurator materials -- DEMO tenant only (Fence Configurator
-- Phase C, docs/fence-configurator-architecture.md §7). Run AFTER
-- 0122_fence_projects.sql. Idempotent: every insert skips a row that
-- already exists (by sku / label); the category-tree update APPENDS to
-- whatever product_categories already exists (this tenant's elevator
-- categories from seed-products-demo.sql must survive this script, not
-- get overwritten by it).
--
-- Coating is PVC coated only for every row -- matching materials.ts's
-- documented v1 gap: resolution keys on fence_kind + pipe_class/mesh_spec
-- + coating, not post diameter (their own catalog has "Tension band
-- Ø60.3" vs "Ø48.3" as distinct SKUs; ours doesn't yet). One representative
-- coating is enough to prove the resolution path end to end; GI/Powder
-- coated variants are a follow-up seed once diameter is modelled.

-- ── 0. Guard -- fail loud, not silent, same pattern seed-bigblue-sample.sql
--       already uses for the opposite direction (that script refuses to run
--       if bigblue is_demo; this one refuses to run if the is_demo tenant
--       turns out to BE a real client). Every insert below is driven by
--       `is_demo = true` alone -- if that flag is ever wrong on a real
--       client tenant, this guard is what stops their catalog from
--       silently gaining 26 fence products instead of a downstream insert
--       quietly doing it.
--
--       Does NOT hardcode the sandbox's slug (fixed 2026-09-07: the first
--       version required exactly "demo", which is only prod's naming --
--       dev's own sandbox tenant is slugged "dev" and correctly failed
--       this check). Blocklists known real client slugs instead, which is
--       what the danger actually is, and holds across every environment
--       regardless of what the sandbox happens to be called there. Real
--       clients confirmed from /admin/tenants (2026-09-07): bigblue, bim
--       (BIM Infotech Pvt Ltd), vikas-pioneers -- 3 real + 1 sandbox
--       (demo), 4 tenants total in production. ─────────────────────────
do $$
declare
  demo_count int;
  demo_slug text;
  demo_name text;
begin
  select count(*) into demo_count from tenants where is_demo = true;
  if demo_count = 0 then
    raise exception 'No tenant has is_demo = true -- nothing to seed. Check the sandbox tenant''s is_demo flag before re-running.';
  end if;
  if demo_count > 1 then
    raise exception '% tenants have is_demo = true -- this script assumes exactly one. Fix the flag before re-running.', demo_count;
  end if;

  select slug, name into demo_slug, demo_name from tenants where is_demo = true;

  if demo_slug in ('bigblue', 'bim', 'vikas-pioneers', 'vikas') then
    raise exception 'The is_demo tenant resolves to slug %, a known real client -- refusing to seed. This is exactly how a real client would silently receive sample fence data.', demo_slug;
  end if;

  raise notice 'Seeding fence materials into tenant: % (slug=%)', demo_name, demo_slug;
end $$;

-- ── 1. Security profiles (matches FencePreviewClient's SEED_PROFILES) ──────
with demo as (select id from tenants where is_demo = true limit 1)
insert into fence_security_profiles (tenant_id, label, blurb, post_spacing_m, embedment_m, pipe_class, sort_order)
select demo.id, v.label, v.blurb, v.post_spacing_m, v.embedment_m, v.pipe_class, v.sort_order
from demo,
(values
  ('General yard & storage',      'Fenced boundary, low foot traffic',        3.0, 0.9, 'Schedule 40', 1),
  ('Vehicle & equipment compound','Forklifts, trucks, heavier impact loads',  2.5, 1.0, 'SS20',        2),
  ('Bonded / high-value storage', 'Customs-bonded or high-value goods',       2.0, 1.2, 'SS40',        3)
) as v(label, blurb, post_spacing_m, embedment_m, pipe_class, sort_order)
where not exists (
  select 1 from fence_security_profiles p where p.tenant_id = demo.id and p.label = v.label
);

-- ── 2. Post materials -- one per (kind x pipe class), PVC coated ───────────
with demo as (select id from tenants where is_demo = true limit 1)
insert into products (tenant_id, name, sku, category, sub_category, uom, list_price, cost_price, tax_percent, status, custom_data)
select demo.id, v.name, v.sku, 'FENCE_PIPES', v.sub_category, 'meter', v.list_price, v.cost_price, 18.00, 'active', v.custom_data
from demo,
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
where not exists (select 1 from products p where p.tenant_id = demo.id and p.sku = v.sku);

-- ── 3. Fabric -- one per mesh spec, PVC coated ─────────────────────────────
with demo as (select id from tenants where is_demo = true limit 1)
insert into products (tenant_id, name, sku, category, sub_category, uom, list_price, cost_price, tax_percent, status, custom_data)
select demo.id, v.name, v.sku, 'FENCE_FABRIC', v.sub_category, 'sqm', v.list_price, v.cost_price, 18.00, 'active', v.custom_data
from demo,
(values
  ('Chain-link 50x50 . 2.5mm (PVC coated)',              'FNC-FB-5025-PVC', 'STANDARD',     36.00, 28.00, jsonb_build_object('fence_kind','fabric','mesh_spec','Chain-link 50x50 . 2.5mm','coating','PVC coated')),
  ('Chain-link 25x25 . 3.0mm high-security (PVC coated)','FNC-FB-2530-PVC', 'HIGH_SECURITY',52.00, 40.00, jsonb_build_object('fence_kind','fabric','mesh_spec','Chain-link 25x25 . 3.0mm (high security)','coating','PVC coated')),
  ('Chain-link 16x16 . 4.9mm mini-mesh (PVC coated)',    'FNC-FB-1649-PVC', 'MINI_MESH',    68.00, 52.00, jsonb_build_object('fence_kind','fabric','mesh_spec','Chain-link 16x16 . 4.9mm (mini-mesh)','coating','PVC coated'))
) as v(name, sku, sub_category, list_price, cost_price, custom_data)
where not exists (select 1 from products p where p.tenant_id = demo.id and p.sku = v.sku);

-- ── 4. Hardware -- one per BOM kind, PVC coated ────────────────────────────
with demo as (select id from tenants where is_demo = true limit 1)
insert into products (tenant_id, name, sku, category, sub_category, uom, list_price, cost_price, tax_percent, status, custom_data)
select demo.id, v.name, v.sku, 'FENCE_HARDWARE', v.sub_category, v.uom, v.list_price, v.cost_price, 18.00, 'active', v.custom_data
from demo,
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
where not exists (select 1 from products p where p.tenant_id = demo.id and p.sku = v.sku);

-- ── 5. Category tree -- APPEND, never replace (0099-shaped: code + name,
--       two levels). seed-products-demo.sql's elevator categories must
--       still be there after this runs. ──────────────────────────────────
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
where is_demo = true
  and not (coalesce(config -> 'product_categories', '[]'::jsonb) @> '[{"code": "FENCE_PIPES"}]'::jsonb);

-- ── 6. Feature flag on for the demo tenant only ────────────────────────────
update tenants
set features = coalesce(features, '{}'::jsonb) || '{"fence_projects": true, "products": true}'::jsonb
where is_demo = true;
