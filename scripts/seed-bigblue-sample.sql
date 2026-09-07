-- Big Blue sample data (Doha, Qatar -- rebar, dowel bars, bridge bearings,
-- fasteners, safety gear). SQL twin of scripts/seed-bigblue-sample.mjs for
-- the Supabase SQL editor. Paste the whole file and run it once; it is
-- idempotent (every block skips what already exists). Written 2026-09-07.
--
-- Targets the tenant whose slug is `bigblue` -- create it in
-- /admin/tenants/new first (TENANT_PROVISIONING.md §1). Every row carries
-- that tenant's id; nothing here touches any other tenant.
--
-- Needs migrations through 0121 (applied on production 2026-09-06). Deals
-- need 0120 (opportunities): the deal block and the quote→deal links skip
-- themselves cleanly if that table is still missing.
--
-- PII (account/contact phone + email) is left empty on purpose: the app
-- encrypts those on write and SQL cannot; add through the UI if needed.
-- Supplier emails are .example addresses.
--
-- To remove it all later: scripts/seed-bigblue-sample-cleanup.sql.

-- ── 0. Guard ────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from tenants where slug = 'bigblue') then
    raise exception 'No tenant with slug bigblue -- create it in /admin/tenants/new first';
  end if;
  if exists (select 1 from tenants where slug = 'bigblue' and is_demo) then
    raise exception 'bigblue is the is_demo tenant -- this seed is for the Big Blue tenant only';
  end if;
end $$;

-- ── 1. Features, config, letterhead ─────────────────────────────────────────
update tenants
   set features = coalesce(features, '{}'::jsonb) || '{
         "accounts": true, "contacts": true, "suppliers": true, "products": true,
         "standard_quotes": true, "pipeline": true, "pricing_engine": true,
         "pricing_engine_quotes": true, "reports": true, "data_workbench": true,
         "administration": true }'::jsonb,
       config = coalesce(config, '{}'::jsonb)
         || jsonb_build_object(
              'currency', 'QAR',
              'product_categories', '[
                {"code":"REBAR","name":"Reinforcement bars","subs":[{"code":"B500B_12MM","name":"B500B 12 mm"},{"code":"B500B_16MM","name":"B500B 16 mm"},{"code":"B500B_20MM","name":"B500B 20 mm"},{"code":"B500B_25MM","name":"B500B 25 mm"},{"code":"B500B_32MM","name":"B500B 32 mm"}]},
                {"code":"DOWEL_BARS","name":"Dowel bars","subs":[{"code":"D20_PLAIN","name":"20 mm plain"},{"code":"D25_EPOXY","name":"25 mm epoxy coated"},{"code":"D20_SS316","name":"20 mm SS316"},{"code":"D32_EPOXY","name":"32 mm epoxy coated"}]},
                {"code":"BEARINGS","name":"Bridge bearings","subs":[{"code":"PTFE","name":"PTFE sliding"},{"code":"ELASTOMERIC","name":"Elastomeric"},{"code":"CUSTOM","name":"Custom / engineered"}]},
                {"code":"FASTENERS","name":"Fasteners & anchors","subs":[{"code":"ANCHOR_BOLTS","name":"Anchor bolts"},{"code":"CHEMICAL_ANCHORS","name":"Chemical anchors"},{"code":"HEX_BOLTS","name":"Hex bolts"}]},
                {"code":"SAFETY_GEAR","name":"Safety gear (PPE)","subs":[{"code":"HEAD","name":"Head protection"},{"code":"BODY","name":"Body & hi-vis"},{"code":"FALL","name":"Fall protection"}]},
                {"code":"BIRD_CONTROL","name":"Bird control","subs":[{"code":"SPIKES","name":"Spikes"}]}
              ]'::jsonb,
              'wfm', coalesce(config -> 'wfm', '{}'::jsonb) || '{"timezone": "Asia/Qatar"}'::jsonb,
              'pricing', coalesce(config -> 'pricing', '{}'::jsonb) || '{"routing": {
                "rules": [
                  {"attribute": "product.category", "value": "REBAR",      "area": "steel_catalog"},
                  {"attribute": "product.category", "value": "DOWEL_BARS", "area": "steel_catalog"}
                ],
                "default_area": "default" }}'::jsonb)
         || case when coalesce(config, '{}'::jsonb) ? 'tax' then '{}'::jsonb
                 else '{"tax": {"label": "VAT", "rate": 0, "inclusive": false}}'::jsonb end
         -- No sample row has a real address, but an email demo must never
         -- reach a stranger: redirect to the owner's inbox until changed.
         || case when coalesce(config, '{}'::jsonb) ? 'email_output' then '{}'::jsonb
                 else '{"email_output": {"mode": "redirect", "redirect_to": "sap.rashid@gmail.com"}}'::jsonb end,
       -- Letterhead for the PDF: seeded keys only where the owner left them empty.
       company_info = '{
         "name": "Big Blue Engineering Solutions W.L.L.",
         "tagline": "Engineered products for infrastructure — rebar, dowel bars, bearings, fasteners",
         "address": "Building 27, Street 45, Industrial Area, Doha, Qatar",
         "email": "sales@bigblue.example",
         "web": "bigblue.example",
         "phones": [{"label": "Sales", "number": "+974 4000 0000"}],
         "footer_tagline": "Supplying Qatar''s contractors since 2009"
       }'::jsonb || coalesce(company_info, '{}'::jsonb)
 where slug = 'bigblue';

-- ── 2. Accounts (region = state, customer tier = type) ──────────────────────
with t as (select id from tenants where slug = 'bigblue')
insert into accounts (tenant_id, ref, name, type, city, state, country, industry, employee_count, website, address_line1, notes, marketing_opt_out)
select t.id, v.ref, v.name, v.type, v.city, v.state, 'Qatar', v.industry, v.employee_count, v.website, v.address_line1, v.notes, false
  from t, (values
  ('ACC-0001', 'Al Khaleej Contracting W.L.L.', 'direct',   'Doha',       'Doha',       'Civil contractor',                 '1000+',    'alkhaleej-contracting.example', 'Building 14, Street 850, Industrial Area', 'Main contractor on North Field East Package 3. Buys rebar and dowels by the tonne; wants mill certificates with every delivery.'),
  ('ACC-0002', 'Doha Infrastructure Company',   'direct',   'Doha',       'Doha',       'Roads & bridges contractor',       '500-1000', 'dohainfra.example',             'Tower 2, West Bay',                        'Expressway and interchange packages for Ashghal. Specifies PTFE and elastomeric bearings.'),
  ('ACC-0003', 'Lusail Build JV',               'direct',   'Lusail',     'Lusail',     'High-rise & mixed-use contractor', '500-1000', 'lusailbuild.example',           'Marina District, Lusail',                  'Joint venture; procurement runs through the JV commercial team.'),
  ('ACC-0004', 'Gulf Bridge Contractors',       'direct',   'Al Wakrah',  'Al Wakrah',  'Marine & bridge works',            '200-500',  'gulfbridge.example',            'Al Wakrah Port Road',                      'Marine works; regular buyer of SS316 dowels and custom bearings.'),
  ('ACC-0005', 'Ras Laffan Civil Works',        'direct',   'Ras Laffan', 'Ras Laffan', 'Industrial civil works (LNG)',     '200-500',  'rlcw.example',                  'Ras Laffan Industrial City',               'Deliveries need gate passes; freight surcharge applies (see Price Book).'),
  ('ACC-0006', 'Wakrah Marine Construction',    'prospect', 'Al Wakrah',  'Al Wakrah',  'Marine contractor',                '50-200',   'wakrahmarine.example',          'Al Wakrah',                                'Quoted PPE once; lost on price to a Sharjah trader.'),
  ('ACC-0007', 'Peninsula Consulting Engineers','prospect', 'Doha',       'Doha',       'Consulting engineer (specifier)',  '50-200',   'peninsula-ce.example',          'Al Sadd',                                  'Specifier, not a buyer -- influences bearing and dowel specs on Ashghal packages.'),
  ('ACC-0008', 'Qatar Metro Package 4 JV',      'prospect', 'Doha',       'Doha',       'Rail infrastructure JV',           '1000+',    'qmp4jv.example',                'Msheireb',                                 'Six-station package; dowel bar tender expected Q4.')
 ) as v(ref, name, type, city, state, industry, employee_count, website, address_line1, notes)
 where not exists (select 1 from accounts a where a.tenant_id = t.id and (a.ref = v.ref or a.name = v.name));

-- ── 3. Contacts ─────────────────────────────────────────────────────────────
with t as (select id from tenants where slug = 'bigblue')
insert into contacts (tenant_id, ref, account_id, name, role, department, country)
select t.id, v.ref, a.id, v.name, v.role, v.department, 'Qatar'
  from t, (values
  ('CON-0001', 'ACC-0001', 'Khalid Al-Mansoori', 'Procurement Manager', 'Procurement'),
  ('CON-0002', 'ACC-0001', 'Ravi Menon',         'Quantity Surveyor',   'Commercial'),
  ('CON-0003', 'ACC-0002', 'Fatima Al-Thani',    'Project Director',    'Projects'),
  ('CON-0004', 'ACC-0002', 'Joseph Mathew',      'Site Engineer',       'Site'),
  ('CON-0005', 'ACC-0003', 'Ahmed Hassan',       'Procurement Lead',    'Procurement'),
  ('CON-0006', 'ACC-0004', 'Sarah Mitchell',     'Commercial Manager',  'Commercial'),
  ('CON-0007', 'ACC-0005', 'Mohammed Al-Kuwari', 'Materials Engineer',  'Engineering'),
  ('CON-0008', 'ACC-0006', 'Nikhil Sharma',      'Buyer',               'Procurement'),
  ('CON-0009', 'ACC-0007', 'Dr. Omar Farouk',    'Structural Lead',     'Structures'),
  ('CON-0010', 'ACC-0008', 'Elena Rossi',        'Package Procurement', 'Procurement')
 ) as v(ref, account_ref, name, role, department)
 join accounts a on a.tenant_id = t.id and a.ref = v.account_ref
 where not exists (select 1 from contacts c where c.tenant_id = t.id and (c.ref = v.ref or c.name = v.name));

-- ── 4. Suppliers ────────────────────────────────────────────────────────────
with t as (select id from tenants where slug = 'bigblue')
insert into suppliers (tenant_id, ref, name, type, city, email, notes, status)
select t.id, v.ref, v.name, v.type, v.city, v.email, v.notes, 'active'
  from t, (values
  ('SUP-0001', 'Gulf Rebar Mills FZE',          'vendor',        'Jebel Ali', 'rebar@gulfrebar.example',      'B500B rebar; monthly mill rate, 30-day validity.'),
  ('SUP-0002', 'Hangzhou Dowel & Fastener Co.', 'vendor',        'Hangzhou',  'export@hzdowel.example',       'Dowel bars (plain, epoxy, SS316), anchor bolts. 6-8 weeks sea freight.'),
  ('SUP-0003', 'Antwerp PTFE Bearing Systems',  'vendor',        'Antwerp',   'sales@antwerp-ptfe.example',   'PTFE sliding and guided bearings; custom units on drawing.'),
  ('SUP-0004', 'Sharjah Safety Supplies',       'vendor',        'Sharjah',   'orders@sharjahsafety.example', 'PPE, EN-certified.'),
  ('SUP-0005', 'Doha Logistics & Clearance',    'subcontractor', 'Doha',      'ops@dohalogistics.example',    'Customs clearance and last-mile to site.')
 ) as v(ref, name, type, city, email, notes)
 where not exists (select 1 from suppliers s where s.tenant_id = t.id and (s.ref = v.ref or s.name = v.name));

-- ── 5. Products (QAR). cost_age_days: 0 = fresh ERP cost, 95 = stale (the
--    cost ladder trusts PRODUCT_COST for 30 days, so that line asks for an
--    RFQ); null cost + cost_sheet = a MADE part priced from the cost model.
with t as (select id from tenants where slug = 'bigblue')
insert into products (tenant_id, ref, name, sku, category, sub_category, uom, description, list_price, cost_price, cost_price_as_of, cost_sheet, qty_breaks, tax_percent, status)
select t.id, v.ref, v.name, v.sku, v.category, v.sub_category, v.uom, v.description, v.list_price, v.cost_price,
       case when v.cost_age_days is null then null else current_date - v.cost_age_days end,
       v.cost_sheet::jsonb, v.qty_breaks::jsonb, 0, 'active'
  from t, (values
  ('PRD-0001', 'Rebar B500B 12 mm',                     'RB-B500B-12',    'REBAR',        'B500B_12MM',       'Ton', 'High-yield deformed bar, B500B, 12 m lengths, mill certificate per heat',                                  2750,  2410,  0,    null, '[{"from":50,"rate":2700},{"from":200,"rate":2650}]'),
  ('PRD-0002', 'Rebar B500B 16 mm',                     'RB-B500B-16',    'REBAR',        'B500B_16MM',       'Ton', 'High-yield deformed bar, B500B, 12 m lengths',                                                             2720,  2395,  0,    null, '[{"from":50,"rate":2680},{"from":200,"rate":2630}]'),
  ('PRD-0003', 'Rebar B500B 20 mm',                     'RB-B500B-20',    'REBAR',        'B500B_20MM',       'Ton', 'High-yield deformed bar, B500B, 12 m lengths',                                                             2700,  2380,  0,    null, null),
  ('PRD-0004', 'Rebar B500B 25 mm',                     'RB-B500B-25',    'REBAR',        'B500B_25MM',       'Ton', 'High-yield deformed bar, B500B, 12 m lengths',                                                             2700,  2380,  0,    null, null),
  ('PRD-0005', 'Rebar B500B 32 mm',                     'RB-B500B-32',    'REBAR',        'B500B_32MM',       'Ton', 'High-yield deformed bar, B500B, 12 m lengths. No negotiated mill rate -- prices from the steel index formula', 2760, 2430, 0, null, null),
  ('PRD-0006', 'Dowel bar 20 x 450 mm plain',           'DB-20-450-PL',   'DOWEL_BARS',   'D20_PLAIN',        'Nos', 'Plain round dowel, S355, sawn ends, one end debonded',                                                     12.5,  9.4,   0,    null, '[{"from":5000,"rate":11.9},{"from":20000,"rate":11.2}]'),
  ('PRD-0007', 'Dowel bar 25 x 500 mm epoxy coated',    'DB-25-500-EP',   'DOWEL_BARS',   'D25_EPOXY',        'Nos', 'Fusion-bonded epoxy coated dowel to ASTM A775, with end caps',                                             42,    31.5,  0,    null, '[{"from":5000,"rate":39.5},{"from":20000,"rate":37}]'),
  ('PRD-0008', 'Dowel bar 20 x 450 mm SS316',           'DB-20-450-SS',   'DOWEL_BARS',   'D20_SS316',        'Nos', 'Stainless steel 316 dowel for marine and chloride exposure',                                               155,   118,   0,    null, null),
  ('PRD-0009', 'Dowel bar 32 x 600 mm epoxy coated',    'DB-32-600-EP',   'DOWEL_BARS',   'D32_EPOXY',        'Nos', 'Epoxy coated dowel, heavy-duty pavement joints. No negotiated rate -- prices from the list-price formula',   78,    58,    0,    null, null),
  ('PRD-0010', 'PTFE sliding bearing 500 kN',           'BR-PTFE-500',    'BEARINGS',     'PTFE',             'Nos', 'Free-sliding PTFE/stainless bearing, 500 kN vertical, EN 1337-2',                                          4850,  3600,  0,    null, null),
  ('PRD-0011', 'PTFE sliding bearing 1000 kN',          'BR-PTFE-1000',   'BEARINGS',     'PTFE',             'Nos', 'Free-sliding PTFE/stainless bearing, 1000 kN vertical, EN 1337-2. ERP cost is 95 days old -- pricing this line asks the supplier for an RFQ', 8900, 6700, 95, null, null),
  ('PRD-0012', 'Elastomeric bearing 300 x 400 x 52 mm', 'BR-ELA-300400',  'BEARINGS',     'ELASTOMERIC',      'Nos', 'Laminated elastomeric bearing, EN 1337-3, steel-reinforced',                                               1250,  880,   0,    null, null),
  ('PRD-0013', 'Custom PTFE guided bearing (engineered)','BR-PTFE-CUSTOM','BEARINGS',     'CUSTOM',           'Nos', 'Guided PTFE bearing built to the consultant''s drawing. MADE part: material + labour from the cost model', 12500, null, null, '[{"path":"material.rate_per_unit","qty":85},{"path":"labour.rate_per_hour","qty":14}]', null),
  ('PRD-0014', 'Anchor bolt M20 x 300 HDG',             'FA-AB-M20-300',  'FASTENERS',    'ANCHOR_BOLTS',     'Nos', 'Hot-dip galvanised L-type anchor bolt, grade 8.8, nut + washer',                                           18.5,  12.8,  0,    null, '[{"from":2000,"rate":17.6}]'),
  ('PRD-0015', 'Chemical anchor 410 ml',                'FA-CA-410',      'FASTENERS',    'CHEMICAL_ANCHORS', 'Nos', 'Vinylester injection anchor, ETA-approved, 410 ml cartridge',                                              68,    47,    0,    null, null),
  ('PRD-0016', 'Safety helmet EN 397 (vented)',         'SG-HLM-EN397',   'SAFETY_GEAR',  'HEAD',             'Nos', 'ABS shell, ratchet harness, vented, EN 397',                                                               28,    17.5,  0,    null, '[{"from":500,"rate":26}]'),
  ('PRD-0017', 'Full-body safety harness EN 361',       'SG-HAR-EN361',   'SAFETY_GEAR',  'FALL',             'Nos', 'Two-point full-body harness with dorsal D-ring, EN 361',                                                   165,   108,   0,    null, null),
  ('PRD-0018', 'Stainless bird spike strip 1 m',        'BC-SPK-1M',      'BIRD_CONTROL', 'SPIKES',           'Mtr', 'SS304 spikes on polycarbonate base, 1 m strip',                                                            24,    15.2,  0,    null, null)
 ) as v(ref, name, sku, category, sub_category, uom, description, list_price, cost_price, cost_age_days, cost_sheet, qty_breaks)
 where not exists (select 1 from products p where p.tenant_id = t.id and (p.ref = v.ref or p.name = v.name));

-- ── 6. Pricing dimensions (tenant-wide matching vocabulary) ─────────────────
with t as (select id from tenants where slug = 'bigblue')
insert into pricing_dimensions (tenant_id, attribute, weight, label)
select t.id, v.attribute, v.weight, v.label
  from t, (values
  ('customer.tier',        30, 'Customer tier'),
  ('region',               20, 'Region'),
  ('document_type',        15, 'Document type'),
  ('product.category',     50, 'Product family'),
  ('product.sub_category', 30, 'Size / spec')
 ) as v(attribute, weight, label)
 on conflict (tenant_id, attribute) do update set weight = excluded.weight, label = excluded.label;

-- ── 7. Price Book "default": Cost-based (landed cost + margin), v1 PUBLISHED ─
-- Row shapes mirror src/lib/pricing/wizard.ts COST_BASED exactly.
do $$
declare
  t uuid := (select id from tenants where slug = 'bigblue');
begin
  if exists (select 1 from pricing_config_versions where tenant_id = t and pricing_area = 'default') then
    raise notice 'default Price Book already has versions -- left untouched';
    return;
  end if;

  insert into pricing_config_versions (tenant_id, pricing_area, version, status, dsl_version, notes, published_at)
  values (t, 'default', 1, 'PUBLISHED', 1, 'Big Blue — Cost-based (landed cost + margin). Seeded 2026-09-07.', now());

  insert into pricing_components (tenant_id, pricing_area, config_version, code, name, class, calc_type, calc_basis, sign, manual_override, is_statistical, resolution_strategy, rounding_rule) values
  (t, 'default', 1, 'PURCHASE_COST',  'Bought-in cost',            'COST_BUILDUP', 'COST_ROLLUP',  'COST_REF',     'POSITIVE', 'FORBIDDEN',           false, 'MOST_SPECIFIC', null),
  (t, 'default', 1, 'MATERIAL_COST',  'Material cost',             'COST_BUILDUP', 'COST_ROLLUP',  'COST_REF',     'POSITIVE', 'FORBIDDEN',           false, 'MOST_SPECIFIC', null),
  (t, 'default', 1, 'LABOUR_COST',    'Labour cost',               'COST_BUILDUP', 'COST_ROLLUP',  'COST_REF',     'POSITIVE', 'FORBIDDEN',           false, 'MOST_SPECIFIC', null),
  (t, 'default', 1, 'SALVAGE_CREDIT', 'Salvage credit',            'COST_BUILDUP', 'COST_ROLLUP',  'COST_REF',     'NEGATIVE', 'FORBIDDEN',           false, 'MOST_SPECIFIC', null),
  (t, 'default', 1, 'FREIGHT',        'Freight',                   'FREIGHT',      'PERCENT',      'SUBTOTAL_REF', 'POSITIVE', 'ALLOWED_WITH_REASON', false, 'MOST_SPECIFIC', null),
  (t, 'default', 1, 'HANDLING',       'Handling',                  'SURCHARGE',    'PERCENT',      'SUBTOTAL_REF', 'POSITIVE', 'ALLOWED_WITH_REASON', false, 'MOST_SPECIFIC', null),
  (t, 'default', 1, 'MARGIN_MARKUP',  'Margin',                    'MARKUP',       'PERCENT',      'SUBTOTAL_REF', 'POSITIVE', 'ALLOWED_WITH_REASON', false, 'MOST_SPECIFIC', null),
  (t, 'default', 1, 'CUST_DISC',      'Customer discount',         'DISCOUNT',     'PERCENT',      'NET_SO_FAR',   'NEGATIVE', 'ALLOWED_WITH_REASON', false, 'MOST_SPECIFIC', null),
  (t, 'default', 1, 'MARGIN_FLOOR',   'Minimum acceptable margin', 'STATISTICAL',  'FIXED_AMOUNT', 'GROSS',        'POSITIVE', 'FORBIDDEN',           true,  'MOST_SPECIFIC', null),
  (t, 'default', 1, 'TAX',            'Tax',                       'TAX',          'PERCENT',      'SUBTOTAL_REF', 'POSITIVE', 'FORBIDDEN',           false, 'MOST_SPECIFIC', '{"precision": 2, "mode": "HALF_UP"}'::jsonb);

  insert into pricing_procedures (tenant_id, pricing_area, config_version, code, name, entry_mode, steps) values
  (t, 'default', 1, 'COST_SIMULATOR', 'Cost-based', 'COST_UP', '[
    {"step": 10,  "component": "PURCHASE_COST",  "cost_model": "STANDARD_COST", "rollup_kind": "PURCHASE"},
    {"step": 20,  "component": "MATERIAL_COST",  "cost_model": "STANDARD_COST", "rollup_kind": "MATERIAL"},
    {"step": 30,  "component": "LABOUR_COST",    "cost_model": "STANDARD_COST", "rollup_kind": "LABOUR"},
    {"step": 40,  "component": "SALVAGE_CREDIT", "cost_model": "STANDARD_COST", "rollup_kind": "SALVAGE_CREDIT"},
    {"step": 50,  "subtotal": "TOTAL_COST"},
    {"step": 60,  "component": "FREIGHT",  "calc_basis_ref": "TOTAL_COST"},
    {"step": 70,  "component": "HANDLING", "calc_basis_ref": "TOTAL_COST"},
    {"step": 80,  "subtotal": "LANDED_COST"},
    {"step": 90,  "component": "MARGIN_MARKUP", "calc_basis_ref": "LANDED_COST"},
    {"step": 100, "subtotal": "NET_1"},
    {"step": 105, "component": "MARGIN_FLOOR", "statistical": true, "guardrail": {"kind": "MARGIN_FLOOR", "cost_subtotal": "LANDED_COST", "revenue_subtotal": "NET_1", "policy": "block"}},
    {"step": 110, "component": "CUST_DISC"},
    {"step": 120, "subtotal": "NET_2"},
    {"step": 130, "component": "TAX", "calc_basis_ref": "NET_2"},
    {"step": 140, "subtotal": "FINAL"}
  ]'::jsonb);

  insert into pricing_cost_models (tenant_id, pricing_area, config_version, code, name, sources) values
  (t, 'default', 1, 'STANDARD_COST', 'Standard cost', '[
    {"code": "PRODUCT_COST", "label": "ERP cost price on the product",       "tier": 1, "quality": "actual",    "max_age_days": 30,  "requirement": null},
    {"code": "RFQ",          "label": "Supplier RFQ reply",                  "tier": 2, "quality": "confirmed", "max_age_days": 180, "requirement": null},
    {"code": "PRICE_LIST",   "label": "Imported cost price list",            "tier": 3, "quality": "list",      "max_age_days": 365, "requirement": null},
    {"code": "MANUAL",       "label": "Rate kept by hand in the cost model", "tier": 4, "quality": "estimate",  "max_age_days": null, "requirement": null}
  ]'::jsonb);

  insert into pricing_cost_inputs (tenant_id, cost_model_code, path, kind, value, uom, currency, source, source_code, quality, as_of)
  select t, 'STANDARD_COST', v.path, v.kind, v.value, v.uom, 'QAR', 'MANUAL', 'MANUAL', 'estimate', current_date
    from (values
      ('material.rate_per_unit',  'MATERIAL',       62, 'Kg'),
      ('labour.rate_per_hour',    'LABOUR',         95, 'Hr'),
      ('salvage.credit_per_unit', 'SALVAGE_CREDIT',  0, 'Kg')
    ) as v(path, kind, value, uom)
   where not exists (select 1 from pricing_cost_inputs i where i.tenant_id = t and i.cost_model_code = 'STANDARD_COST' and i.path = v.path and i.product_id is null);

  insert into pricing_rules (tenant_id, pricing_area, config_version, component_code, match_attributes, value, formula, uom, currency, origin) values
  (t, 'default', 1, 'FREIGHT',       '{}'::jsonb,                             3,    null, null, 'QAR', 'MANUAL'),
  (t, 'default', 1, 'FREIGHT',       '{"region": "Ras Laffan"}'::jsonb,       6,    null, null, 'QAR', 'MANUAL'),
  (t, 'default', 1, 'FREIGHT',       '{"region": "Al Wakrah"}'::jsonb,        4,    null, null, 'QAR', 'MANUAL'),
  (t, 'default', 1, 'HANDLING',      '{}'::jsonb,                             1.5,  null, null, 'QAR', 'MANUAL'),
  (t, 'default', 1, 'MARGIN_MARKUP', '{}'::jsonb,                             22,   null, null, 'QAR', 'MANUAL'),
  (t, 'default', 1, 'MARGIN_MARKUP', '{"customer.tier": "direct"}'::jsonb,    18,   null, null, 'QAR', 'MANUAL'),
  (t, 'default', 1, 'MARGIN_MARKUP', '{"customer.tier": "prospect"}'::jsonb,  25,   null, null, 'QAR', 'MANUAL'),
  (t, 'default', 1, 'CUST_DISC',     '{}'::jsonb,                             0,    null, null, 'QAR', 'MANUAL'),
  (t, 'default', 1, 'MARGIN_FLOOR',  '{}'::jsonb,                             12,   null, null, 'QAR', 'MANUAL'),
  (t, 'default', 1, 'TAX',           '{}'::jsonb,                             0,    null, null, 'QAR', 'MANUAL');
end $$;

-- ── 8. Price Book "steel_catalog": Catalog + Formula for REBAR and DOWEL_BARS ─
-- A negotiated mill rate per spec (a flat rate on a FORMULA component is
-- "<rate> * ctx.line.quantity", the wizard's flatRateFormula); a family-level
-- fallback formula for every other spec. Most-specific-wins picks the spec row
-- whenever one exists.
do $$
declare
  t uuid := (select id from tenants where slug = 'bigblue');
begin
  if exists (select 1 from pricing_config_versions where tenant_id = t and pricing_area = 'steel_catalog') then
    raise notice 'steel_catalog Price Book already has versions -- left untouched';
    return;
  end if;

  insert into pricing_config_versions (tenant_id, pricing_area, version, status, dsl_version, notes, published_at)
  values (t, 'steel_catalog', 1, 'PUBLISHED', 1, 'Big Blue — Catalog + Formula for rebar and dowel bars. Seeded 2026-09-07.', now());

  insert into pricing_components (tenant_id, pricing_area, config_version, code, name, class, calc_type, calc_basis, sign, manual_override, is_statistical, resolution_strategy, rounding_rule) values
  (t, 'steel_catalog', 1, 'MATERIAL_RATE', 'Rate per unit',             'PRICE',       'FORMULA',      'CUSTOM_METRIC', 'POSITIVE', 'ALLOWED_WITH_REASON', false, 'MOST_SPECIFIC', null),
  (t, 'steel_catalog', 1, 'FREIGHT',       'Freight',                   'FREIGHT',     'FIXED_AMOUNT', 'NET_SO_FAR',    'POSITIVE', 'ALLOWED_WITH_REASON', false, 'MOST_SPECIFIC', null),
  (t, 'steel_catalog', 1, 'MARGIN_MARKUP', 'Margin',                    'MARKUP',      'PERCENT',      'SUBTOTAL_REF',  'POSITIVE', 'ALLOWED_WITH_REASON', false, 'MOST_SPECIFIC', null),
  (t, 'steel_catalog', 1, 'MARGIN_FLOOR',  'Minimum acceptable margin', 'STATISTICAL', 'FIXED_AMOUNT', 'GROSS',         'POSITIVE', 'FORBIDDEN',           true,  'MOST_SPECIFIC', null),
  (t, 'steel_catalog', 1, 'CUST_DISC',     'Customer discount',         'DISCOUNT',    'PERCENT',      'NET_SO_FAR',    'NEGATIVE', 'ALLOWED_WITH_REASON', false, 'MOST_SPECIFIC', null),
  (t, 'steel_catalog', 1, 'TAX',           'Tax',                       'TAX',         'PERCENT',      'SUBTOTAL_REF',  'POSITIVE', 'FORBIDDEN',           false, 'MOST_SPECIFIC', '{"precision": 2, "mode": "HALF_UP"}'::jsonb);

  insert into pricing_procedures (tenant_id, pricing_area, config_version, code, name, entry_mode, steps) values
  (t, 'steel_catalog', 1, 'CATALOG_FORMULA', 'Catalog + Formula', 'LIST_DOWN', '[
    {"step": 10,  "component": "MATERIAL_RATE", "required": true},
    {"step": 20,  "subtotal": "TOTAL_COST"},
    {"step": 30,  "component": "FREIGHT"},
    {"step": 40,  "subtotal": "LANDED_COST"},
    {"step": 50,  "component": "MARGIN_MARKUP", "calc_basis_ref": "LANDED_COST"},
    {"step": 60,  "subtotal": "NET_1"},
    {"step": 65,  "component": "MARGIN_FLOOR", "statistical": true, "guardrail": {"kind": "MARGIN_FLOOR", "cost_subtotal": "LANDED_COST", "revenue_subtotal": "NET_1", "policy": "block"}},
    {"step": 70,  "component": "CUST_DISC"},
    {"step": 80,  "subtotal": "NET_2"},
    {"step": 90,  "component": "TAX", "calc_basis_ref": "NET_2"},
    {"step": 100, "subtotal": "FINAL"}
  ]'::jsonb);

  insert into pricing_cost_models (tenant_id, pricing_area, config_version, code, name, sources) values
  (t, 'steel_catalog', 1, 'CATALOG_FALLBACK_COST', 'Fallback cost inputs', '[]'::jsonb);

  -- Steel index (QAR per tonne) for un-negotiated rebar sizes; estimated mill
  -- cost as a share of list price for un-negotiated dowel specs.
  insert into pricing_cost_inputs (tenant_id, cost_model_code, path, kind, value, uom, currency, source, source_code, quality, as_of)
  select t, 'CATALOG_FALLBACK_COST', v.path, v.kind, v.value, v.uom, v.currency, 'MANUAL', 'MANUAL', 'estimate', current_date
    from (values
      ('material.rate_per_unit',   'MATERIAL', 2350, 'Ton', 'QAR'),
      ('dowel.cost_ratio_of_list', 'INDEX',    0.82, null,  null)
    ) as v(path, kind, value, uom, currency)
   where not exists (select 1 from pricing_cost_inputs i where i.tenant_id = t and i.cost_model_code = 'CATALOG_FALLBACK_COST' and i.path = v.path and i.product_id is null);

  insert into pricing_rules (tenant_id, pricing_area, config_version, component_code, match_attributes, value, formula, uom, currency, origin) values
  (t, 'steel_catalog', 1, 'MATERIAL_RATE', '{"product.category": "REBAR", "product.sub_category": "B500B_12MM"}'::jsonb,     null, '2410 * ctx.line.quantity',  'Ton', 'QAR', 'MANUAL'),
  (t, 'steel_catalog', 1, 'MATERIAL_RATE', '{"product.category": "REBAR", "product.sub_category": "B500B_16MM"}'::jsonb,     null, '2395 * ctx.line.quantity',  'Ton', 'QAR', 'MANUAL'),
  (t, 'steel_catalog', 1, 'MATERIAL_RATE', '{"product.category": "REBAR", "product.sub_category": "B500B_20MM"}'::jsonb,     null, '2380 * ctx.line.quantity',  'Ton', 'QAR', 'MANUAL'),
  (t, 'steel_catalog', 1, 'MATERIAL_RATE', '{"product.category": "REBAR", "product.sub_category": "B500B_25MM"}'::jsonb,     null, '2380 * ctx.line.quantity',  'Ton', 'QAR', 'MANUAL'),
  (t, 'steel_catalog', 1, 'MATERIAL_RATE', '{"product.category": "DOWEL_BARS", "product.sub_category": "D20_PLAIN"}'::jsonb, null, '9.40 * ctx.line.quantity',  'Nos', 'QAR', 'MANUAL'),
  (t, 'steel_catalog', 1, 'MATERIAL_RATE', '{"product.category": "DOWEL_BARS", "product.sub_category": "D25_EPOXY"}'::jsonb, null, '31.50 * ctx.line.quantity', 'Nos', 'QAR', 'MANUAL'),
  (t, 'steel_catalog', 1, 'MATERIAL_RATE', '{"product.category": "DOWEL_BARS", "product.sub_category": "D20_SS316"}'::jsonb, null, '118 * ctx.line.quantity',   'Nos', 'QAR', 'MANUAL'),
  (t, 'steel_catalog', 1, 'MATERIAL_RATE', '{"product.category": "REBAR"}'::jsonb,      null, 'ctx.cost.material.rate_per_unit * ctx.line.quantity',                                     null, 'QAR', 'MANUAL'),
  (t, 'steel_catalog', 1, 'MATERIAL_RATE', '{"product.category": "DOWEL_BARS"}'::jsonb, null, 'ctx.line.product.list_price * ctx.cost.dowel.cost_ratio_of_list * ctx.line.quantity', null, 'QAR', 'MANUAL'),
  (t, 'steel_catalog', 1, 'FREIGHT',       '{}'::jsonb,                           350,  null, null, 'QAR', 'MANUAL'),
  (t, 'steel_catalog', 1, 'FREIGHT',       '{"region": "Ras Laffan"}'::jsonb,     1200, null, null, 'QAR', 'MANUAL'),
  (t, 'steel_catalog', 1, 'MARGIN_MARKUP', '{}'::jsonb,                           14,   null, null, 'QAR', 'MANUAL'),
  (t, 'steel_catalog', 1, 'MARGIN_MARKUP', '{"customer.tier": "direct"}'::jsonb,  11,   null, null, 'QAR', 'MANUAL'),
  (t, 'steel_catalog', 1, 'MARGIN_FLOOR',  '{}'::jsonb,                           8,    null, null, 'QAR', 'MANUAL'),
  (t, 'steel_catalog', 1, 'CUST_DISC',     '{}'::jsonb,                           0,    null, null, 'QAR', 'MANUAL'),
  (t, 'steel_catalog', 1, 'CUST_DISC',     '{"customer.tier": "direct"}'::jsonb,  1.5,  null, null, 'QAR', 'MANUAL'),
  (t, 'steel_catalog', 1, 'TAX',           '{}'::jsonb,                           0,    null, null, 'QAR', 'MANUAL');
end $$;

-- ── 9. Deals (needs 0120; skipped cleanly if the table is missing) ──────────
do $$
declare
  t uuid := (select id from tenants where slug = 'bigblue');
begin
  if to_regclass('public.opportunities') is null then
    raise notice 'opportunities table missing (0120 pending) -- deals skipped';
    return;
  end if;

  insert into opportunities (tenant_id, ref, account_id, contact_id, title, description, stage, outcome, loss_reason, expected_close, amount, currency, probability, source, competitor, team, created_at, updated_at, closed_at)
  select t, v.ref, a.id, c.id, v.title, v.description, v.stage, v.outcome, v.loss_reason,
         current_date + v.close_days, v.amount, 'QAR', v.probability, v.source, v.competitor, '[]'::jsonb,
         now() - (v.age_days || ' days')::interval, now() - (least(v.age_days, 2) || ' days')::interval,
         case when v.outcome = 'open' then null else (current_date + v.close_days)::timestamptz + interval '10 hours' end
    from (values
      ('OPP-0001', 'ACC-0001', 'CON-0001', 'North Field East — Package 3 rebar & dowels', 'BOQ for the LNG train foundations: B500B rebar by the tonne plus epoxy dowels for the pavement joints.', 'negotiate', 'open', null,    21,  810200,  75,  'direct',   'Local stockist', 34),
      ('OPP-0002', 'ACC-0002', 'CON-0003', 'Al Khor Expressway — bridge bearings (P2)',   'Bearings for two interchanges; consultant wants PTFE on the mainline, elastomeric on the ramps.',    'propose',   'open', null,    45,  390500,  50,  'referral', null,             18),
      ('OPP-0003', 'ACC-0003', 'CON-0005', 'Lusail Tower 3 — anchors & fasteners',       'Anchor bolts and chemical anchors for the podium steelwork, plus site PPE.',                        'won',       'won',  null,    -6,  93960,   100, 'direct',   null,             60),
      ('OPP-0004', 'ACC-0006', 'CON-0008', 'Site PPE annual supply',                      'Helmets, harnesses and bird spikes for the yard. Lost on price to a Sharjah trader.',                'lost',      'lost', 'price', -12, 26150,   0,   'lead',     'Sharjah trader', 50),
      ('OPP-0005', 'ACC-0008', 'CON-0010', 'Metro Package 4 — dowel bars, 6 stations',   'Tender expected Q4. Volume pricing on 25 mm epoxy dowels; SS316 for the two coastal stations.',      'qualify',   'open', null,    90,  1240000, 20,  'direct',   null,             5),
      ('OPP-0006', 'ACC-0005', 'CON-0007', 'Ras Laffan tank farm — SS dowels',           'SS316 dowels for the containment slab joints; heavy-duty epoxy dowels for the access road.',        'propose',   'open', null,    30,  187600,  50,  'direct',   null,             12)
    ) as v(ref, account_ref, contact_ref, title, description, stage, outcome, loss_reason, close_days, amount, probability, source, competitor, age_days)
    join accounts a on a.tenant_id = t and a.ref = v.account_ref
    left join contacts c on c.tenant_id = t and c.ref = v.contact_ref
   where not exists (select 1 from opportunities o where o.tenant_id = t and (o.ref = v.ref or o.title = v.title));
end $$;

-- ── 10. Standard Quotes ─────────────────────────────────────────────────────
-- Break rows (break_of) are printed offers, never charged; an unchosen
-- alternative group does not count -- src/lib/sales/lineTotals.ts. Totals
-- below are the charged lines only, plus shipping (VAT 0).
create or replace function pg_temp.bigblue_quote(
  p_ref text, p_account text, p_contact text, p_deal text, p_status text,
  p_age int, p_sent_age int, p_closed_age int, p_valid_days int, p_inquiry_age int,
  p_intro text, p_terms text, p_shipping numeric, p_subtotal numeric
) returns uuid language plpgsql as $$
declare
  t uuid := (select id from tenants where slug = 'bigblue');
  q uuid;
begin
  select id into q from standard_quotes where tenant_id = t and ref = p_ref;
  if q is not null then return null; end if;

  insert into standard_quotes (tenant_id, ref, account_id, contact_id, status, valid_until, inquiry_date, intro_text, terms,
                               header_discount_pct, tax_pct, shipping_amount, subtotal, total, created_at, updated_at, sent_at, closed_at)
  select t, p_ref, a.id, c.id, p_status, current_date + p_valid_days, current_date - p_inquiry_age, p_intro, p_terms,
         0, 0, p_shipping, p_subtotal, p_subtotal + p_shipping,
         now() - (p_age || ' days')::interval, now() - (least(p_age, 1) || ' days')::interval,
         case when p_sent_age is null then null else now() - (p_sent_age || ' days')::interval end,
         case when p_closed_age is null then null else now() - (p_closed_age || ' days')::interval end
    from accounts a
    left join contacts c on c.tenant_id = t and c.ref = p_contact
   where a.tenant_id = t and a.ref = p_account
  returning id into q;

  if to_regclass('public.opportunities') is not null and p_deal is not null then
    update standard_quotes s
       set opportunity_id = o.id
      from opportunities o
     where s.id = q and o.tenant_id = t and o.ref = p_deal;
  end if;
  return q;
end $$;

create or replace function pg_temp.bigblue_line(
  p_quote uuid, p_sl int, p_product text, p_description text, p_uom text, p_qty numeric, p_rate numeric,
  p_group_id text default null, p_group_label text default null, p_chosen boolean default true
) returns uuid language plpgsql as $$
declare
  t uuid := (select id from tenants where slug = 'bigblue');
  l uuid;
begin
  if p_quote is null then return null; end if;
  insert into standard_quote_lines (tenant_id, standard_quote_id, sl_no, description, uom, qty, rate, discount_pct, amount, product_id,
                                    group_id, group_label, group_type, is_selected, show_on_pdf)
  select t, p_quote, p_sl::text, p_description, p_uom, p_qty, p_rate, 0, p_qty * p_rate, p.id,
         p_group_id, p_group_label, case when p_group_id is null then null else 'alternative' end, p_chosen, true
    from products p where p.tenant_id = t and p.ref = p_product
  returning id into l;
  return l;
end $$;

create or replace function pg_temp.bigblue_break(p_line uuid, p_qty numeric, p_rate numeric) returns void language plpgsql as $$
declare
  t uuid := (select id from tenants where slug = 'bigblue');
begin
  if p_line is null then return; end if;
  insert into standard_quote_lines (tenant_id, standard_quote_id, sl_no, description, uom, qty, rate, discount_pct, amount, product_id,
                                    break_of, break_qty, is_selected, show_on_pdf)
  select t, l.standard_quote_id, null, l.description, l.uom, p_qty, p_rate, 0, p_qty * p_rate, l.product_id,
         l.id::text, p_qty, true, true
    from standard_quote_lines l where l.id = p_line;
end $$;

do $$
declare q uuid; l uuid;
begin
  -- SQ-2026-0001: sent, North Field East (deal OPP-0001). 810,200 + 1,800.
  q := pg_temp.bigblue_quote('SQ-2026-0001', 'ACC-0001', 'CON-0001', 'OPP-0001', 'sent', 25, 20, null, 10, 28,
        'Further to your BOQ for North Field East Package 3, we are pleased to quote as follows. Rebar is offered ex-mill Jebel Ali with test certificates per heat; dowels include end caps.',
        'Delivery 3-4 weeks from PO for rebar, 6-8 weeks for dowels. Payment 30 days. Prices valid for 10 days (steel index).',
        1800, 810200);
  perform pg_temp.bigblue_line(q, 1, 'PRD-0002', 'Rebar B500B 16 mm, 12 m lengths, mill certificates per heat', 'Ton', 120,  2690);
  perform pg_temp.bigblue_line(q, 2, 'PRD-0004', 'Rebar B500B 25 mm, 12 m lengths',                            'Ton', 80,   2680);
  l := pg_temp.bigblue_line(q, 3, 'PRD-0007', 'Dowel bar 25 x 500 mm epoxy coated with end caps',              'Nos', 6000, 41);
  perform pg_temp.bigblue_break(l, 10000, 39.5);
  perform pg_temp.bigblue_break(l, 20000, 37);
  perform pg_temp.bigblue_line(q, 4, 'PRD-0014', 'Anchor bolt M20 x 300 HDG c/w nut and washer',               'Nos', 1500, 18);

  -- SQ-2026-0002: draft, Al Khor Expressway bearings (OPP-0002), with an
  -- alternative option group for the joint dowels. 390,500 + 2,500.
  q := pg_temp.bigblue_quote('SQ-2026-0002', 'ACC-0002', 'CON-0003', 'OPP-0002', 'draft', 10, null, null, 30, 14,
        'Bearings for the Al Khor Expressway interchanges P2, per the consultant''s bearing schedule rev. C. Dowels for the expansion joints are offered as two options.',
        'Delivery 10-12 weeks ex-works Antwerp. Payment 30 % with order, balance against shipping documents.',
        2500, 390500);
  perform pg_temp.bigblue_line(q, 1, 'PRD-0010', 'PTFE sliding bearing 500 kN, EN 1337-2, free-sliding',  'Nos', 24,   4750);
  perform pg_temp.bigblue_line(q, 2, 'PRD-0011', 'PTFE sliding bearing 1000 kN, EN 1337-2, free-sliding', 'Nos', 12,   8700);
  perform pg_temp.bigblue_line(q, 3, 'PRD-0012', 'Elastomeric bearing 300 x 400 x 52 mm, EN 1337-3',      'Nos', 40,   1190);
  perform pg_temp.bigblue_line(q, 4, 'PRD-0007', 'Dowel bar 25 x 500 mm epoxy coated (expansion joints)', 'Nos', 3000, 41.5, 'opt-epoxy', 'Option A — epoxy coated dowels', true);
  perform pg_temp.bigblue_line(q, 5, 'PRD-0008', 'Dowel bar 20 x 450 mm SS316 (expansion joints)',        'Nos', 3000, 152,  'opt-ss316', 'Option B — SS316 dowels',        false);

  -- SQ-2026-0003: accepted, Lusail Tower 3 (OPP-0003). 93,960 + 340.
  q := pg_temp.bigblue_quote('SQ-2026-0003', 'ACC-0003', 'CON-0005', 'OPP-0003', 'accepted', 45, 40, 6, -20, 48,
        'Anchors and fasteners for the Lusail Tower 3 podium steelwork, with site PPE as requested.',
        'Ex-stock Doha. Payment 30 days.',
        340, 93960);
  perform pg_temp.bigblue_line(q, 1, 'PRD-0014', 'Anchor bolt M20 x 300 HDG c/w nut and washer', 'Nos', 3200, 17.8);
  perform pg_temp.bigblue_line(q, 2, 'PRD-0015', 'Chemical anchor 410 ml, vinylester',            'Nos', 480,  64);
  perform pg_temp.bigblue_line(q, 3, 'PRD-0016', 'Safety helmet EN 397, vented, white',           'Nos', 120,  26.5);
  perform pg_temp.bigblue_line(q, 4, 'PRD-0017', 'Full-body safety harness EN 361',               'Nos', 20,   155);

  -- SQ-2026-0004: rejected, Wakrah Marine PPE (OPP-0004, lost on price). 26,150.
  q := pg_temp.bigblue_quote('SQ-2026-0004', 'ACC-0006', 'CON-0008', 'OPP-0004', 'rejected', 40, 38, 12, -15, 42,
        'PPE and bird control for the Al Wakrah yard, as discussed.',
        'Ex-stock Doha. Payment 30 days.',
        0, 26150);
  perform pg_temp.bigblue_line(q, 1, 'PRD-0016', 'Safety helmet EN 397, vented, white', 'Nos', 400, 27);
  perform pg_temp.bigblue_line(q, 2, 'PRD-0017', 'Full-body safety harness EN 361',     'Nos', 60,  160);
  perform pg_temp.bigblue_line(q, 3, 'PRD-0018', 'Stainless bird spike strip 1 m',      'Mtr', 250, 23);

  -- SQ-2026-0005: draft, Ras Laffan SS dowels (OPP-0006). 187,600.
  q := pg_temp.bigblue_quote('SQ-2026-0005', 'ACC-0005', 'CON-0007', 'OPP-0006', 'draft', 3, null, null, 14, 5,
        'SS316 dowels for the containment slab joints and heavy-duty epoxy dowels for the access road, per your enquiry.',
        'Delivery to Ras Laffan gate; gate passes by the customer. Payment 30 days.',
        0, 187600);
  perform pg_temp.bigblue_line(q, 1, 'PRD-0008', 'Dowel bar 20 x 450 mm SS316, marine grade',                     'Nos', 1200, 150);
  perform pg_temp.bigblue_line(q, 2, 'PRD-0009', 'Dowel bar 32 x 600 mm epoxy coated, heavy-duty pavement joints', 'Nos', 100,  76);
end $$;

-- ── 11. Check ───────────────────────────────────────────────────────────────
with t as (select id from tenants where slug = 'bigblue')
select 'accounts' as tbl, count(*) from accounts, t where tenant_id = t.id
union all select 'contacts',             count(*) from contacts, t             where tenant_id = t.id
union all select 'suppliers',            count(*) from suppliers, t            where tenant_id = t.id
union all select 'products',             count(*) from products, t             where tenant_id = t.id
union all select 'pricing_config_versions', count(*) from pricing_config_versions, t where tenant_id = t.id
union all select 'pricing_rules',        count(*) from pricing_rules, t        where tenant_id = t.id
union all select 'standard_quotes',      count(*) from standard_quotes, t      where tenant_id = t.id
union all select 'standard_quote_lines', count(*) from standard_quote_lines, t where tenant_id = t.id
order by 1;
-- Expected: accounts 8, contacts 10, suppliers 5, products 18, versions 2,
-- rules 27, standard_quotes 5, lines 20 (+ opportunities 6 when 0120 is in).
