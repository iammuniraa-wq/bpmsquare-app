-- KAMCO test data -- run on the KAMCO Supabase project ONLY (the dedicated one), by hand, in the SQL editor.
--
-- Small but complete set of records to click through the whole GCC tender flow (docs/design/gcc-tender-deals.md): accounts, contacts,
-- suppliers, a product catalogue with cost prices, and three tender deals at three different points of the flow. Every record the
-- script creates has a name / title / description that starts with 'TEST ', so scripts/seed-kamco-test-data-cleanup.sql can find
-- exactly these rows later. System refs (ACC-0001, OPP-0001, ...) are made the way the app makes them: the next free number for the
-- workspace.
--
-- Needs: migrations up to 0229 (0220-0229 are the tender tables). Missing OPTIONAL tables (BOQ 0223, RFQ 0128, estimates 0131/0227,
-- bid versions 0225, competitors 0229, deal activities 0225) are skipped with a NOTICE and the rest still runs; run the script again
-- after applying them and only the missing parts are added. The workspace is found by its slug: 'kamco'. If it is not found, or it is
-- flagged as a demo workspace, the script stops before writing anything.
--
-- Idempotent: a record whose TEST name already exists for the workspace is not created again, so running twice adds nothing.
-- Does NOT create users, passwords or auth rows (it does add one employee record, see below). Accounts and contacts carry no e-mail or phone (those columns are encrypted by the
-- app and stay empty). Deal owners are left empty on purpose, so the closing-date reminders do not e-mail anybody.
--
-- What it makes (counts):
--   1 employee (TEST Abdul Khader, abdulkhader@saytara.info), 5 accounts, 3 contacts, 5 suppliers, 10 products (with cost price and list price), 5 stocked inventory items,
--   3 tender deals (6 + 12 + 6 deal lines), 1 uploaded BOQ with 12 BOQ lines, 1 estimate (3 lines) attached to deal 2,
--   1 RFQ (4 lines, 2 suppliers, both replied at different prices, nothing awarded yet), 1 saved bid version,
--   2 competitors, 1 bid guarantee (issued) and 2 logged calls on deal 3.
--   For the Tender desk home screen (docs/design/tender-desk.md): 13 more open tenders (16 open in all, SAR 3 to 19 million, five clients,
--   across Received, Bid/No-bid, Estimating, Submitted and Clarifications, bid end dates 2 to 26 days out and a few already past) and
--   8 decided ones over the last 12 months (4 won, 3 lost, 1 dropped), one bid / no-bid proposal waiting for approval, one bid guarantee
--   expiring in 9 days, one RFQ whose reply date has passed with two suppliers silent, and one contract project from a won tender with
--   4 buy-out packages (2 awarded, 1 with two quotes in, 1 waiting). Deal owners stay empty.
--
-- Not made (cannot be made from SQL): the Excel file itself. The BOQ source row exists with its sheet, header row and column map, but
-- nothing is stored in the private bucket tender-boq-files, so "download the client's file" and "write the priced Excel" will say the
-- file is missing; upload a real BOQ on a fourth test deal for that.

-- =====================================================================================================================================
-- BLOCK 1 of 2 -- FEATURE FLAGS. Delete this block if you set the flags yourself in /admin/tenants. Merges into tenants.features
-- (existing keys are kept); only keys that exist in TenantFeatures (src/lib/constants.ts).
-- =====================================================================================================================================
do $flags$
declare
  t uuid;
  v_demo boolean;
begin
  select id, coalesce(is_demo, false) into t, v_demo from tenants where slug = 'kamco';
  if t is null then
    raise exception 'No workspace with slug kamco was found. Nothing was changed. Check the slug in the tenants table.';
  end if;
  if v_demo then
    raise exception 'The workspace kamco is flagged as a demo workspace. This script is for the real KAMCO workspace only. Nothing was changed.';
  end if;

  update tenants
  set features = coalesce(features, '{}'::jsonb) || '{
    "accounts": true,
    "contacts": true,
    "suppliers": true,
    "products": true,
    "purchasing": true,
    "pipeline": true,
    "gcc_tender": true,
    "deal_room": true,
    "contract_projects": true,
    "rfq": true,
    "estimator": true,
    "inbox": true
  }'::jsonb
  where id = t;
  raise notice 'Feature flags switched on for kamco.';
end $flags$;

-- =====================================================================================================================================
-- BLOCK 2 of 2 -- THE RECORDS.
-- =====================================================================================================================================

-- Helpers that live only for this session (pg_temp).
create or replace function pg_temp.kamco_next(p_table text, p_tenant uuid, p_prefix text) returns int
language plpgsql as $f$
declare
  n int;
begin
  execute format('select coalesce(max(substring(ref from %L)::int), 0) + 1 from %I where tenant_id = $1 and ref ~ %L',
                 '^' || p_prefix || '-(\d+)$', p_table, '^' || p_prefix || '-\d+$')
    into n using p_tenant;
  return n;
end $f$;

create or replace function pg_temp.kamco_ref(p_table text, p_tenant uuid, p_prefix text) returns text
language plpgsql as $f$
begin
  return p_prefix || '-' || lpad(pg_temp.kamco_next(p_table, p_tenant, p_prefix)::text, 4, '0');
end $f$;

do $seed$
declare
  t uuid;
  v_demo boolean;
  v_cur text;
  r record;
  v_id uuid;
  v_n int;
  v_has_col boolean;
  v_dt uuid;
  v_new3 boolean := false;

  acc_mpw uuid;
  acc_mra uuid;
  acc_nwc uuid;
  con_mpw uuid;
  con_mra uuid;
  sup_gp uuid;
  sup_pa uuid;
  emp_id uuid;
  emp_seq int;

  opp1 uuid;
  opp2 uuid;
  opp3 uuid;
  opp2_ref text;
  src_id uuid;
  est_id uuid;
  rfq_id_v uuid;
  rfq_line_v uuid;
  rs_v uuid;
  v_src uuid;
  v_proj uuid;
  v_proj_name text := 'TEST Project - Coastal road drainage, awarded';
  v_rev uuid;
  v_pkg uuid;
  v_rfq_late uuid;
  v_rfq_pkg uuid;

  c_opp1 constant text := 'TEST Tender 2026/014 - Storm water network, Phase 1';
  c_opp2 constant text := 'TEST Tender 2026/021 - Pipeline and culverts, Package B';
  c_opp3 constant text := 'TEST Tender 2026/009 - Water main replacement, Zone 4';
  c_rfq  constant text := 'TEST RFQ - Package B unpriced items';
  c_est  constant text := 'TEST Culvert headwall estimate';
begin
  select id, coalesce(is_demo, false), config->>'currency' into t, v_demo, v_cur from tenants where slug = 'kamco';
  if t is null then
    raise exception 'No workspace with slug kamco was found. Nothing was created.';
  end if;
  if v_demo then
    raise exception 'The workspace kamco is flagged as a demo workspace. Nothing was created.';
  end if;
  if to_regclass('public.opportunity_tenders') is null then
    raise exception 'Run migration 0220 (bundle 31, the tender deals) first: public.opportunity_tenders does not exist.';
  end if;
  if to_regclass('public.opportunity_lines') is null then
    raise exception 'Run migration 0120 (opportunities) first.';
  end if;

  -- The workspace's 'tender' deal type, if the app has already made it (the app makes it on the first tender; this script does not).
  select id into v_dt from deal_types where tenant_id = t and code = 'tender';

  -- ---- Accounts (customers) -------------------------------------------------------------------------------------------------------
  for r in select * from (values
    ('TEST Ministry of Public Works', 'direct'),
    ('TEST Municipality Roads Authority', 'direct'),
    ('TEST National Water Company', 'prospect'),
    ('TEST Coastal Developments LLC', 'end_customer'),
    ('TEST Eastern Utilities Authority', 'direct')
  ) as v(nm, ty) loop
    if not exists (select 1 from accounts a where a.tenant_id = t and a.name = r.nm) then
      insert into accounts (tenant_id, ref, name, type)
      values (t, pg_temp.kamco_ref('accounts', t, 'ACC'), r.nm, r.ty);
    end if;
  end loop;
  select id into acc_mpw from accounts where tenant_id = t and name = 'TEST Ministry of Public Works';
  select id into acc_mra from accounts where tenant_id = t and name = 'TEST Municipality Roads Authority';
  select id into acc_nwc from accounts where tenant_id = t and name = 'TEST National Water Company';

  -- ---- Contacts (no e-mail, no phone) ---------------------------------------------------------------------------------------------
  for r in select * from (values
    ('TEST Procurement Officer, Ministry', 'Procurement', 'TEST Ministry of Public Works'),
    ('TEST Project Engineer, Roads Authority', 'Project engineer', 'TEST Municipality Roads Authority'),
    ('TEST Tender Secretary, Water Company', 'Tender secretary', 'TEST National Water Company')
  ) as v(nm, rl, acc) loop
    if not exists (select 1 from contacts c where c.tenant_id = t and c.name = r.nm) then
      insert into contacts (tenant_id, ref, account_id, name, role)
      values (t, pg_temp.kamco_ref('contacts', t, 'CON'),
              (select a.id from accounts a where a.tenant_id = t and a.name = r.acc), r.nm, r.rl);
    end if;
  end loop;
  select id into con_mpw from contacts where tenant_id = t and name = 'TEST Procurement Officer, Ministry';
  select id into con_mra from contacts where tenant_id = t and name = 'TEST Project Engineer, Roads Authority';

  -- ---- Suppliers ------------------------------------------------------------------------------------------------------------------
  for r in select * from (values
    ('TEST Gulf Pipes LLC', 'vendor'),
    ('TEST Precast Arabia', 'vendor'),
    ('TEST Al Noor Steel', 'vendor'),
    ('TEST Desert Aggregates', 'vendor'),
    ('TEST Pump and Valve Trading', 'vendor')
  ) as v(nm, ty) loop
    if not exists (select 1 from suppliers s where s.tenant_id = t and s.name = r.nm) then
      insert into suppliers (tenant_id, ref, name, type, status)
      values (t, pg_temp.kamco_ref('suppliers', t, 'SUP'), r.nm, r.ty, 'active');
    end if;
  end loop;
  select id into sup_gp from suppliers where tenant_id = t and name = 'TEST Gulf Pipes LLC';
  select id into sup_pa from suppliers where tenant_id = t and name = 'TEST Precast Arabia';

  -- ---- Products (the catalogue the tender lines are priced from) --------------------------------------------------------------------
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'supplier_id') into v_has_col;
  for r in select * from (values
    ('TEST 600mm HDPE pipe',                  'TEST-HDPE-600', 'Pipes',    'm',   150.00,  118.00, 'TEST Gulf Pipes LLC'),
    ('TEST 300mm HDPE pipe',                  'TEST-HDPE-300', 'Pipes',    'm',    62.00,   46.00, 'TEST Gulf Pipes LLC'),
    ('TEST 900mm RCP pipe',                   'TEST-RCP-900',  'Pipes',    'm',   395.00,  310.00, 'TEST Precast Arabia'),
    ('TEST Precast box culvert 2.0x2.0m',     'TEST-BXC-2020', 'Precast',  'nos', 2400.00, 1850.00, 'TEST Precast Arabia'),
    ('TEST Precast manhole ring 1200mm',      'TEST-MHR-1200', 'Precast',  'nos',  560.00,  420.00, 'TEST Precast Arabia'),
    ('TEST Manhole cover and frame D400',     'TEST-MHC-D400', 'Civil',    'nos',  340.00,  260.00, 'TEST Al Noor Steel'),
    ('TEST Rebar 16mm B500',                  'TEST-REB-16',   'Steel',    'tons', 3200.00, 2650.00, 'TEST Al Noor Steel'),
    ('TEST Ready-mix concrete C40',           'TEST-RMC-C40',  'Concrete', 'm3',   360.00,  285.00, 'TEST Desert Aggregates'),
    ('TEST Granular backfill, compacted',     'TEST-GRB-01',   'Civil',    'm3',    55.00,   38.00, 'TEST Desert Aggregates'),
    ('TEST Gate valve DN300',                 'TEST-GTV-300',  'Valves',   'nos', 1900.00, 1450.00, 'TEST Pump and Valve Trading')
  ) as v(nm, sku, cat, uo, lp, cp, sup) loop
    if not exists (select 1 from products p where p.tenant_id = t and p.name = r.nm) then
      insert into products (tenant_id, ref, name, sku, category, uom, description, list_price, cost_price, tax_percent, status)
      values (t, pg_temp.kamco_ref('products', t, 'PRD'), r.nm, r.sku, r.cat, r.uo, 'Test catalogue item for the KAMCO tender walk-through.', r.lp, r.cp, 15, 'active')
      returning id into v_id;
      if v_has_col then
        update products set supplier_id = (select s.id from suppliers s where s.tenant_id = t and s.name = r.sup)
        where id = v_id and tenant_id = t;
      end if;
    end if;
  end loop;

  -- ---- Inventory items (the stocked materials) ------------------------------------------------------------------------------------
  if to_regclass('public.inventory_items') is not null then
    for r in select * from (values
      ('TEST Rebar 16mm B500 (stock)',          'TEST-INV-REB16', 'Steel',  'tons',  42.00, 2650.00, 'TEST Al Noor Steel'),
      ('TEST Manhole cover D400 (stock)',       'TEST-INV-MHC',   'Civil',  'nos',  120.00,  260.00, 'TEST Al Noor Steel'),
      ('TEST Granular backfill (stock)',        'TEST-INV-GRB',   'Civil',  'm3',   900.00,   38.00, 'TEST Desert Aggregates'),
      ('TEST 300mm HDPE pipe (stock)',          'TEST-INV-H300',  'Pipes',  'm',    600.00,   46.00, 'TEST Gulf Pipes LLC'),
      ('TEST Gate valve DN300 (stock)',         'TEST-INV-GTV',   'Valves', 'nos',    4.00, 1450.00, 'TEST Pump and Valve Trading')
    ) as v(nm, sku, cat, uo, qty, cost, sup) loop
      if not exists (select 1 from inventory_items i where i.tenant_id = t and i.name = r.nm) then
        insert into inventory_items (tenant_id, ref, sku, name, category, uom, supplier_id, qty_on_hand, unit_cost, status)
        values (t, pg_temp.kamco_ref('inventory_items', t, 'INV'), r.sku, r.nm, r.cat, r.uo,
                (select s.id from suppliers s where s.tenant_id = t and s.name = r.sup), r.qty, r.cost, 'active');
      end if;
    end loop;
  else
    raise notice 'inventory_items is missing: stocked items skipped.';
  end if;

  -- =================================================================================================================================
  -- DEAL 1 -- stage Received. Nothing priced. Bid end date in 20 days. Six lines linked to catalogue products.
  -- =================================================================================================================================
  select id into opp1 from opportunities where tenant_id = t and title = c_opp1;
  if opp1 is null then
    insert into opportunities (tenant_id, ref, account_id, contact_id, source, title, description, stage, outcome, expected_close, amount, currency, probability, team)
    values (t, pg_temp.kamco_ref('opportunities', t, 'OPP'), acc_mpw, con_mpw, 'direct', c_opp1,
            'Test tender, just received. Storm water pipes, manholes and covers. Nothing is priced yet.',
            'received', 'open', (now() + interval '20 days')::date, 0, v_cur, 10, '[]'::jsonb)
    returning id into opp1;

    insert into opportunity_tenders (opportunity_id, tenant_id, deal_type_id, tender_no, issuer_name, issuer_account_id, portal, closing_at)
    values (opp1, t, v_dt, 'TEST-MPW-2026-014', 'TEST Ministry of Public Works', acc_mpw, 'email',
            date_trunc('day', now()) + interval '20 days 11 hours');

    for r in select * from (values
      ('TEST Trench excavation, ordinary soil',     '1', 'm3',   4200, null),
      ('TEST Supply and lay 600mm HDPE pipe',       '2', 'm',    1500, 'TEST 600mm HDPE pipe'),
      ('TEST Supply and lay 300mm HDPE pipe',       '3', 'm',     900, 'TEST 300mm HDPE pipe'),
      ('TEST Precast manhole ring 1200mm',          '4', 'nos',    60, 'TEST Precast manhole ring 1200mm'),
      ('TEST Manhole cover and frame D400',         '5', 'nos',    60, 'TEST Manhole cover and frame D400'),
      ('TEST Reinforcement steel B500',             '6', 'tons',   85, 'TEST Rebar 16mm B500')
    ) as v(descr, sl, uo, qty, pname) loop
      insert into opportunity_lines (tenant_id, opportunity_id, sl_no, description, uom, qty, rate, amount, product_id)
      values (t, opp1, r.sl, r.descr, r.uo, r.qty, 0, 0,
              (select p.id from products p where p.tenant_id = t and p.name = r.pname));
    end loop;
  end if;

  -- =================================================================================================================================
  -- DEAL 2 -- stage Estimating. Uploaded BOQ with 12 lines (some priced, some not, one stale), an estimate, an RFQ with two replies.
  -- =================================================================================================================================
  select id, ref into opp2, opp2_ref from opportunities where tenant_id = t and title = c_opp2;
  if opp2 is null then
    insert into opportunities (tenant_id, ref, account_id, contact_id, source, title, description, stage, outcome, expected_close, amount, currency, probability, team)
    values (t, pg_temp.kamco_ref('opportunities', t, 'OPP'), acc_mra, con_mra, 'direct', c_opp2,
            'Test tender in estimating. Pipelines, culverts and manholes; some rates known, four need supplier prices.',
            'estimating', 'open', (now() + interval '12 days')::date, 0, v_cur, 25, '[]'::jsonb)
    returning id, ref into opp2, opp2_ref;

    insert into opportunity_tenders (opportunity_id, tenant_id, deal_type_id, tender_no, issuer_name, issuer_account_id, portal, closing_at,
                                     bid_bond_amount, bid_bond_currency, bid_bond_expiry, addenda_count,
                                     decision, decision_reason, decided_at)
    values (opp2, t, v_dt, 'TEST-MRA-2026-021', 'TEST Municipality Roads Authority', acc_mra, 'ariba',
            date_trunc('day', now()) + interval '12 days 12 hours',
            75000, v_cur, (current_date + 90), 1,
            'go', 'TEST Pipes and precast are core work, capacity is free.', now() - interval '10 days');
  end if;

  -- The 12 BOQ rows: one table drives the deal lines, the BOQ lines, and the RFQ lines, so they always agree.
  drop table if exists pg_temp.kamco_boq_rows;
  create temp table kamco_boq_rows (
    descr text, item_no text, uom text, qty numeric, rate numeric, pname text,
    src text, src_ref text, age_days int, unit_cost numeric, markup numeric, in_rfq boolean
  );
  insert into kamco_boq_rows values
    ('TEST Trench excavation, ordinary soil',        '1.1', 'm3',   3200,    18, null,                                 'manual',       null,                              0, null, null, false),
    ('TEST Granular backfill, compacted',            '1.2', 'm3',   1450,    62, 'TEST Granular backfill, compacted',  'past_project', 'TEST Price list 2026',           45, null, null, false),
    ('TEST Supply and lay 300mm HDPE pipe',          '2.1', 'm',     850,    78, 'TEST 300mm HDPE pipe',               'past_project', 'TEST Price list 2026',           45, null, null, false),
    ('TEST Supply and lay 600mm HDPE pipe',          '2.2', 'm',    1200,   195, 'TEST 600mm HDPE pipe',               'supplier',     'TEST Gulf Pipes LLC quote (old)', 240, 150, 30, false),
    ('TEST Supply and lay 900mm RCP pipe',           '2.3', 'm',     400,     0, 'TEST 900mm RCP pipe',                null,           null,                            null, null, null, true),
    ('TEST Precast box culvert 2.0 x 2.0 m',         '3.1', 'nos',    18,     0, 'TEST Precast box culvert 2.0x2.0m',  null,           null,                            null, null, null, true),
    ('TEST Precast manhole ring 1200mm',             '3.2', 'nos',    46,     0, 'TEST Precast manhole ring 1200mm',   null,           null,                            null, null, null, true),
    ('TEST Manhole cover and frame D400',            '3.3', 'nos',    46,     0, 'TEST Manhole cover and frame D400',  null,           null,                            null, null, null, true),
    ('TEST Reinforcement steel B500, supply and fix','4.1', 'tons',  120,     0, 'TEST Rebar 16mm B500',               null,           null,                            null, null, null, false),
    ('TEST Concrete C40 for headwalls',              '4.2', 'm3',    260,     0, 'TEST Ready-mix concrete C40',        null,           null,                            null, null, null, false),
    ('TEST Gate valve DN300 with chamber',           '5.1', 'nos',     6,     0, 'TEST Gate valve DN300',              null,           null,                            null, null, null, false),
    ('TEST Testing and commissioning of pipelines',  '5.2', 'lot',     1, 45000, null,                                 'manual',       null,                              0, null, null, false);

  -- Deal lines of deal 2 (only when the deal has none yet).
  if not exists (select 1 from opportunity_lines l where l.tenant_id = t and l.opportunity_id = opp2) then
    for r in select * from kamco_boq_rows order by item_no loop
      insert into opportunity_lines (tenant_id, opportunity_id, sl_no, description, uom, qty, rate, amount, product_id)
      values (t, opp2, r.item_no, r.descr, r.uom, r.qty, r.rate, round(r.qty * r.rate, 2),
              (select p.id from products p where p.tenant_id = t and p.name = r.pname));
    end loop;
  end if;

  -- The uploaded BOQ (migration 0223).
  if to_regclass('public.tender_boq_sources') is null or to_regclass('public.tender_boq_lines') is null then
    raise notice 'Migration 0223 (tender BOQ) is missing: the BOQ of deal 2 was skipped. Run it and run this script again.';
  elsif not exists (select 1 from tender_boq_sources s where s.tenant_id = t and s.opportunity_id = opp2) then
    insert into tender_boq_sources (tenant_id, opportunity_id, version, is_current, file_name, storage_path, size_bytes, sheet_name,
                                    header_row, header_labels, column_map, rate_col, amount_col, added_columns, total_row, line_count)
    values (t, opp2, 1, true, 'TEST-BOQ-Package-B.xlsx', t::text || '/' || opp2::text || '/TEST-BOQ-Package-B.xlsx', 0, 'BOQ',
            5, '["Item","Description","Unit","Qty","Rate","Amount"]'::jsonb,
            '{"item_no":1,"description":2,"uom":3,"qty":4,"rate":5,"amount":6}'::jsonb, 5, 6, false, 18, 12)
    returning id into src_id;

    v_n := 0;
    for r in select * from kamco_boq_rows order by item_no loop
      v_n := v_n + 1;
      insert into tender_boq_lines (tenant_id, opportunity_id, source_id, line_id, item_key, item_no, row_no,
                                    file_description, file_uom, file_qty,
                                    price_source, price_source_ref, price_as_of, unit_cost, markup_pct, priced_at)
      values (t, opp2, src_id,
              (select l.id from opportunity_lines l where l.tenant_id = t and l.opportunity_id = opp2 and l.sl_no = r.item_no),
              r.item_no, r.item_no,
              5 + v_n,
              r.descr, r.uom, r.qty,
              r.src, r.src_ref, case when r.age_days is null then null else current_date - r.age_days end,
              r.unit_cost, r.markup,
              case when r.src is null then null else now() end);
    end loop;
  end if;

  -- The estimate attached to deal 2 (migrations 0131 and 0227).
  if to_regclass('public.estimates') is null or to_regclass('public.estimate_lines') is null then
    raise notice 'Migration 0131 (estimator) is missing: the estimate of deal 2 was skipped.';
  else
    select id into est_id from estimates where tenant_id = t and name = c_est;
    if est_id is null then
      insert into estimates (tenant_id, ref, name, account_id, contact_id, status, params, currency, margin_pct, notes)
      values (t, pg_temp.kamco_ref('estimates', t, 'EST'), c_est, acc_mra, con_mra, 'draft', '{}'::jsonb, v_cur, 15,
              'Test estimate for the headwalls of Package B. Lines were typed by hand.')
      returning id into est_id;

      insert into estimate_lines (tenant_id, estimate_id, sort_order, code, group_key, description, uom, qty, waste_pct, unit_cost, cost_total, component, product_id, source)
      values
        (t, est_id, 1, 'CONC', 'Headwalls', 'TEST Concrete C40 for headwalls', 'm3', 260, 5, 285, round(260 * 1.05 * 285, 2), 'materials',
         (select p.id from products p where p.tenant_id = t and p.name = 'TEST Ready-mix concrete C40'), 'manual'),
        (t, est_id, 2, 'REBAR', 'Headwalls', 'TEST Reinforcement steel B500', 'tons', 120, 3, 2650, round(120 * 1.03 * 2650, 2), 'materials',
         (select p.id from products p where p.tenant_id = t and p.name = 'TEST Rebar 16mm B500'), 'manual'),
        (t, est_id, 3, 'LAB', 'Headwalls', 'TEST Formwork and casting labour', 'lot', 1, 0, 38000, 38000, 'labour', null, 'manual');
    end if;
    select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'estimates' and column_name = 'opportunity_id') into v_has_col;
    if v_has_col then
      update estimates set opportunity_id = opp2 where id = est_id and tenant_id = t;
    else
      raise notice 'Migration 0227 is missing: the estimate exists but is not attached to deal 2.';
    end if;
  end if;

  -- The RFQ for four unpriced rows, sent to two suppliers, both replied at different prices, nothing awarded (migration 0128).
  if to_regclass('public.rfqs') is null or to_regclass('public.rfq_lines') is null
     or to_regclass('public.rfq_suppliers') is null or to_regclass('public.rfq_responses') is null then
    raise notice 'Migration 0128 (RFQ) is missing: the RFQ of deal 2 was skipped.';
  else
    select id into rfq_id_v from rfqs where tenant_id = t and title = c_rfq;
    if rfq_id_v is null then
      v_n := pg_temp.kamco_next('rfqs', t, 'RFQ');
      if to_regclass('public.pricing_rfqs') is not null then
        v_n := greatest(v_n, pg_temp.kamco_next('pricing_rfqs', t, 'RFQ'));
      end if;
      insert into rfqs (tenant_id, ref, title, status, origin_type, origin_id, origin_label, respond_by, required_by, delivery_terms, currency, notes_to_supplier)
      values (t, 'RFQ-' || lpad(v_n::text, 4, '0'), c_rfq, 'replied', 'opportunity', opp2, opp2_ref,
              current_date + 2, current_date + 40, 'DAP project site', v_cur,
              'Test request: please quote the four items below, valid for 30 days.')
      returning id into rfq_id_v;

      -- What each test supplier answered for each item (item no, supplier, unit price, lead time in days).
      drop table if exists pg_temp.kamco_quotes;
      create temp table kamco_quotes (sup text, item_no text, price numeric, lead int);
      insert into kamco_quotes values
        ('TEST Precast Arabia',  '2.3',  340, 21),
        ('TEST Gulf Pipes LLC',  '2.3',  365, 14),
        ('TEST Precast Arabia',  '3.1', 2050, 35),
        ('TEST Gulf Pipes LLC',  '3.1', 1980, 45),
        ('TEST Precast Arabia',  '3.2',  470, 28),
        ('TEST Gulf Pipes LLC',  '3.2',  455, 40),
        ('TEST Precast Arabia',  '3.3',  295, 21),
        ('TEST Gulf Pipes LLC',  '3.3',  280, 30);

      insert into rfq_suppliers (tenant_id, rfq_id, supplier_id, status, sent_at, viewed_at, replied_at, currency, valid_until, reply_source, supplier_quote_ref)
      values
        (t, rfq_id_v, sup_pa, 'replied', now() - interval '6 days', now() - interval '5 days', now() - interval '3 days', v_cur, current_date + 30, 'buyer', 'TEST-PA-Q1'),
        (t, rfq_id_v, sup_gp, 'replied', now() - interval '6 days', now() - interval '5 days', now() - interval '2 days', v_cur, current_date + 30, 'buyer', 'TEST-GP-Q1');

      v_n := 0;
      for r in select * from kamco_boq_rows where in_rfq order by item_no loop
        v_n := v_n + 1;
        insert into rfq_lines (tenant_id, rfq_id, sl_no, product_id, description, spec, uom, qty)
        values (t, rfq_id_v, v_n, (select p.id from products p where p.tenant_id = t and p.name = r.pname),
                r.descr, 'Item no. ' || r.item_no, r.uom, r.qty)
        returning id into rfq_line_v;

        update opportunity_lines set rfq_line_id = rfq_line_v
        where tenant_id = t and opportunity_id = opp2 and sl_no = r.item_no;

        insert into rfq_responses (tenant_id, rfq_supplier_id, rfq_line_id, status, unit_price, currency, fx_rate, lead_time_days, valid_until, source, submitted_at)
        select t, rs.id, rfq_line_v, 'quoted', q.price, v_cur, 1, q.lead, current_date + 30, 'buyer', now() - interval '3 days'
        from kamco_quotes q
        join suppliers s on s.tenant_id = t and s.name = q.sup
        join rfq_suppliers rs on rs.tenant_id = t and rs.rfq_id = rfq_id_v and rs.supplier_id = s.id
        where q.item_no = r.item_no;
      end loop;
    end if;
  end if;

  -- =================================================================================================================================
  -- DEAL 3 -- stage Submitted. Six priced lines, one saved bid version, a bid guarantee (issued), two competitors, two logged calls.
  -- =================================================================================================================================
  select id into opp3 from opportunities where tenant_id = t and title = c_opp3;
  if opp3 is null then
    insert into opportunities (tenant_id, ref, account_id, contact_id, source, title, description, stage, outcome, expected_close, amount, currency, probability, team)
    values (t, pg_temp.kamco_ref('opportunities', t, 'OPP'), acc_nwc, null, 'direct', c_opp3,
            'Test tender, bid submitted. Waiting for the evaluation; two competitors are known.',
            'submitted', 'open', (now() - interval '3 days')::date, 0, v_cur, 40, '[]'::jsonb)
    returning id into opp3;
    v_new3 := true;

    insert into opportunity_tenders (opportunity_id, tenant_id, deal_type_id, tender_no, issuer_name, issuer_account_id, portal, closing_at,
                                     bid_bond_amount, bid_bond_currency, bid_bond_expiry,
                                     decision, decision_reason, decided_at)
    values (opp3, t, v_dt, 'TEST-NWC-2026-009', 'TEST National Water Company', acc_nwc, 'excel',
            date_trunc('day', now()) - interval '3 days' + interval '12 hours',
            120000, v_cur, (current_date + 60),
            'go', 'TEST Known client, good fit for our pipe crews.', now() - interval '30 days');

    for r in select * from (values
      ('TEST Supply and lay 300mm HDPE pipe',     '1', 'm',    2100,   78, 'TEST 300mm HDPE pipe'),
      ('TEST Supply and lay 600mm HDPE pipe',     '2', 'm',     900,  160, 'TEST 600mm HDPE pipe'),
      ('TEST Gate valve DN300 with chamber',      '3', 'nos',     8, 2350, 'TEST Gate valve DN300'),
      ('TEST Manhole cover and frame D400',       '4', 'nos',    24,  410, 'TEST Manhole cover and frame D400'),
      ('TEST Trench excavation and backfill',     '5', 'm3',   5200,   41, 'TEST Granular backfill, compacted'),
      ('TEST Testing and commissioning',          '6', 'lot',     1, 45000, null)
    ) as v(descr, sl, uo, qty, rate, pname) loop
      insert into opportunity_lines (tenant_id, opportunity_id, sl_no, description, uom, qty, rate, amount, product_id)
      values (t, opp3, r.sl, r.descr, r.uo, r.qty, r.rate, round(r.qty * r.rate, 2),
              (select p.id from products p where p.tenant_id = t and p.name = r.pname));
    end loop;
  end if;

  -- The bid guarantee is "issued". The word 'issued' needs migration 0228; before it, the legacy 'held' is shown as Issued.
  if v_new3 then
    begin
      update opportunity_tenders set bond_status = 'issued' where opportunity_id = opp3 and tenant_id = t;
    exception when check_violation or undefined_column then
      begin
        update opportunity_tenders set bond_status = 'held' where opportunity_id = opp3 and tenant_id = t;
      exception when undefined_column then
        raise notice 'Migration 0221 is missing: the bid guarantee has no status column yet.';
      end;
    end;
  end if;

  -- One saved bid version (migration 0225): the snapshot of the six lines, with no cost and no markup in it.
  if to_regclass('public.tender_bid_versions') is null then
    raise notice 'Migration 0225 (bid versions) is missing: the saved bid of deal 3 was skipped.';
  elsif not exists (select 1 from tender_bid_versions b where b.tenant_id = t and b.opportunity_id = opp3) then
    insert into tender_bid_versions (tenant_id, opportunity_id, version_no, submitted_at, currency, total, line_count, lines, note)
    select t, opp3, 1, now() - interval '4 days', v_cur,
           coalesce(sum(l.amount), 0), count(*)::int,
           coalesce(jsonb_agg(jsonb_build_object(
             'key', 'no:' || lower(l.sl_no), 'item_no', l.sl_no, 'description', l.description, 'unit', l.uom,
             'qty', l.qty, 'rate', l.rate, 'amount', l.amount,
             'product_ref', (select p.sku from products p where p.id = l.product_id and p.tenant_id = t),
             'price_source', 'Manual') order by l.sl_no), '[]'::jsonb),
           'TEST first submission'
    from opportunity_lines l
    where l.tenant_id = t and l.opportunity_id = opp3;
  end if;

  -- Competitors with their expected price position (migration 0229).
  if to_regclass('public.opportunity_competitors') is null then
    raise notice 'Migration 0229 (competitors) is missing: the competitors of deal 3 were skipped.';
  else
    for r in select * from (values
      ('TEST Gulf Infra Contractors', 'lower',  'Large fleet, usually bids low on pipe laying.', 1),
      ('TEST Horizon Civil Works',    'higher', 'Strong on precast chambers, slower on programme.', 2)
    ) as v(nm, px, strengths, srt) loop
      if not exists (select 1 from opportunity_competitors c where c.tenant_id = t and c.opportunity_id = opp3 and lower(c.name) = lower(r.nm)) then
        insert into opportunity_competitors (tenant_id, opportunity_id, name, expected_price, strengths, sort)
        values (t, opp3, r.nm, r.px, r.strengths, r.srt);
      end if;
    end loop;
  end if;

  -- Two logged calls (migration 0225).
  if to_regclass('public.deal_activities') is null then
    raise notice 'Migration 0225 (deal activities) is missing: the calls of deal 3 were skipped.';
  else
    for r in select * from (values
      ('TEST Call with the tender committee secretary', 'call',    'Confirmed the bid was received and is being checked.', null, null, 5),
      ('TEST Site visit before submission',             'site_visit', 'Walked the route of the main, no surprises.', 'TEST Send the clarification letter', (current_date + 7), 20)
    ) as v(summ, kd, outc, nxt, due, ago) loop
      if not exists (select 1 from deal_activities a where a.tenant_id = t and a.opportunity_id = opp3 and a.summary = r.summ) then
        insert into deal_activities (tenant_id, opportunity_id, kind, occurred_at, with_whom, summary, outcome, next_step, next_step_due)
        values (t, opp3, r.kd, now() - (r.ago || ' days')::interval, 'TEST Water Company staff', r.summ, r.outc, r.nxt, r.due);
      end if;
    end loop;
  end if;

  -- =================================================================================================================================
  -- TENDER DESK -- more deals so the home screen has numbers to show (docs/design/tender-desk.md, "Seed"). 13 more open tenders (16 in all)
  -- and 8 decided ones. Open ones carry a bid end date `close_days` days from today (negative = already past, waiting for the result);
  -- decided ones carry `closed_ago` days since they were decided. No lines are made for these deals: their amount is typed, like a tender
  -- whose estimate has not started. Owners stay empty, so no reminder e-mail goes out.
  -- =================================================================================================================================
  drop table if exists pg_temp.kamco_desk_deals;
  create temp table kamco_desk_deals (
    title text, tender_no text, client text, stage text, outcome text, amount numeric, prob int,
    close_days int, created_ago int, closed_ago int, portal text, bond_amount numeric, bond_days int
  );
  insert into kamco_desk_deals values
    ('TEST Tender 2026/031 - Coastal highway drainage',           'TEST-KAM-2026-101', 'TEST Coastal Developments LLC',       'received',       'open',    7500000, 10, 26,  3, null, 'email', null, null),
    ('TEST Tender 2026/033 - Pumping station refurbishment',      'TEST-KAM-2026-102', 'TEST Eastern Utilities Authority',    'received',       'open',   12800000, 10, 18,  5, null, 'ariba', null, null),
    ('TEST Tender 2026/036 - Culvert replacement programme',      'TEST-KAM-2026-103', 'TEST Municipality Roads Authority',   'received',       'open',    4200000, 10, 24,  2, null, 'excel', null, null),
    ('TEST Tender 2026/027 - Sewer rehabilitation, North zone',   'TEST-KAM-2026-104', 'TEST National Water Company',         'bid_no_bid',     'open',    9600000, 15,  9,  8, null, 'ariba', null, null),
    ('TEST Tender 2026/029 - Road widening utilities relocation', 'TEST-KAM-2026-105', 'TEST Municipality Roads Authority',   'bid_no_bid',     'open',    6300000, 15, 15,  9, null, 'email', null, null),
    ('TEST Tender 2026/030 - Reservoir inlet works',              'TEST-KAM-2026-106', 'TEST National Water Company',         'bid_no_bid',     'open',   14500000, 15, 21,  6, null, 'excel', null, null),
    ('TEST Tender 2026/019 - Trunk main extension, Phase 2',      'TEST-KAM-2026-107', 'TEST Eastern Utilities Authority',    'estimating',     'open',   18900000, 25,  6, 30, null, 'ariba', null, null),
    ('TEST Tender 2026/022 - Stormwater outfall and headwalls',   'TEST-KAM-2026-108', 'TEST Ministry of Public Works',       'estimating',     'open',   11400000, 25,  3, 25, null, 'email', null, null),
    ('TEST Tender 2026/023 - Precast drainage channels',          'TEST-KAM-2026-109', 'TEST Coastal Developments LLC',       'estimating',     'open',    8200000, 25, 14, 20, null, 'other', 164000, 9),
    ('TEST Tender 2026/025 - Pipe bedding and backfill, Zone 2',  'TEST-KAM-2026-110', 'TEST Municipality Roads Authority',   'estimating',     'open',    3400000, 25,  2, 15, null, 'email', null, null),
    ('TEST Tender 2026/015 - Water network upgrade, Package A',   'TEST-KAM-2026-111', 'TEST National Water Company',         'submitted',      'open',   16700000, 40, -2, 40, null, 'ariba', null, null),
    ('TEST Tender 2026/016 - Municipal depot civil works',        'TEST-KAM-2026-112', 'TEST Ministry of Public Works',       'submitted',      'open',    5900000, 40, -6, 45, null, 'excel', null, null),
    ('TEST Tender 2026/012 - Desalination outfall pipeline',      'TEST-KAM-2026-113', 'TEST Eastern Utilities Authority',    'clarifications', 'open',   19000000, 50, -12, 70, null, 'ariba', null, null),
    ('TEST Tender 2025/118 - Coastal road drainage',              'TEST-KAM-2025-201', 'TEST Coastal Developments LLC',       'awarded',        'won',     5800000, 100, 0,  80,  20, 'ariba', null, null),
    ('TEST Tender 2026/004 - Pump station civil works',           'TEST-KAM-2026-202', 'TEST Ministry of Public Works',       'awarded',        'won',     8400000, 100, 0, 130,  70, 'email', null, null),
    ('TEST Tender 2025/142 - Culvert supply and install',         'TEST-KAM-2025-203', 'TEST Municipality Roads Authority',   'awarded',        'won',     6100000, 100, 0, 210, 150, 'excel', null, null),
    ('TEST Tender 2025/131 - Water main renewal, Zone 2',         'TEST-KAM-2025-204', 'TEST National Water Company',         'awarded',        'won',    12300000, 100, 0, 310, 250, 'ariba', null, null),
    ('TEST Tender 2026/008 - Highway cross drains',               'TEST-KAM-2026-205', 'TEST Municipality Roads Authority',   'bid_lost',       'lost',    9700000, 0, 0, 100,  45, 'ariba', null, null),
    ('TEST Tender 2025/150 - Reservoir rehabilitation',           'TEST-KAM-2025-206', 'TEST National Water Company',         'bid_lost',       'lost',   14200000, 0, 0, 170, 110, 'email', null, null),
    ('TEST Tender 2025/138 - Coastal promenade drainage',         'TEST-KAM-2025-207', 'TEST Coastal Developments LLC',       'bid_lost',       'lost',    7300000, 0, 0, 260, 200, 'excel', null, null),
    ('TEST Tender 2026/001 - Marine outfall, Eastern',            'TEST-KAM-2026-208', 'TEST Eastern Utilities Authority',    'no_bid',         'dropped',15000000, 0, 0, 120,  95, 'other', null, null);

  for r in select * from kamco_desk_deals order by tender_no loop
    if not exists (select 1 from opportunities o where o.tenant_id = t and o.title = r.title) then
      insert into opportunities (tenant_id, ref, account_id, source, title, description, stage, outcome, expected_close, amount, currency, probability, team, created_at, updated_at, closed_at)
      values (t, pg_temp.kamco_ref('opportunities', t, 'OPP'),
              (select a.id from accounts a where a.tenant_id = t and a.name = r.client), 'direct', r.title,
              'Test tender for the Tender desk home screen.',
              r.stage, r.outcome, (now() + (coalesce(r.close_days, 0) || ' days')::interval)::date, r.amount, v_cur, r.prob, '[]'::jsonb,
              now() - (r.created_ago || ' days')::interval,
              case when r.closed_ago is null then now() - (r.created_ago || ' days')::interval else now() - (r.closed_ago || ' days')::interval end,
              case when r.closed_ago is null then null else now() - (r.closed_ago || ' days')::interval end)
      returning id into v_id;

      insert into opportunity_tenders (opportunity_id, tenant_id, deal_type_id, tender_no, issuer_name, issuer_account_id, portal, closing_at,
                                       bid_bond_amount, bid_bond_currency, bid_bond_expiry, decision, decision_reason, decided_at)
      values (v_id, t, v_dt, r.tender_no, r.client, (select a.id from accounts a where a.tenant_id = t and a.name = r.client), r.portal,
              case when r.closed_ago is null then date_trunc('day', now()) + (r.close_days || ' days')::interval + interval '11 hours'
                   else now() - ((r.closed_ago + 10) || ' days')::interval end,
              r.bond_amount, case when r.bond_amount is null then null else v_cur end,
              case when r.bond_days is null then null else current_date + r.bond_days end,
              case when r.stage in ('received', 'bid_no_bid') then null when r.outcome = 'dropped' then 'no_go' else 'go' end,
              case when r.stage in ('received', 'bid_no_bid') then null when r.outcome = 'dropped' then 'TEST Outside our scope this year.' else 'TEST Core work, capacity is free.' end,
              case when r.stage in ('received', 'bid_no_bid') then null else now() - ((r.created_ago - 5) || ' days')::interval end);
    end if;
  end loop;

  -- The guarantees of the new deals are "issued" (the word needs migration 0228; before it the legacy 'held' reads as Issued).
  begin
    update opportunity_tenders set bond_status = 'issued' where tenant_id = t and tender_no like 'TEST-KAM-%' and bid_bond_amount is not null and bond_status = 'held';
  exception when check_violation or undefined_column then
    raise notice 'Migration 0221/0228 is missing: the new bid guarantee has no status yet.';
  end;

  -- One bid / no-bid proposal waiting for a manager (migration 0221). The proposer is an unknown user id, so any admin may decide it.
  if to_regclass('public.approval_requests') is null then
    raise notice 'Migration 0221 (approvals) is missing: the waiting bid decision was skipped.';
  else
    select o.opportunity_id into v_id from opportunity_tenders o where o.tenant_id = t and o.tender_no = 'TEST-KAM-2026-105';
    if v_id is not null and not exists (select 1 from approval_requests a where a.tenant_id = t and a.object_id = v_id and a.kind = 'tender_bid_decision' and a.status = 'pending') then
      insert into approval_requests (tenant_id, object_type, object_id, kind, proposed_value, reason, requested_by, status, created_at)
      values (t, 'opportunity_tenders', v_id, 'tender_bid_decision', 'go', 'TEST Utilities relocation is routine work for our crews.', gen_random_uuid(), 'pending', now() - interval '2 days');
    end if;
  end if;

  -- One RFQ whose reply date has passed while both suppliers are still silent (migration 0128).
  if to_regclass('public.rfqs') is null or to_regclass('public.rfq_lines') is null or to_regclass('public.rfq_suppliers') is null then
    raise notice 'Migration 0128 (RFQ) is missing: the late RFQ was skipped.';
  else
    select id into v_rfq_late from rfqs where tenant_id = t and title = 'TEST RFQ - Late supplier replies';
    if v_rfq_late is null then
      v_n := pg_temp.kamco_next('rfqs', t, 'RFQ');
      if to_regclass('public.pricing_rfqs') is not null then
        v_n := greatest(v_n, pg_temp.kamco_next('pricing_rfqs', t, 'RFQ'));
      end if;
      select o.opportunity_id into v_id from opportunity_tenders o where o.tenant_id = t and o.tender_no = 'TEST-KAM-2026-107';
      insert into rfqs (tenant_id, ref, title, status, origin_type, origin_id, origin_label, respond_by, currency, notes_to_supplier)
      values (t, 'RFQ-' || lpad(v_n::text, 4, '0'), 'TEST RFQ - Late supplier replies', 'sent', 'opportunity', v_id,
              (select op.ref from opportunities op where op.id = v_id and op.tenant_id = t), current_date - 3, v_cur,
              'Test request: please quote the two items below.')
      returning id into v_rfq_late;

      insert into rfq_lines (tenant_id, rfq_id, sl_no, description, uom, qty)
      values (t, v_rfq_late, 1, 'TEST Ductile iron pipe DN600', 'm', 800), (t, v_rfq_late, 2, 'TEST Butterfly valve DN600', 'nos', 6);

      insert into rfq_suppliers (tenant_id, rfq_id, supplier_id, status, sent_at)
      select t, v_rfq_late, s.id, 'sent', now() - interval '8 days'
      from suppliers s where s.tenant_id = t and s.name in ('TEST Gulf Pipes LLC', 'TEST Pump and Valve Trading');
    end if;
  end if;

  -- ---- One contract project from a won tender, with a baseline budget and four buy-out packages (migrations 0226 and 0234) ----------
  if to_regclass('public.contract_projects') is null or to_regclass('public.project_budget_revisions') is null or to_regclass('public.project_budget_lines') is null then
    raise notice 'Migration 0226 (contract projects) is missing: the project and its buy-out packages were skipped.';
  else
    select o.id into v_src from opportunities o where o.tenant_id = t and o.title = 'TEST Tender 2025/118 - Coastal road drainage';
    select id into v_proj from contract_projects where tenant_id = t and name = v_proj_name;

    drop table if exists pg_temp.kamco_budget_rows;
    create temp table kamco_budget_rows (descr text, wbs text, unit text, qty numeric, unit_cost numeric, pgroup text);
    insert into kamco_budget_rows values
      ('TEST Drainage pipe 600mm, supply',        '1.1', 'm',    900,   1100, 'Pipes'),
      ('TEST Drainage pipe 900mm, supply',        '1.2', 'm',    600,    650, 'Pipes'),
      ('TEST Precast box culverts 2.0 x 2.0 m',   '2.1', 'nos',   48,  21000, 'Precast'),
      ('TEST Reinforcement steel B500',           '3.1', 'tons', 260,   2650, 'Steel'),
      ('TEST Gate valves and chambers',           '4.1', 'nos',   14,  28500, 'Valves'),
      ('TEST Site labour and supervision',        '5.1', 'lot',    1, 850000, null);

    if v_proj is null and v_src is not null then
      insert into contract_projects (tenant_id, ref, name, account_id, source_opportunity_id, status, contract_value, currency, planned_start, planned_end)
      values (t, pg_temp.kamco_ref('contract_projects', t, 'CPR'), v_proj_name,
              (select o.account_id from opportunities o where o.id = v_src and o.tenant_id = t), v_src, 'active', 5800000, v_cur, current_date - 15, current_date + 330)
      returning id into v_proj;

      insert into project_budget_revisions (tenant_id, project_id, rev_no, status, approved_at, locked_at)
      values (t, v_proj, 0, 'approved', now() - interval '14 days', now() - interval '14 days')
      returning id into v_rev;

      insert into project_budget_lines (tenant_id, revision_id, project_id, line_no, wbs, description, qty, unit, unit_cost, amount, cost_known)
      select t, v_rev, v_proj, row_number() over (order by b.wbs), b.wbs, b.descr, b.qty, b.unit, b.unit_cost, round(b.qty * b.unit_cost, 2), true
      from kamco_budget_rows b;

      update project_budget_revisions
      set total = (select coalesce(sum(l.amount), 0) from project_budget_lines l where l.tenant_id = t and l.revision_id = v_rev)
      where id = v_rev and tenant_id = t;
    end if;

    if v_proj is not null then
      select pbr.id into v_rev from project_budget_revisions pbr where pbr.tenant_id = t and pbr.project_id = v_proj and pbr.rev_no = 0;
    end if;

    if to_regclass('public.project_buyout_packages') is null or to_regclass('public.project_buyout_package_lines') is null then
      raise notice 'Migration 0234 (buy-out) is missing: the buy-out packages were skipped.';
    elsif v_proj is not null and v_rev is not null then
      for r in select * from (values
        ('TEST Drainage pipes package',    'Pipes',   'awarded', 'TEST Gulf Pipes LLC',   1295000),
        ('TEST Precast culverts package',  'Precast', 'awarded', 'TEST Precast Arabia',    975000),
        ('TEST Reinforcement steel package', 'Steel', 'quotes',  null,                        null),
        ('TEST Valves and chambers package', 'Valves', 'waiting', null,                       null)
      ) as v(pname, pgroup, state, sup, committed) loop
        if not exists (select 1 from project_buyout_packages p where p.tenant_id = t and p.project_id = v_proj and p.name = r.pname) then
          insert into project_buyout_packages (tenant_id, project_id, ref, name, kind, status, awarded_supplier_id, committed_amount, currency, award_reason, awarded_at)
          values (t, v_proj, pg_temp.kamco_ref('project_buyout_packages', t, 'PKG'), r.pname, 'supplier',
                  case r.state when 'awarded' then 'awarded' when 'quotes' then 'out' else 'draft' end,
                  (select s.id from suppliers s where s.tenant_id = t and s.name = r.sup), r.committed, v_cur,
                  case when r.state = 'awarded' then 'TEST Lowest valid price.' else null end,
                  case when r.state = 'awarded' then now() - interval '5 days' else null end)
          returning id into v_pkg;

          insert into project_buyout_package_lines (tenant_id, project_id, package_id, budget_line_id, line_key, sort_order)
          select t, v_proj, v_pkg, l.id, l.line_key, row_number() over (order by l.line_no)
          from kamco_budget_rows b
          join project_budget_lines l on l.tenant_id = t and l.revision_id = v_rev and l.wbs = b.wbs
          where b.pgroup = r.pgroup;
        end if;
      end loop;

      -- The steel package has gone out to two suppliers and both quoted (migration 0128 for the RFQ tables).
      select p.id into v_pkg from project_buyout_packages p where p.tenant_id = t and p.project_id = v_proj and p.name = 'TEST Reinforcement steel package';
      if to_regclass('public.rfqs') is null or to_regclass('public.rfq_lines') is null or to_regclass('public.rfq_suppliers') is null or to_regclass('public.rfq_responses') is null then
        raise notice 'Migration 0128 (RFQ) is missing: the steel package has no quotes.';
      elsif v_pkg is not null and not exists (select 1 from rfqs where tenant_id = t and title = 'TEST RFQ - Buy-out steel package') then
        v_n := pg_temp.kamco_next('rfqs', t, 'RFQ');
        if to_regclass('public.pricing_rfqs') is not null then
          v_n := greatest(v_n, pg_temp.kamco_next('pricing_rfqs', t, 'RFQ'));
        end if;
        insert into rfqs (tenant_id, ref, title, status, origin_type, respond_by, currency, package_id)
        values (t, 'RFQ-' || lpad(v_n::text, 4, '0'), 'TEST RFQ - Buy-out steel package', 'replied', 'manual', current_date + 5, v_cur, v_pkg)
        returning id into v_rfq_pkg;

        insert into rfq_lines (tenant_id, rfq_id, sl_no, description, uom, qty, package_line_id)
        select t, v_rfq_pkg, row_number() over (order by pl.sort_order), l.description, l.unit, l.qty, pl.id
        from project_buyout_package_lines pl
        join project_budget_lines l on l.id = pl.budget_line_id and l.tenant_id = t
        where pl.tenant_id = t and pl.package_id = v_pkg;

        insert into rfq_suppliers (tenant_id, rfq_id, supplier_id, status, sent_at, replied_at, currency, valid_until, reply_source)
        select t, v_rfq_pkg, s.id, 'replied', now() - interval '5 days', now() - interval '2 days', v_cur, current_date + 30, 'buyer'
        from suppliers s where s.tenant_id = t and s.name in ('TEST Al Noor Steel', 'TEST Desert Aggregates');

        insert into rfq_responses (tenant_id, rfq_supplier_id, rfq_line_id, status, unit_price, currency, fx_rate, lead_time_days, valid_until, source, submitted_at)
        select t, rs.id, rl.id, 'quoted', case s.name when 'TEST Al Noor Steel' then 2590 else 2640 end, v_cur, 1, 21, current_date + 30, 'buyer', now() - interval '2 days'
        from rfq_suppliers rs
        join suppliers s on s.id = rs.supplier_id and s.tenant_id = t
        join rfq_lines rl on rl.rfq_id = rs.rfq_id and rl.tenant_id = t
        where rs.tenant_id = t and rs.rfq_id = v_rfq_pkg;

        update project_buyout_packages set current_rfq_id = v_rfq_pkg where id = v_pkg and tenant_id = t;
      end if;
    end if;
  end if;

  -- ---- Employee (master data, no password) -------------------------------------------------------------------------------------
  -- One employee record with the e-mail abdulkhader@saytara.info. The code is the next free EMP-####, as the app makes it. No login is
  -- created and none is tied to it; link the login to this employee in Settings > Business users.
  select id into emp_id from employees where tenant_id = t and lower(email) = 'abdulkhader@saytara.info';
  if emp_id is null then
    select coalesce(max(substring(employee_code from '^EMP-([0-9]+)$')::int), 0) + 1 into emp_seq
    from employees where tenant_id = t and employee_code ~* '^EMP-[0-9]+$';
    insert into employees (tenant_id, first_name, last_name, employee_code, email, department, designation, status)
    values (t, 'TEST Abdul', 'Khader', 'EMP-' || lpad(emp_seq::text, 4, '0'), 'abdulkhader@saytara.info', 'Tenders', 'Tender engineer', 'active')
    returning id into emp_id;
  end if;

  -- ---- Deal amounts follow their lines, like the app does ---------------------------------------------------------------------------
  update opportunities o
  set amount = (select coalesce(sum(l.amount), 0) from opportunity_lines l where l.tenant_id = t and l.opportunity_id = o.id)
  where o.tenant_id = t and o.id in (opp1, opp2, opp3);

  raise notice 'KAMCO test data is in place: 3 TEST tender deals (%, %, %), the 21 Tender desk deals and the employee abdulkhader@saytara.info.', c_opp1, c_opp2, c_opp3;
end $seed$;
