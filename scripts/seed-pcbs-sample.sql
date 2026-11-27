-- PCBS SAMPLE DATA -- run on the PCBS Supabase project ONLY (the dedicated one, in the EU), by hand, in the SQL editor.
-- Do NOT run this on any other database: it looks for the workspace with the slug 'pcbs' and does nothing without one, but the data is
-- written for that client and belongs nowhere else.
--
-- WHY: so PCBS users can start testing the product with realistic data (Saudi precast manufacturer, SAR, VAT 15 percent) before their own
-- records exist. Every name, company and person is invented; no real brand, company or person is used.
--
-- HOW TO RUN: open the SQL editor of the PCBS database, paste this whole file, press Run. It is one transaction: either everything is
-- written or nothing is. Run it AFTER migrations 0248, 0250, 0251 and 0252 (and everything before them; the first block checks the tables
-- and columns it needs and stops with a plain message if one is missing, before writing anything). Safe to run twice: a record that
-- already exists is not made again, so a second run adds nothing.
--
-- HOW TO REMOVE: run scripts/seed-pcbs-sample-cleanup.sql (it only counts until you change one line, then deletes). It removes exactly
-- the rows this script made, found by their reserved ids, and nothing else in the workspace.
--
-- THE MARKER: every row this script writes gets an id from a reserved range, 5a3b1e00-5a3b-4000-8000-KKKKNNNNNNNN, where KKKK is the kind
-- of record (see pg_temp.pcbs_id below) and NNNNNNNN its number. The cleanup deletes by that id range, so it finds the rows even after
-- somebody edited their names, and it can never reach a row the owner or the client made. Names and titles also start with 'SAMPLE ' so a
-- tester can SEE what is sample; the cleanup does not depend on that. Standard Quotes and Quotations carry the refs SQ-SMP-#### and
-- QT-SMP-####, a series of their own that never touches the workspace's real numbering. Every other ref (ACC-####, EST-####, ...) is the
-- next free number of the workspace, made the way the app makes it.
--
-- WHAT IT CREATES (counts; the estimate lines and quote lines come from the real estimator engine, see scripts/gen-pcbs-sample-estimates.ts):
--   10 accounts (6 customers, 4 prospects: developers, contractors, a consultant and three government bodies), 15 contacts,
--   8 suppliers (cement and aggregates, rebar, admixtures, formwork and moulds, lifting inserts and fixings, hollow-core planks, haulage,
--   erection crews; the category is the first words of each supplier's notes),
--   NO products and no product categories: the product catalogue is real, imported from the F&O item master by Excel (Data Workbench,
--   Products import). Nothing in this script reads or points at a product: every line of every estimate, deal, quote and quotation is a
--   free-text description with a unit (for example "Precast foundation 1000 x 1000 x 1200", Nos),
--   1 estimate template (SAMPLE Precast building elements, every cost from the template's own rates) and 3 estimates built from it
--   (30, 21 and 25 cost lines: a villa compound and a warehouse frame that became the two accepted quotes, and a draft podium frame
--   attached to a deal),
--   8 deals on the pipeline: 3 tender deals (12, 14 and 10 BOQ lines: a received drainage package, a boundary wall and culvert package in
--   estimating with an RFQ, and a submitted culvert package with bid versions v1 and v2), 4 Standard-Quote-led deals (proposal, negotiation,
--   won, lost) and 1 early enquiry,
--   1 RFQ (4 lines, 2 suppliers, one replied with prices), 2 bid versions, 2 competitors, 2 logged calls,
--   6 Standard Quotes (draft, 2 sent, 2 accepted, 1 rejected; the two accepted ones were made from estimates),
--   2 Quotations (1 sent, 1 draft),
--   1 contract project made from the accepted estimate quote SQ-SMP-0004, with its contract lines as budget lines, a baseline revision in
--   Draft and a small WBS of two buildings (6 work packages). The other accepted estimate quote, SQ-SMP-0005, has NO project on purpose:
--   open it and press Create contract project; then on the project press Fill from estimate costs.
--
-- NOT MADE, because it cannot be made safely from SQL: any e-mail or phone of an account or a contact (the app encrypts them on write
-- and SQL has no key), users and sign-ins, uploaded files (so no tender BOQ source file, no attachments, no logos), e-mails in the Inbox,
-- bid cost snapshots (internal), buy-out packages, invoices, purchasing, service, WFM and marketing records (those modules are off for
-- PCBS), and any change to the workspace's settings, feature flags, product categories or number ranges. Deal owners are left empty on
-- purpose so no closing-date reminder is e-mailed to anybody.
--
-- Dates are relative to now(), so the data always looks current. All amounts are SAR.

begin;

-- ------------------------------------------------------------------------------------------------------------------------------------
-- Helpers that live only for this session (pg_temp).
--   pcbs_id(kind, n)   the reserved id of the n-th sample record of a kind. Kinds:
--     1 accounts, 2 contacts, 3 suppliers, (4 is not used: no products), 5 estimate_templates, 6 estimates, 7 estimate_lines, 8 opportunities,
--     9 opportunity_lines, 11 tender_bid_versions, 12 rfqs, 13 rfq_lines, 14 rfq_suppliers, 15 rfq_responses, 16 standard_quotes,
--     17 standard_quote_lines, 18 quotes, 19 quote_lines, 20 quote_revisions, 21 contract_projects, 22 project_budget_revisions,
--     23 project_budget_lines, 24 project_work_packages, 25 project_work_package_lines, 26 project_work_package_line_parts,
--     27 opportunity_competitors, 28 deal_activities, 29 budget line keys.
--     (opportunity_tenders has no id of its own: its key is the deal's id.)
--   pcbs_ref(table, tenant, prefix)   the next free ACC-#### style ref of the workspace, the way the app makes it.
-- ------------------------------------------------------------------------------------------------------------------------------------
create or replace function pg_temp.pcbs_id(p_kind int, p_n int) returns uuid
language sql immutable as $f$
  select ('5a3b1e00-5a3b-4000-8000-' || lpad(to_hex(p_kind), 4, '0') || lpad(to_hex(p_n), 8, '0'))::uuid
$f$;

create or replace function pg_temp.pcbs_next(p_table text, p_tenant uuid, p_prefix text) returns int
language plpgsql as $f$
declare
  n int;
begin
  execute format('select coalesce(max(substring(ref from %L)::int), 0) + 1 from %I where tenant_id = $1 and ref ~ %L',
                 '^' || p_prefix || '-(\d+)$', p_table, '^' || p_prefix || '-\d+$')
    into n using p_tenant;
  return n;
end $f$;

create or replace function pg_temp.pcbs_ref(p_table text, p_tenant uuid, p_prefix text) returns text
language plpgsql as $f$
begin
  return p_prefix || '-' || lpad(pg_temp.pcbs_next(p_table, p_tenant, p_prefix)::text, 4, '0');
end $f$;

-- =====================================================================================================================================
-- BLOCK 0 -- PREFLIGHT. Finds the workspace; with none, says so and writes nothing in any block. With one, checks that every table and
-- column the script writes exists, and stops with a plain message (nothing written) when a migration has not been run yet.
-- =====================================================================================================================================
do $preflight$
declare
  t uuid;
  v_missing text := '';
  c text;
begin
  select id into t from tenants where slug = 'pcbs';
  if t is null then
    raise notice 'No workspace with slug pcbs was found in this database. PCBS sample data: nothing was created.';
    return;
  end if;
  foreach c in array array[
    'accounts', 'contacts', 'suppliers', 'estimate_templates', 'estimates', 'estimate_lines', 'opportunities', 'opportunity_lines',
    'opportunity_tenders', 'tender_bid_versions', 'opportunity_competitors', 'deal_activities', 'rfqs', 'rfq_lines', 'rfq_suppliers', 'rfq_responses',
    'standard_quotes', 'standard_quote_lines', 'quotes', 'quote_lines', 'quote_revisions', 'contract_projects', 'project_budget_revisions',
    'project_budget_lines', 'project_work_packages', 'project_work_package_lines', 'project_work_package_line_parts'
  ] loop
    if to_regclass('public.' || c) is null then v_missing := v_missing || ' table ' || c || ';'; end if;
  end loop;
  foreach c in array array[
    'standard_quotes.source_type', 'standard_quotes.revision_state', 'contract_projects.source_type',
    'estimate_templates.locked', 'estimate_templates.visual', 'estimates.opportunity_id', 'project_work_packages.parent_id',
    'project_budget_lines.allocated', 'opportunity_tenders.bond_status'
  ] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = split_part(c, '.', 1) and column_name = split_part(c, '.', 2)) then
      v_missing := v_missing || ' column ' || c || ';';
    end if;
  end loop;
  if v_missing <> '' then
    raise exception 'Run the missing migrations first (this script needs 0248, 0250, 0251 and 0252 and everything before them). Missing:%. Nothing was written.', v_missing;
  end if;
end $preflight$;

-- =====================================================================================================================================
-- BLOCK 1 -- ACCOUNTS, CONTACTS, SUPPLIERS. No e-mail and no phone on accounts and contacts. Supplier e-mails use the .example domain.
-- =====================================================================================================================================
do $master$
declare
  t uuid;
  r record;
begin
  select id into t from tenants where slug = 'pcbs';
  if t is null then
    raise notice 'No workspace with slug pcbs here. Master data: nothing was created.';
    return;
  end if;

  for r in select * from (values
    (1,  'SAMPLE Najd Horizon Developments',            'direct',       'Riyadh',   'Riyadh Region',    'Real estate developer',            '200-500',  'Residential compounds in north Riyadh. Buys foundations, columns, beams and hollow-core floors by the package.'),
    (2,  'SAMPLE Sahab Urban Development Co.',          'direct',       'Jeddah',   'Makkah Region',    'Real estate developer',            '200-500',  'Warehouse and light-industrial parks on the Jeddah ring road. Prefers a precast frame to steel.'),
    (3,  'SAMPLE Tuwaiq Valley Contracting',            'direct',       'Riyadh',   'Riyadh Region',    'Main contractor',                  '1000+',    'Builds residential towers; buys stairs, landings and slabs from the factory and erects with its own crews.'),
    (4,  'SAMPLE Marsa Gulf Construction',              'direct',       'Dammam',   'Eastern Province', 'Main contractor',                  '500-1000', 'Industrial yards and perimeter walls in the Eastern Province.'),
    (5,  'SAMPLE Qasr Al Sharq Properties',             'end_customer', 'Al Khobar', 'Eastern Province', 'Commercial real estate',          '50-200',   'Retail podium and offices on the Khobar corniche.'),
    (6,  'SAMPLE Wadi Hanifa Engineering Consultants',  'prospect',     'Riyadh',   'Riyadh Region',    'Consulting engineers (specifier)', '50-200',   'Specifies precast systems on public housing; influences the tender documents, does not buy.'),
    (7,  'SAMPLE Eastern Region Projects Office',       'prospect',     'Dammam',   'Eastern Province', 'Government projects office',       '200-500',  'Issues road and drainage tenders for the Eastern Province.'),
    (8,  'SAMPLE Northern Provinces Public Works Authority', 'prospect', 'Tabuk',   'Tabuk Region',     'Government authority',             '500-1000', 'Issues drainage and culvert tenders through its tender committee.'),
    (9,  'SAMPLE Red Coast Housing Programme',          'prospect',     'Jeddah',   'Makkah Region',    'Government housing programme',     '200-500',  'Boundary walls and services for new housing districts.'),
    (10, 'SAMPLE Dune Logistics Park Company',          'end_customer', 'Riyadh',   'Riyadh Region',    'Logistics real estate',            '50-200',   'Warehouse floors and yards; quoted once and lost on price.')
  ) as v(n, nm, ty, city, st, ind, emp, nt) loop
    if not exists (select 1 from accounts a where a.tenant_id = t and a.id = pg_temp.pcbs_id(1, r.n)) then
      insert into accounts (id, tenant_id, ref, name, type, city, state, country, industry, employee_count, notes)
      values (pg_temp.pcbs_id(1, r.n), t, pg_temp.pcbs_ref('accounts', t, 'ACC'), r.nm, r.ty, r.city, r.st, 'Saudi Arabia', r.ind, r.emp, r.nt);
    end if;
  end loop;

  for r in select * from (values
    (1,  1,  'SAMPLE Faisal Al-Dossari',      'Procurement Manager',      'Procurement'),
    (2,  1,  'SAMPLE Reem Al-Qahtani',        'Project Manager',          'Projects'),
    (3,  2,  'SAMPLE Turki Al-Shehri',        'Procurement Officer',      'Procurement'),
    (4,  2,  'SAMPLE Hanan Bakhsh',           'Structural Engineer',      'Engineering'),
    (5,  3,  'SAMPLE Majed Al-Anazi',         'Project Manager',          'Projects'),
    (6,  3,  'SAMPLE Yousef Al-Harbi',        'Procurement Lead',         'Procurement'),
    (7,  4,  'SAMPLE Nawaf Al-Otaibi',        'Site Engineer',            'Engineering'),
    (8,  4,  'SAMPLE Salman Al-Ghamdi',       'Contracts Manager',        'Commercial'),
    (9,  5,  'SAMPLE Dana Al-Mutairi',        'Project Manager',          'Projects'),
    (10, 6,  'SAMPLE Abdulrahman Al-Zahrani', 'Principal Engineer',       'Design'),
    (11, 7,  'SAMPLE Layla Al-Subaie',        'Tender Secretary',         'Procurement'),
    (12, 7,  'SAMPLE Khalid Al-Rasheed',      'Project Engineer',         'Engineering'),
    (13, 8,  'SAMPLE Mansour Al-Balawi',      'Tender Committee Secretary', 'Procurement'),
    (14, 9,  'SAMPLE Ghada Al-Juhani',        'Procurement Officer',      'Housing procurement'),
    (15, 10, 'SAMPLE Omar Al-Fayez',          'Development Manager',      'Projects')
  ) as v(n, acc, nm, rl, dept) loop
    if not exists (select 1 from contacts c where c.tenant_id = t and c.id = pg_temp.pcbs_id(2, r.n)) then
      insert into contacts (id, tenant_id, ref, account_id, name, role, department, country)
      values (pg_temp.pcbs_id(2, r.n), t, pg_temp.pcbs_ref('contacts', t, 'CON'), pg_temp.pcbs_id(1, r.acc), r.nm, r.rl, r.dept, 'Saudi Arabia');
    end if;
  end loop;

  for r in select * from (values
    (1, 'SAMPLE Eastern Cement and Aggregates Co.', 'vendor',        'Dammam', 'sales@eastern-cement.example',   'Category: cement, aggregates and sand. Delivery by tanker or tipper; 30-day price validity.'),
    (2, 'SAMPLE Najd Rebar and Steel Trading',      'vendor',        'Riyadh', 'orders@najd-rebar.example',      'Category: reinforcement steel B500, mesh, cut and bent to schedule.'),
    (3, 'SAMPLE Gulf Admix Chemicals',              'vendor',        'Jubail', 'quotes@gulf-admix.example',      'Category: admixtures, curing compounds, release agents, grout and sealants.'),
    (4, 'SAMPLE Formwork Systems Arabia',           'vendor',        'Riyadh', 'sales@formwork-arabia.example',  'Category: steel moulds, formwork and mould hire for precast elements.'),
    (5, 'SAMPLE Lifting and Anchor Supplies',       'vendor',        'Jeddah', 'sales@lifting-anchor.example',   'Category: lifting inserts, anchors, elastomeric bearing pads and fixings.'),
    (6, 'SAMPLE Hollow Core Plank Works',           'vendor',        'Dammam', 'sales@hollowcore-works.example', 'Category: hollow-core planks 200 to 320 mm, bought in when the factory line is full.'),
    (7, 'SAMPLE Al Sahra Heavy Haulage',            'subcontractor', 'Riyadh', 'dispatch@sahra-haulage.example', 'Category: transport. Low-bed trailers, escort vehicles and permits.'),
    (8, 'SAMPLE Tuwaiq Erection Crews',             'subcontractor', 'Riyadh', 'planning@tuwaiq-erection.example', 'Category: erection crews and mobile cranes from 80 to 250 tonnes.')
  ) as v(n, nm, ty, city, em, nt) loop
    if not exists (select 1 from suppliers s where s.tenant_id = t and s.id = pg_temp.pcbs_id(3, r.n)) then
      insert into suppliers (id, tenant_id, ref, name, type, city, email, notes, status)
      values (pg_temp.pcbs_id(3, r.n), t, pg_temp.pcbs_ref('suppliers', t, 'SUP'), r.nm, r.ty, r.city, r.em, r.nt, 'active');
    end if;
  end loop;
end $master$;

-- =====================================================================================================================================
-- BLOCK 2 -- DEALS. 3 tender deals with their BOQ lines (the deal lines) and 5 other deals on the pipeline. The Standard-Quote-led deals get
-- their amount from their quote in block 4. Owners are left empty on purpose.
-- =====================================================================================================================================
do $deals$
declare
  t uuid;
  v_cur text;
  cfg jsonb;
  v_dt uuid;
  v_open text[];
  v_won text;
  v_lost text;
  s_early text;
  s_mid text;
  s_late text;
  r record;
  v_stage text;
begin
  select id, coalesce(nullif(config->>'currency', ''), 'SAR'), coalesce(config, '{}'::jsonb) into t, v_cur, cfg from tenants where slug = 'pcbs';
  if t is null then
    raise notice 'No workspace with slug pcbs here. Deals: nothing was created.';
    return;
  end if;

  -- The workspace's own pipeline stage values (Settings > Sales), or the standard ones.
  select coalesce(array_agg(e.x->>'value' order by e.o) filter (where not coalesce((e.x->>'is_closed')::boolean, false)), '{}'::text[]),
         (array_agg(e.x->>'value' order by e.o) filter (where e.x->>'outcome' = 'won'))[1],
         (array_agg(e.x->>'value' order by e.o) filter (where e.x->>'outcome' = 'lost'))[1]
    into v_open, v_won, v_lost
  from jsonb_array_elements(case when jsonb_typeof(cfg->'opportunity_stages') = 'array' then cfg->'opportunity_stages' else '[]'::jsonb end) with ordinality as e(x, o);
  if cardinality(v_open) = 0 then v_open := array['qualify', 'propose', 'negotiate']; end if;
  s_early := v_open[1];
  s_mid := v_open[least(2, cardinality(v_open))];
  s_late := v_open[cardinality(v_open)];
  v_won := coalesce(v_won, 'won');
  v_lost := coalesce(v_lost, 'lost');

  -- The workspace's 'tender' deal type, if the app has already made it (the app makes it on the first tender; this script does not).
  select id into v_dt from deal_types where tenant_id = t and code = 'tender';

  -- ---- The three tender deals ----------------------------------------------------------------------------------------------------
  for r in select * from (values
    (1, 'SAMPLE Tender NPW-2026-118 - Precast drainage structures, Tabuk Package 2',        8, 13, 'received',   'open',   10, 18,  3, 'NPW-2026-118', 'SAMPLE Northern Provinces Public Works Authority', 'other', null::numeric,  null::int, 'Tender just received through the authority portal. Box culverts, headwalls and manhole chambers for the Tabuk drainage scheme. Nothing is priced yet.'),
    (2, 'SAMPLE Tender RCH-2026-042 - Precast boundary walls and culverts, Jeddah housing', 9, 14, 'estimating', 'open',   25,  9, 20, 'RCH-2026-042', 'SAMPLE Red Coast Housing Programme',                'email', 90000,             90,       'Boundary wall panels, posts and base beams for a new housing district, plus culverts at the road crossings. The fixings are out to two suppliers.'),
    (3, 'SAMPLE Tender ERP-2026-027 - Precast box culverts and manholes, Eastern region roads', 7, 11, 'submitted', 'open', 40, -3, 45, 'ERP-2026-027', 'SAMPLE Eastern Region Projects Office',            'excel', 250000,            75,       'Bid submitted twice: the first price, then a revised price after the clarification meeting. Waiting for the evaluation.')
  ) as v(n, nm, acc, con, stg, outc, prob, close_days, created_ago, tno, issuer, portal, bond, bond_days, descr) loop
    if not exists (select 1 from opportunities o where o.tenant_id = t and o.id = pg_temp.pcbs_id(8, r.n)) then
      insert into opportunities (id, tenant_id, ref, account_id, contact_id, source, title, description, stage, outcome, expected_close, amount, currency, probability, team, created_at, updated_at)
      values (pg_temp.pcbs_id(8, r.n), t, pg_temp.pcbs_ref('opportunities', t, 'OPP'), pg_temp.pcbs_id(1, r.acc), pg_temp.pcbs_id(2, r.con), 'direct', r.nm, r.descr,
              r.stg, r.outc, (now() + (r.close_days || ' days')::interval)::date, 0, v_cur, r.prob, '[]'::jsonb,
              now() - (r.created_ago || ' days')::interval, now() - interval '1 day');

      insert into opportunity_tenders (opportunity_id, tenant_id, deal_type_id, tender_no, issuer_name, issuer_account_id, portal, closing_at,
                                       bid_bond_amount, bid_bond_currency, bid_bond_expiry, addenda_count, decision, decision_reason, decided_at)
      values (pg_temp.pcbs_id(8, r.n), t, v_dt, r.tno, r.issuer, pg_temp.pcbs_id(1, r.acc), r.portal,
              date_trunc('day', now()) + (r.close_days || ' days')::interval + interval '12 hours',
              r.bond, case when r.bond is null then null else v_cur end, case when r.bond_days is null then null else current_date + r.bond_days end,
              case when r.n = 2 then 1 else 0 end,
              case when r.n = 1 then null else 'go' end,
              case when r.n = 1 then null else 'Precast supply is core work and the factory has capacity in this window.' end,
              case when r.n = 1 then null else now() - ((r.created_ago - 3) || ' days')::interval end);
    end if;
  end loop;

  -- The bid guarantee of the submitted tender is "issued" (the word needs migration 0228; an older database keeps its legacy value).
  begin
    update opportunity_tenders set bond_status = 'issued' where tenant_id = t and opportunity_id = pg_temp.pcbs_id(8, 3) and bond_status in ('held', 'requested');
  exception when check_violation then
    raise notice 'Migration 0228 is missing: the bid guarantee keeps its starting status.';
  end;

  -- The BOQ lines of the three tenders (the deal lines): sl_no, description, unit, quantity, rate. A rate of 0 is not priced yet.
  for r in select * from (values
    -- Tender 1: a received drainage package, nothing priced (12 lines)
    (1,  1, 'Excavation in ordinary soil',                              'm3',   8400,     0),
    (1,  2, 'Granular bedding under culverts and chambers',             'm3',   1900,     0),
    (1,  3, 'Precast box culvert 2000 x 1500 x 2500',                   'Nos',    54,     0),
    (1,  4, 'Precast box culvert 3000 x 2000 x 2500',                   'Nos',    28,     0),
    (1,  5, 'Precast headwall for culvert ends',                        'Nos',    16,     0),
    (1,  6, 'Precast manhole chamber 1200 dia',                         'Nos',    64,     0),
    (1,  7, 'Precast manhole cover slab',                               'Nos',    64,     0),
    (1,  8, 'Precast U-channel 600 mm',                                 'm',    1350,     0),
    (1,  9, 'Precast catch basin 900 x 900',                            'Nos',   120,     0),
    (1, 10, 'Joint sealing and waterproofing',                          'm',    3600,     0),
    (1, 11, 'Compacted backfill',                                       'm3',   6500,     0),
    (1, 12, 'Testing and handover',                                     'lot',     1,     0),
    -- Tender 2: boundary walls and culverts, estimating (14 lines): the four fixing lines wait for the RFQ
    (2,  1, 'Precast boundary wall panel 2500 x 2400 x 100',            'Nos',  1200,   640),
    (2,  2, 'Precast boundary wall post 2400',                          'Nos',  1260,   265),
    (2,  3, 'Precast boundary wall base beam',                          'm',    3000,   135),
    (2,  4, 'Precast box culvert 2000 x 2000 x 2500',                   'Nos',    36,     0),
    (2,  5, 'Precast box culvert 1500 x 1500 x 2500',                   'Nos',    24,     0),
    (2,  6, 'Precast headwall for culvert ends',                        'Nos',    20,     0),
    (2,  7, 'Precast manhole chamber 1500 dia',                         'Nos',    18,     0),
    (2,  8, 'Excavation and backfill for culverts',                     'm3',   2400,    45),
    (2,  9, 'Lifting insert 2.5 t',                                     'Nos',  1800,     0),
    (2, 10, 'Elastomeric bearing pad 200 x 300 x 20',                   'Nos',   400,     0),
    (2, 11, 'Non-shrink grout 25 kg bag',                               'bag',   600,     0),
    (2, 12, 'Joint sealant, polyurethane 600 ml',                       'Nos',   900,     0),
    (2, 13, 'Transport of elements to site',                            'load',  220,   850),
    (2, 14, 'Erection crew and mobile crane',                           'day',    95,  4000),
    -- Tender 3: culverts and manholes, submitted (10 lines, all priced; these are the rates of bid version 2)
    (3,  1, 'Precast box culvert 2000 x 2000 x 2500',                   'Nos',    40, 11800),
    (3,  2, 'Precast box culvert 1500 x 1500 x 2500',                   'Nos',    22,  8650),
    (3,  3, 'Precast headwall for culvert ends',                        'Nos',    14,  6200),
    (3,  4, 'Precast manhole chamber 1500 dia',                         'Nos',    26,  4350),
    (3,  5, 'Manhole cover and frame D400',                             'Nos',    26,   640),
    (3,  6, 'Precast U-channel 600 mm',                                 'm',     900,   410),
    (3,  7, 'Excavation and backfill',                                  'm3',   5200,    48),
    (3,  8, 'Bedding and blinding concrete',                            'm3',    640,   365),
    (3,  9, 'Joint sealing and waterproofing',                          'm',    1800,    22),
    (3, 10, 'Testing and commissioning',                                'lot',     1, 38000)
  ) as v(deal, sl, descr, um, qty, rate) loop
    if exists (select 1 from opportunities o where o.tenant_id = t and o.id = pg_temp.pcbs_id(8, r.deal))
       and not exists (select 1 from opportunity_lines l where l.tenant_id = t and l.id = pg_temp.pcbs_id(9, r.deal * 100 + r.sl)) then
      insert into opportunity_lines (id, tenant_id, opportunity_id, sl_no, description, uom, qty, rate, amount)
      values (pg_temp.pcbs_id(9, r.deal * 100 + r.sl), t, pg_temp.pcbs_id(8, r.deal), r.sl::text, r.descr, r.um, r.qty, r.rate, round(r.qty * r.rate, 2));
    end if;
  end loop;

  update opportunities o
  set amount = (select coalesce(sum(l.amount), 0) from opportunity_lines l where l.tenant_id = t and l.opportunity_id = o.id)
  where o.tenant_id = t and o.id in (pg_temp.pcbs_id(8, 1), pg_temp.pcbs_id(8, 2), pg_temp.pcbs_id(8, 3));

  -- ---- The five other deals on the pipeline ------------------------------------------------------------------------------------
  for r in select * from (values
    (4, 'SAMPLE Boundary wall and gatehouse, Marsa Gulf yard',           4,  7, 'mid',   'open',    50,  21,  16, null::int, 'direct',   null::text, null::text, null::text,
        'Perimeter wall for an industrial yard in Dammam; the quote is with the client.', 0::numeric),
    (5, 'SAMPLE Villa compound precast package, Najd Horizon',           1,  2, 'won',   'won',    100, -20,  75, 20,        'direct',   null,       null,       null,
        'Won. The accepted quote became a contract project.', 0),
    (6, 'SAMPLE Retail podium hollow-core floors, Qasr Al Sharq',        5,  9, 'late',  'open',    75,  10,  30, null,      'referral', null,       null,       null,
        'Negotiating the delivery programme and the discount.', 0),
    (7, 'SAMPLE Villa compound phase 3 enquiry, Najd Horizon',           1,  1, 'early', 'open',    20,  45,   5, null,      'referral', null,       null,       null,
        'Early enquiry from an existing customer; no quote yet.', 2600000),
    (8, 'SAMPLE Warehouse floor slabs, Dune Logistics Park',            10, 15, 'lost',  'lost',     0, -25,  60, 25,        'direct',   'price',    'Lost on price to a competitor with a bought-in plank.', 'SAMPLE Gulf Span Precast',
        'Lost: the client chose a lower price for the same floor.', 0)
  ) as v(n, nm, acc, con, stg, outc, prob, close_days, created_ago, closed_ago, src, loss, loss_note, comp, descr, amt) loop
    if not exists (select 1 from opportunities o where o.tenant_id = t and o.id = pg_temp.pcbs_id(8, r.n)) then
      v_stage := case r.stg when 'early' then s_early when 'mid' then s_mid when 'late' then s_late when 'won' then v_won else v_lost end;
      insert into opportunities (id, tenant_id, ref, account_id, contact_id, source, title, description, stage, outcome, loss_reason, loss_note, competitor, expected_close, amount, currency, probability, team, created_at, updated_at, closed_at)
      values (pg_temp.pcbs_id(8, r.n), t, pg_temp.pcbs_ref('opportunities', t, 'OPP'), pg_temp.pcbs_id(1, r.acc), pg_temp.pcbs_id(2, r.con), r.src, r.nm, r.descr,
              v_stage, r.outc, r.loss, r.loss_note, r.comp, (now() + (r.close_days || ' days')::interval)::date, r.amt, v_cur, r.prob, '[]'::jsonb,
              now() - (r.created_ago || ' days')::interval,
              case when r.closed_ago is null then now() - interval '1 day' else now() - (r.closed_ago || ' days')::interval end,
              case when r.closed_ago is null then null else now() - (r.closed_ago || ' days')::interval end);
    end if;
  end loop;
end $deals$;

-- =====================================================================================================================================
-- BLOCK 3 -- ESTIMATES. The sample template and three estimates with their cost lines (no product is used). GENERATED by scripts/gen-pcbs-sample-estimates.ts from the real estimator engine: do not edit by hand.
-- =====================================================================================================================================
-- BEGIN GENERATED ESTIMATES (scripts/gen-pcbs-sample-estimates.ts)
do $est$
declare
  t uuid;
  v_cur text;
  v_t2 uuid;
  v_t2_ver int;
begin
  select id, coalesce(nullif(config->>'currency', ''), 'SAR') into t, v_cur from tenants where slug = 'pcbs';
  if t is null then
    raise notice 'No workspace with slug pcbs here. Estimates: nothing was created.';
    return;
  end if;
  if to_regclass('public.estimates') is null or to_regclass('public.estimate_lines') is null or to_regclass('public.estimate_templates') is null then
    raise notice 'The estimator tables (migration 0131) are missing: no templates and no estimates were created.';
    return;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'estimate_templates' and column_name = 'locked')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'estimates' and column_name = 'opportunity_id') then
    raise notice 'Migrations 0213 and 0227 are missing: no templates and no estimates were created. Run them and run this script again.';
    return;
  end if;

  -- The sample template: the elements named the way the client names them, every cost from the template's own rates.
  select id, version into v_t2, v_t2_ver from estimate_templates where tenant_id = t and id = pg_temp.pcbs_id(5, 2);
  if v_t2 is null then
    insert into estimate_templates (id, tenant_id, name, description, trade, version, is_active, quote_granularity, inputs, rates, rules, keywords, icon, locked, customer_visible, visual)
      values (
        pg_temp.pcbs_id(5, 2), t, 'SAMPLE Precast building elements', 'Sample template for testing: a precast building priced by element (foundations, columns, beams, hollow-core floors, wall panels, stairs), with fixings, transport and erection. Every rate is an illustrative placeholder.', 'precast', 1, true, 'group',
        $inputs$[{"key":"found_n","label":"Foundations 1000 x 1000 x 1200","type":"number","default":400,"min":0,"max":20000,"unit":"Nos","section":"Elements"},{"key":"col_n","label":"Columns 400 x 400 x 4000","type":"number","default":100,"min":0,"max":20000,"unit":"Nos","section":"Elements"},{"key":"beam_n","label":"Beams 300 x 600 x 6000","type":"number","default":140,"min":0,"max":20000,"unit":"Nos","section":"Elements"},{"key":"slab_m2","label":"Hollow-core floor area, 200 mm","type":"number","default":4800,"min":0,"max":200000,"unit":"m2","section":"Elements"},{"key":"panel_n","label":"Sandwich wall panels 2500 x 3000 x 200","type":"number","default":0,"min":0,"max":20000,"unit":"Nos","section":"Elements"},{"key":"stair_n","label":"Staircase flights 1200 x 3300","type":"number","default":0,"min":0,"max":2000,"unit":"Nos","section":"Elements"},{"key":"haul_km","label":"Distance to site","type":"number","default":45,"min":0,"max":3000,"unit":"km","section":"Delivery"}]$inputs$::jsonb,
        $rates$[{"key":"concrete_density_t_m3","label":"Concrete density","unit":"t/m3","value":2.4},{"key":"concrete_waste_pct","label":"Wastage on concrete","unit":"%","value":2},{"key":"hc_t_per_m2","label":"Weight of a hollow-core plank per m2","unit":"t/m2","value":0.3},{"key":"rebar_kg_m3_found","label":"Reinforcement in foundations","unit":"kg/m3","value":85},{"key":"rebar_kg_m3_col","label":"Reinforcement in columns","unit":"kg/m3","value":220},{"key":"rebar_kg_m3_beam","label":"Reinforcement in beams","unit":"kg/m3","value":190},{"key":"rebar_kg_m3_wall","label":"Reinforcement in wall panels","unit":"kg/m3","value":70},{"key":"rebar_kg_m3_stair","label":"Reinforcement in stairs","unit":"kg/m3","value":150},{"key":"concrete_cost_m3","label":"Precast concrete, supplied","unit":"per m3","value":330,"low":297,"high":412},{"key":"rebar_cost_kg","label":"Reinforcement steel, cut and bent","unit":"per kg","value":3.2,"low":2.72,"high":4.32},{"key":"mould_cost_m3","label":"Mould usage","unit":"per m3","value":90,"low":80,"high":115},{"key":"casting_h_per_m3","label":"Casting and finishing hours per m3","unit":"h/m3","value":3.5,"low":3.1,"high":4.4},{"key":"casting_rate_hr","label":"Casting labour rate","unit":"per h","value":18,"low":16,"high":22},{"key":"hc_cost_m2","label":"Hollow-core plank 200 mm, supplied","unit":"per m2","value":145,"low":130,"high":170},{"key":"hc_stitch_cost_m2","label":"Joint grout between planks","unit":"per m2","value":6},{"key":"insulation_cost_m2","label":"Insulation board","unit":"per m2","value":38},{"key":"insert_cost_nr","label":"Lifting insert 2.5 t","unit":"per nr","value":32},{"key":"grout_cost_bag","label":"Non-shrink grout, 25 kg bag","unit":"per bag","value":44},{"key":"sealant_cost_nr","label":"Joint sealant, 600 ml","unit":"per nr","value":23},{"key":"transport_load_capacity_t","label":"Transport capacity per load","unit":"t/load","value":25},{"key":"transport_cost_load_km","label":"Transport cost per load and km","unit":"per load-km","value":4.5,"low":4,"high":6},{"key":"handling_cost_load","label":"Loading and unloading per load","unit":"per load","value":120},{"key":"erect_t_per_day","label":"Erection output of crane and crew","unit":"t/day","value":60},{"key":"crane_cost_day","label":"Mobile crane with operator","unit":"per day","value":2600,"low":2300,"high":3200},{"key":"erection_crew_cost_day","label":"Erection crew (four people)","unit":"per day","value":1400,"low":1250,"high":1700}]$rates$::jsonb,
        $rules$[{"code":"cf_conc","group":"Precast foundation 1000 x 1000 x 1200","description":"Foundations: concrete","uom":"m3","qty":"found_n * 1 * 1 * 1.2","waste_pct":"concrete_waste_pct","component":"materials","cost":{"kind":"rate","rate":"concrete_cost_m3"}},{"code":"cf_reb","group":"Precast foundation 1000 x 1000 x 1200","description":"Foundations: reinforcement","uom":"kg","qty":"qty_cf_conc * rebar_kg_m3_found","waste_pct":5,"component":"materials","cost":{"kind":"rate","rate":"rebar_cost_kg"}},{"code":"cf_mld","group":"Precast foundation 1000 x 1000 x 1200","description":"Foundations: moulds","uom":"m3","qty":"qty_cf_conc","component":"moulds","cost":{"kind":"rate","rate":"mould_cost_m3"}},{"code":"cf_lab","group":"Precast foundation 1000 x 1000 x 1200","description":"Foundations: casting labour","uom":"h","qty":"qty_cf_conc * casting_h_per_m3","component":"labour","cost":{"kind":"rate","rate":"casting_rate_hr"}},{"code":"cc_conc","group":"Precast column 400 x 400 x 4000","description":"Columns: concrete","uom":"m3","qty":"col_n * 0.4 * 0.4 * 4","waste_pct":"concrete_waste_pct","component":"materials","cost":{"kind":"rate","rate":"concrete_cost_m3"}},{"code":"cc_reb","group":"Precast column 400 x 400 x 4000","description":"Columns: reinforcement","uom":"kg","qty":"qty_cc_conc * rebar_kg_m3_col","waste_pct":5,"component":"materials","cost":{"kind":"rate","rate":"rebar_cost_kg"}},{"code":"cc_mld","group":"Precast column 400 x 400 x 4000","description":"Columns: moulds","uom":"m3","qty":"qty_cc_conc","component":"moulds","cost":{"kind":"rate","rate":"mould_cost_m3"}},{"code":"cc_lab","group":"Precast column 400 x 400 x 4000","description":"Columns: casting labour","uom":"h","qty":"qty_cc_conc * casting_h_per_m3","component":"labour","cost":{"kind":"rate","rate":"casting_rate_hr"}},{"code":"cb_conc","group":"Precast beam 300 x 600 x 6000","description":"Beams: concrete","uom":"m3","qty":"beam_n * 0.3 * 0.6 * 6","waste_pct":"concrete_waste_pct","component":"materials","cost":{"kind":"rate","rate":"concrete_cost_m3"}},{"code":"cb_reb","group":"Precast beam 300 x 600 x 6000","description":"Beams: reinforcement","uom":"kg","qty":"qty_cb_conc * rebar_kg_m3_beam","waste_pct":5,"component":"materials","cost":{"kind":"rate","rate":"rebar_cost_kg"}},{"code":"cb_mld","group":"Precast beam 300 x 600 x 6000","description":"Beams: moulds","uom":"m3","qty":"qty_cb_conc","component":"moulds","cost":{"kind":"rate","rate":"mould_cost_m3"}},{"code":"cb_lab","group":"Precast beam 300 x 600 x 6000","description":"Beams: casting labour","uom":"h","qty":"qty_cb_conc * casting_h_per_m3","component":"labour","cost":{"kind":"rate","rate":"casting_rate_hr"}},{"code":"ch_sup","group":"Hollow-core slab 200 mm","description":"Hollow-core planks 200 mm, supplied","uom":"m2","qty":"slab_m2","component":"materials","cost":{"kind":"rate","rate":"hc_cost_m2"}},{"code":"ch_jnt","group":"Hollow-core slab 200 mm","description":"Joint grout between planks","uom":"m2","qty":"slab_m2","component":"materials","cost":{"kind":"rate","rate":"hc_stitch_cost_m2"}},{"code":"cp_conc","group":"Precast sandwich wall panel 2500 x 3000 x 200","description":"Wall panels: concrete","uom":"m3","qty":"panel_n * 2.5 * 3 * 0.2","waste_pct":"concrete_waste_pct","component":"materials","cost":{"kind":"rate","rate":"concrete_cost_m3"}},{"code":"cp_reb","group":"Precast sandwich wall panel 2500 x 3000 x 200","description":"Wall panels: reinforcement","uom":"kg","qty":"qty_cp_conc * rebar_kg_m3_wall","waste_pct":5,"component":"materials","cost":{"kind":"rate","rate":"rebar_cost_kg"}},{"code":"cp_mld","group":"Precast sandwich wall panel 2500 x 3000 x 200","description":"Wall panels: moulds","uom":"m3","qty":"qty_cp_conc","component":"moulds","cost":{"kind":"rate","rate":"mould_cost_m3"}},{"code":"cp_lab","group":"Precast sandwich wall panel 2500 x 3000 x 200","description":"Wall panels: casting labour","uom":"h","qty":"qty_cp_conc * casting_h_per_m3","component":"labour","cost":{"kind":"rate","rate":"casting_rate_hr"}},{"code":"cp_ins","group":"Precast sandwich wall panel 2500 x 3000 x 200","description":"Wall panels: insulation board","uom":"m2","qty":"panel_n * 2.5 * 3","component":"materials","cost":{"kind":"rate","rate":"insulation_cost_m2"}},{"code":"cs_conc","group":"Precast staircase flight 1200 x 3300","description":"Staircase flights: concrete","uom":"m3","qty":"stair_n * 0.85","waste_pct":"concrete_waste_pct","component":"materials","cost":{"kind":"rate","rate":"concrete_cost_m3"}},{"code":"cs_reb","group":"Precast staircase flight 1200 x 3300","description":"Staircase flights: reinforcement","uom":"kg","qty":"qty_cs_conc * rebar_kg_m3_stair","waste_pct":5,"component":"materials","cost":{"kind":"rate","rate":"rebar_cost_kg"}},{"code":"cs_mld","group":"Precast staircase flight 1200 x 3300","description":"Staircase flights: moulds","uom":"m3","qty":"qty_cs_conc","component":"moulds","cost":{"kind":"rate","rate":"mould_cost_m3"}},{"code":"cs_lab","group":"Precast staircase flight 1200 x 3300","description":"Staircase flights: casting labour","uom":"h","qty":"qty_cs_conc * casting_h_per_m3","component":"labour","cost":{"kind":"rate","rate":"casting_rate_hr"}},{"code":"fx_ins","group":"Lifting inserts and fixings","description":"Lifting inserts 2.5 t","uom":"nr","qty":"ceil((qty_cf_conc + qty_cc_conc + qty_cb_conc + qty_cp_conc + qty_cs_conc) / 1.2)","component":"materials","cost":{"kind":"rate","rate":"insert_cost_nr"}},{"code":"fx_grt","group":"Lifting inserts and fixings","description":"Non-shrink grout at column bases and bearings","uom":"bag","qty":"ceil(col_n * 1.5 + beam_n * 0.5)","component":"materials","cost":{"kind":"rate","rate":"grout_cost_bag"}},{"code":"fx_sea","group":"Lifting inserts and fixings","description":"Joint sealant","uom":"nr","qty":"ceil(panel_n * 0.6 + slab_m2 / 40)","component":"materials","cost":{"kind":"rate","rate":"sealant_cost_nr"}},{"code":"hlg","group":"Transport and erection","description":"Transport to site (loads by weight, by distance)","uom":"load-km","qty":"ceil(((qty_cf_conc + qty_cc_conc + qty_cb_conc + qty_cp_conc + qty_cs_conc) * concrete_density_t_m3 + slab_m2 * hc_t_per_m2) / transport_load_capacity_t) * haul_km","component":"transport","cost":{"kind":"rate","rate":"transport_cost_load_km"}},{"code":"hdl","group":"Transport and erection","description":"Loading and unloading","uom":"load","qty":"ceil(((qty_cf_conc + qty_cc_conc + qty_cb_conc + qty_cp_conc + qty_cs_conc) * concrete_density_t_m3 + slab_m2 * hc_t_per_m2) / transport_load_capacity_t)","component":"transport","cost":{"kind":"rate","rate":"handling_cost_load"}},{"code":"crn","group":"Transport and erection","description":"Erection crane (days by weight)","uom":"day","qty":"ceil(((qty_cf_conc + qty_cc_conc + qty_cb_conc + qty_cp_conc + qty_cs_conc) * concrete_density_t_m3 + slab_m2 * hc_t_per_m2) / erect_t_per_day)","component":"erection","cost":{"kind":"rate","rate":"crane_cost_day"}},{"code":"crw","group":"Transport and erection","description":"Erection crew (same days as the crane)","uom":"day","qty":"qty_crn","component":"erection","cost":{"kind":"rate","rate":"erection_crew_cost_day"}}]$rules$::jsonb,
        array['precast', 'foundations', 'columns', 'beams', 'hollow core', 'wall panels', 'stairs']::text[], 'building', false, false, null
      );
    select id, version into v_t2, v_t2_ver from estimate_templates where tenant_id = t and id = pg_temp.pcbs_id(5, 2);
  end if;

    -- SAMPLE Najd Horizon villa compound, precast package: 30 lines, cost 2012604.1, price 2374872.84, total incl. VAT 2731103.77
    if not exists (select 1 from estimates e where e.tenant_id = t and e.id = pg_temp.pcbs_id(6, 1)) then
      insert into estimates (id, tenant_id, ref, name, account_id, contact_id, template_id, template_version, status, params, currency, margin_pct, totals, model, notes, opportunity_id, created_at, updated_at)
      values (
        pg_temp.pcbs_id(6, 1), t, pg_temp.pcbs_ref('estimates', t, 'EST'), 'SAMPLE Najd Horizon villa compound, precast package',
        pg_temp.pcbs_id(1, 1), pg_temp.pcbs_id(2, 2), v_t2, v_t2_ver, 'draft',
        $params${"found_n":400,"col_n":96,"beam_n":140,"slab_m2":4800,"panel_n":220,"stair_n":16,"haul_km":40}$params$::jsonb, v_cur, 18,
        $totals${"cost_total":2012604.1,"by_group":[{"key":"precast_foundation_1000_x_1000_x_1200","name":"Precast foundation 1000 x 1000 x 1200","wbs_code":"1","line_count":4,"cost":372096},{"key":"precast_column_400_x_400_x_4000","name":"Precast column 400 x 400 x 4000","wbs_code":"2","line_count":4,"cost":75497.54},{"key":"precast_beam_300_x_600_x_6000","name":"Precast beam 300 x 600 x 6000","wbs_code":"3","line_count":4,"cost":170553.6},{"key":"hollow_core_slab_200_mm","name":"Hollow-core slab 200 mm","wbs_code":"4","line_count":2,"cost":724800},{"key":"precast_sandwich_wall_panel_2500_x_3000_x_200","name":"Precast sandwich wall panel 2500 x 3000 x 200","wbs_code":"5","line_count":5,"cost":301884},{"key":"precast_staircase_flight_1200_x_3300","name":"Precast staircase flight 1200 x 3300","wbs_code":"6","line_count":4,"cost":13512.96},{"key":"lifting_inserts_and_fixings","name":"Lifting inserts and fixings","wbs_code":"7","line_count":3,"cost":42860},{"key":"transport_and_erection","name":"Transport and erection","wbs_code":"8","line_count":4,"cost":311400}],"by_component":{"materials":1542659.38,"moulds":93261.6,"labour":65283.12,"overhead":0,"transport":47400,"erection":264000,"other":0},"margin_pct":18,"margin_amount":362268.74,"price":2374872.84,"vat_pct":15,"vat":356230.93,"price_incl_vat":2731103.77,"unpriced":[],"unresolved":[],"pricing":{},"warnings":[]}$totals$::jsonb || jsonb_build_object('computed_at', now()),
        null,
        'Sample for testing: made into the accepted quote SQ-SMP-0004, which became a contract project. Illustrative placeholder costs.', null, now() - interval '17 days', now() - interval '11 days'
      );
      insert into estimate_lines (id, tenant_id, estimate_id, sort_order, code, group_key, description, uom, qty, waste_pct, unit_cost, cost_total, component, source, wbs_code, custom_data)
      select pg_temp.pcbs_id(7, el.k), t, pg_temp.pcbs_id(6, 1), el.so, el.cd, el.gk, el.ds, el.um, el.qt, el.wp, el.uc, el.ct, el.cp,
             el.src, el.wbs, el.cu
      from (values
      (101, 0, 'cf_conc', 'precast_foundation_1000_x_1000_x_1200', 'Foundations: concrete', 'm3', 480, 2, 330, 161568, 'materials', 'rule', '1.1', $cd${"group":"Precast foundation 1000 x 1000 x 1200"}$cd$::jsonb),
      (102, 1, 'cf_reb', 'precast_foundation_1000_x_1000_x_1200', 'Foundations: reinforcement', 'kg', 40800, 5, 3.2, 137088, 'materials', 'rule', '1.2', $cd${"group":"Precast foundation 1000 x 1000 x 1200"}$cd$::jsonb),
      (103, 2, 'cf_mld', 'precast_foundation_1000_x_1000_x_1200', 'Foundations: moulds', 'm3', 480, 0, 90, 43200, 'moulds', 'rule', '1.3', $cd${"group":"Precast foundation 1000 x 1000 x 1200"}$cd$::jsonb),
      (104, 3, 'cf_lab', 'precast_foundation_1000_x_1000_x_1200', 'Foundations: casting labour', 'h', 1680, 0, 18, 30240, 'labour', 'rule', '1.4', $cd${"group":"Precast foundation 1000 x 1000 x 1200"}$cd$::jsonb),
      (105, 4, 'cc_conc', 'precast_column_400_x_400_x_4000', 'Columns: concrete', 'm3', 61.44, 2, 330, 20680.77, 'materials', 'rule', '2.1', $cd${"group":"Precast column 400 x 400 x 4000"}$cd$::jsonb),
      (106, 5, 'cc_reb', 'precast_column_400_x_400_x_4000', 'Columns: reinforcement', 'kg', 13516.8, 5, 3.2, 45416.45, 'materials', 'rule', '2.2', $cd${"group":"Precast column 400 x 400 x 4000"}$cd$::jsonb),
      (107, 6, 'cc_mld', 'precast_column_400_x_400_x_4000', 'Columns: moulds', 'm3', 61.44, 0, 90, 5529.6, 'moulds', 'rule', '2.3', $cd${"group":"Precast column 400 x 400 x 4000"}$cd$::jsonb),
      (108, 7, 'cc_lab', 'precast_column_400_x_400_x_4000', 'Columns: casting labour', 'h', 215.04, 0, 18, 3870.72, 'labour', 'rule', '2.4', $cd${"group":"Precast column 400 x 400 x 4000"}$cd$::jsonb),
      (109, 8, 'cb_conc', 'precast_beam_300_x_600_x_6000', 'Beams: concrete', 'm3', 151.2, 2, 330, 50893.92, 'materials', 'rule', '3.1', $cd${"group":"Precast beam 300 x 600 x 6000"}$cd$::jsonb),
      (110, 9, 'cb_reb', 'precast_beam_300_x_600_x_6000', 'Beams: reinforcement', 'kg', 28728, 5, 3.2, 96526.08, 'materials', 'rule', '3.2', $cd${"group":"Precast beam 300 x 600 x 6000"}$cd$::jsonb),
      (111, 10, 'cb_mld', 'precast_beam_300_x_600_x_6000', 'Beams: moulds', 'm3', 151.2, 0, 90, 13608, 'moulds', 'rule', '3.3', $cd${"group":"Precast beam 300 x 600 x 6000"}$cd$::jsonb),
      (112, 11, 'cb_lab', 'precast_beam_300_x_600_x_6000', 'Beams: casting labour', 'h', 529.2, 0, 18, 9525.6, 'labour', 'rule', '3.4', $cd${"group":"Precast beam 300 x 600 x 6000"}$cd$::jsonb),
      (113, 12, 'ch_sup', 'hollow_core_slab_200_mm', 'Hollow-core planks 200 mm, supplied', 'm2', 4800, 0, 145, 696000, 'materials', 'rule', '4.1', $cd${"group":"Hollow-core slab 200 mm"}$cd$::jsonb),
      (114, 13, 'ch_jnt', 'hollow_core_slab_200_mm', 'Joint grout between planks', 'm2', 4800, 0, 6, 28800, 'materials', 'rule', '4.2', $cd${"group":"Hollow-core slab 200 mm"}$cd$::jsonb),
      (115, 14, 'cp_conc', 'precast_sandwich_wall_panel_2500_x_3000_x_200', 'Wall panels: concrete', 'm3', 330, 2, 330, 111078, 'materials', 'rule', '5.1', $cd${"group":"Precast sandwich wall panel 2500 x 3000 x 200"}$cd$::jsonb),
      (116, 15, 'cp_reb', 'precast_sandwich_wall_panel_2500_x_3000_x_200', 'Wall panels: reinforcement', 'kg', 23100, 5, 3.2, 77616, 'materials', 'rule', '5.2', $cd${"group":"Precast sandwich wall panel 2500 x 3000 x 200"}$cd$::jsonb),
      (117, 16, 'cp_mld', 'precast_sandwich_wall_panel_2500_x_3000_x_200', 'Wall panels: moulds', 'm3', 330, 0, 90, 29700, 'moulds', 'rule', '5.3', $cd${"group":"Precast sandwich wall panel 2500 x 3000 x 200"}$cd$::jsonb),
      (118, 17, 'cp_lab', 'precast_sandwich_wall_panel_2500_x_3000_x_200', 'Wall panels: casting labour', 'h', 1155, 0, 18, 20790, 'labour', 'rule', '5.4', $cd${"group":"Precast sandwich wall panel 2500 x 3000 x 200"}$cd$::jsonb),
      (119, 18, 'cp_ins', 'precast_sandwich_wall_panel_2500_x_3000_x_200', 'Wall panels: insulation board', 'm2', 1650, 0, 38, 62700, 'materials', 'rule', '5.5', $cd${"group":"Precast sandwich wall panel 2500 x 3000 x 200"}$cd$::jsonb),
      (120, 19, 'cs_conc', 'precast_staircase_flight_1200_x_3300', 'Staircase flights: concrete', 'm3', 13.6, 2, 330, 4577.76, 'materials', 'rule', '6.1', $cd${"group":"Precast staircase flight 1200 x 3300"}$cd$::jsonb),
      (121, 20, 'cs_reb', 'precast_staircase_flight_1200_x_3300', 'Staircase flights: reinforcement', 'kg', 2040, 5, 3.2, 6854.4, 'materials', 'rule', '6.2', $cd${"group":"Precast staircase flight 1200 x 3300"}$cd$::jsonb),
      (122, 21, 'cs_mld', 'precast_staircase_flight_1200_x_3300', 'Staircase flights: moulds', 'm3', 13.6, 0, 90, 1224, 'moulds', 'rule', '6.3', $cd${"group":"Precast staircase flight 1200 x 3300"}$cd$::jsonb),
      (123, 22, 'cs_lab', 'precast_staircase_flight_1200_x_3300', 'Staircase flights: casting labour', 'h', 47.6, 0, 18, 856.8, 'labour', 'rule', '6.4', $cd${"group":"Precast staircase flight 1200 x 3300"}$cd$::jsonb),
      (124, 23, 'fx_ins', 'lifting_inserts_and_fixings', 'Lifting inserts 2.5 t', 'nr', 864, 0, 32, 27648, 'materials', 'rule', '7.1', $cd${"group":"Lifting inserts and fixings"}$cd$::jsonb),
      (125, 24, 'fx_grt', 'lifting_inserts_and_fixings', 'Non-shrink grout at column bases and bearings', 'bag', 214, 0, 44, 9416, 'materials', 'rule', '7.2', $cd${"group":"Lifting inserts and fixings"}$cd$::jsonb),
      (126, 25, 'fx_sea', 'lifting_inserts_and_fixings', 'Joint sealant', 'nr', 252, 0, 23, 5796, 'materials', 'rule', '7.3', $cd${"group":"Lifting inserts and fixings"}$cd$::jsonb),
      (127, 26, 'hlg', 'transport_and_erection', 'Transport to site (loads by weight, by distance)', 'load-km', 6320, 0, 4.5, 28440, 'transport', 'rule', '8.1', $cd${"group":"Transport and erection"}$cd$::jsonb),
      (128, 27, 'hdl', 'transport_and_erection', 'Loading and unloading', 'load', 158, 0, 120, 18960, 'transport', 'rule', '8.2', $cd${"group":"Transport and erection"}$cd$::jsonb),
      (129, 28, 'crn', 'transport_and_erection', 'Erection crane (days by weight)', 'day', 66, 0, 2600, 171600, 'erection', 'rule', '8.3', $cd${"group":"Transport and erection"}$cd$::jsonb),
      (130, 29, 'crw', 'transport_and_erection', 'Erection crew (same days as the crane)', 'day', 66, 0, 1400, 92400, 'erection', 'rule', '8.4', $cd${"group":"Transport and erection"}$cd$::jsonb)
      ) as el(k, so, cd, gk, ds, um, qt, wp, uc, ct, cp, src, wbs, cu);
    end if;

    -- SAMPLE Sahab warehouse frame, precast package: 21 lines, cost 1579999.88, price 1832799.86, total incl. VAT 2107719.84
    if not exists (select 1 from estimates e where e.tenant_id = t and e.id = pg_temp.pcbs_id(6, 2)) then
      insert into estimates (id, tenant_id, ref, name, account_id, contact_id, template_id, template_version, status, params, currency, margin_pct, totals, model, notes, opportunity_id, created_at, updated_at)
      values (
        pg_temp.pcbs_id(6, 2), t, pg_temp.pcbs_ref('estimates', t, 'EST'), 'SAMPLE Sahab warehouse frame, precast package',
        pg_temp.pcbs_id(1, 2), pg_temp.pcbs_id(2, 3), v_t2, v_t2_ver, 'draft',
        $params${"found_n":180,"col_n":90,"beam_n":120,"slab_m2":6200,"panel_n":0,"stair_n":0,"haul_km":60}$params$::jsonb, v_cur, 16,
        $totals${"cost_total":1579999.88,"by_group":[{"key":"precast_foundation_1000_x_1000_x_1200","name":"Precast foundation 1000 x 1000 x 1200","wbs_code":"1","line_count":4,"cost":167443.2},{"key":"precast_column_400_x_400_x_4000","name":"Precast column 400 x 400 x 4000","wbs_code":"2","line_count":4,"cost":70778.88},{"key":"precast_beam_300_x_600_x_6000","name":"Precast beam 300 x 600 x 6000","wbs_code":"3","line_count":4,"cost":146188.8},{"key":"hollow_core_slab_200_mm","name":"Hollow-core slab 200 mm","wbs_code":"4","line_count":2,"cost":936200},{"key":"lifting_inserts_and_fixings","name":"Lifting inserts and fixings","wbs_code":"5","line_count":3,"cost":22929},{"key":"transport_and_erection","name":"Transport and erection","wbs_code":"6","line_count":4,"cost":236460}],"by_component":{"materials":1281850.28,"moulds":36288,"labour":25401.6,"overhead":0,"transport":44460,"erection":192000,"other":0},"margin_pct":16,"margin_amount":252799.98,"price":1832799.86,"vat_pct":15,"vat":274919.98,"price_incl_vat":2107719.84,"unpriced":[],"unresolved":[],"pricing":{},"warnings":[]}$totals$::jsonb || jsonb_build_object('computed_at', now()),
        null,
        'Sample for testing: made into the accepted quote SQ-SMP-0005, which has no contract project yet: press Create contract project on it. Illustrative placeholder costs.', null, now() - interval '20 days', now() - interval '12 days'
      );
      insert into estimate_lines (id, tenant_id, estimate_id, sort_order, code, group_key, description, uom, qty, waste_pct, unit_cost, cost_total, component, source, wbs_code, custom_data)
      select pg_temp.pcbs_id(7, el.k), t, pg_temp.pcbs_id(6, 2), el.so, el.cd, el.gk, el.ds, el.um, el.qt, el.wp, el.uc, el.ct, el.cp,
             el.src, el.wbs, el.cu
      from (values
      (201, 0, 'cf_conc', 'precast_foundation_1000_x_1000_x_1200', 'Foundations: concrete', 'm3', 216, 2, 330, 72705.6, 'materials', 'rule', '1.1', $cd${"group":"Precast foundation 1000 x 1000 x 1200"}$cd$::jsonb),
      (202, 1, 'cf_reb', 'precast_foundation_1000_x_1000_x_1200', 'Foundations: reinforcement', 'kg', 18360, 5, 3.2, 61689.6, 'materials', 'rule', '1.2', $cd${"group":"Precast foundation 1000 x 1000 x 1200"}$cd$::jsonb),
      (203, 2, 'cf_mld', 'precast_foundation_1000_x_1000_x_1200', 'Foundations: moulds', 'm3', 216, 0, 90, 19440, 'moulds', 'rule', '1.3', $cd${"group":"Precast foundation 1000 x 1000 x 1200"}$cd$::jsonb),
      (204, 3, 'cf_lab', 'precast_foundation_1000_x_1000_x_1200', 'Foundations: casting labour', 'h', 756, 0, 18, 13608, 'labour', 'rule', '1.4', $cd${"group":"Precast foundation 1000 x 1000 x 1200"}$cd$::jsonb),
      (205, 4, 'cc_conc', 'precast_column_400_x_400_x_4000', 'Columns: concrete', 'm3', 57.6, 2, 330, 19388.16, 'materials', 'rule', '2.1', $cd${"group":"Precast column 400 x 400 x 4000"}$cd$::jsonb),
      (206, 5, 'cc_reb', 'precast_column_400_x_400_x_4000', 'Columns: reinforcement', 'kg', 12672, 5, 3.2, 42577.92, 'materials', 'rule', '2.2', $cd${"group":"Precast column 400 x 400 x 4000"}$cd$::jsonb),
      (207, 6, 'cc_mld', 'precast_column_400_x_400_x_4000', 'Columns: moulds', 'm3', 57.6, 0, 90, 5184, 'moulds', 'rule', '2.3', $cd${"group":"Precast column 400 x 400 x 4000"}$cd$::jsonb),
      (208, 7, 'cc_lab', 'precast_column_400_x_400_x_4000', 'Columns: casting labour', 'h', 201.6, 0, 18, 3628.8, 'labour', 'rule', '2.4', $cd${"group":"Precast column 400 x 400 x 4000"}$cd$::jsonb),
      (209, 8, 'cb_conc', 'precast_beam_300_x_600_x_6000', 'Beams: concrete', 'm3', 129.6, 2, 330, 43623.36, 'materials', 'rule', '3.1', $cd${"group":"Precast beam 300 x 600 x 6000"}$cd$::jsonb),
      (210, 9, 'cb_reb', 'precast_beam_300_x_600_x_6000', 'Beams: reinforcement', 'kg', 24624, 5, 3.2, 82736.64, 'materials', 'rule', '3.2', $cd${"group":"Precast beam 300 x 600 x 6000"}$cd$::jsonb),
      (211, 10, 'cb_mld', 'precast_beam_300_x_600_x_6000', 'Beams: moulds', 'm3', 129.6, 0, 90, 11664, 'moulds', 'rule', '3.3', $cd${"group":"Precast beam 300 x 600 x 6000"}$cd$::jsonb),
      (212, 11, 'cb_lab', 'precast_beam_300_x_600_x_6000', 'Beams: casting labour', 'h', 453.6, 0, 18, 8164.8, 'labour', 'rule', '3.4', $cd${"group":"Precast beam 300 x 600 x 6000"}$cd$::jsonb),
      (213, 12, 'ch_sup', 'hollow_core_slab_200_mm', 'Hollow-core planks 200 mm, supplied', 'm2', 6200, 0, 145, 899000, 'materials', 'rule', '4.1', $cd${"group":"Hollow-core slab 200 mm"}$cd$::jsonb),
      (214, 13, 'ch_jnt', 'hollow_core_slab_200_mm', 'Joint grout between planks', 'm2', 6200, 0, 6, 37200, 'materials', 'rule', '4.2', $cd${"group":"Hollow-core slab 200 mm"}$cd$::jsonb),
      (215, 14, 'fx_ins', 'lifting_inserts_and_fixings', 'Lifting inserts 2.5 t', 'nr', 337, 0, 32, 10784, 'materials', 'rule', '5.1', $cd${"group":"Lifting inserts and fixings"}$cd$::jsonb),
      (216, 15, 'fx_grt', 'lifting_inserts_and_fixings', 'Non-shrink grout at column bases and bearings', 'bag', 195, 0, 44, 8580, 'materials', 'rule', '5.2', $cd${"group":"Lifting inserts and fixings"}$cd$::jsonb),
      (217, 16, 'fx_sea', 'lifting_inserts_and_fixings', 'Joint sealant', 'nr', 155, 0, 23, 3565, 'materials', 'rule', '5.3', $cd${"group":"Lifting inserts and fixings"}$cd$::jsonb),
      (218, 17, 'hlg', 'transport_and_erection', 'Transport to site (loads by weight, by distance)', 'load-km', 6840, 0, 4.5, 30780, 'transport', 'rule', '6.1', $cd${"group":"Transport and erection"}$cd$::jsonb),
      (219, 18, 'hdl', 'transport_and_erection', 'Loading and unloading', 'load', 114, 0, 120, 13680, 'transport', 'rule', '6.2', $cd${"group":"Transport and erection"}$cd$::jsonb),
      (220, 19, 'crn', 'transport_and_erection', 'Erection crane (days by weight)', 'day', 48, 0, 2600, 124800, 'erection', 'rule', '6.3', $cd${"group":"Transport and erection"}$cd$::jsonb),
      (221, 20, 'crw', 'transport_and_erection', 'Erection crew (same days as the crane)', 'day', 48, 0, 1400, 67200, 'erection', 'rule', '6.4', $cd${"group":"Transport and erection"}$cd$::jsonb)
      ) as el(k, so, cd, gk, ds, um, qt, wp, uc, ct, cp, src, wbs, cu);
    end if;

    -- SAMPLE Retail podium frame, Qasr Al Sharq: 25 lines, cost 1114457.05, price 1281625.61, total incl. VAT 1473869.45
    if not exists (select 1 from estimates e where e.tenant_id = t and e.id = pg_temp.pcbs_id(6, 3)) then
      insert into estimates (id, tenant_id, ref, name, account_id, contact_id, template_id, template_version, status, params, currency, margin_pct, totals, model, notes, opportunity_id, created_at, updated_at)
      values (
        pg_temp.pcbs_id(6, 3), t, pg_temp.pcbs_ref('estimates', t, 'EST'), 'SAMPLE Retail podium frame, Qasr Al Sharq',
        pg_temp.pcbs_id(1, 5), pg_temp.pcbs_id(2, 9), v_t2, v_t2_ver, 'draft',
        $params${"found_n":60,"col_n":44,"beam_n":64,"slab_m2":5000,"panel_n":0,"stair_n":8,"haul_km":90}$params$::jsonb, v_cur, 15,
        $totals${"cost_total":1114457.05,"by_group":[{"key":"precast_foundation_1000_x_1000_x_1200","name":"Precast foundation 1000 x 1000 x 1200","wbs_code":"1","line_count":4,"cost":55814.4},{"key":"precast_column_400_x_400_x_4000","name":"Precast column 400 x 400 x 4000","wbs_code":"2","line_count":4,"cost":34602.94},{"key":"precast_beam_300_x_600_x_6000","name":"Precast beam 300 x 600 x 6000","wbs_code":"3","line_count":4,"cost":77967.23},{"key":"hollow_core_slab_200_mm","name":"Hollow-core slab 200 mm","wbs_code":"4","line_count":2,"cost":755000},{"key":"precast_staircase_flight_1200_x_3300","name":"Precast staircase flight 1200 x 3300","wbs_code":"5","line_count":4,"cost":6756.48},{"key":"lifting_inserts_and_fixings","name":"Lifting inserts and fixings","wbs_code":"6","line_count":3,"cost":11891},{"key":"transport_and_erection","name":"Transport and erection","wbs_code":"7","line_count":4,"cost":172425}],"by_component":{"materials":915091.81,"moulds":15847.2,"labour":11093.04,"overhead":0,"transport":40425,"erection":132000,"other":0},"margin_pct":15,"margin_amount":167168.56,"price":1281625.61,"vat_pct":15,"vat":192243.84,"price_incl_vat":1473869.45,"unpriced":[],"unresolved":[],"pricing":{},"warnings":[]}$totals$::jsonb || jsonb_build_object('computed_at', now()),
        null,
        'Sample for testing: a draft estimate attached to the podium deal; no quote yet, press Create quote. Illustrative placeholder costs.', pg_temp.pcbs_id(8, 6), now() - interval '23 days', now() - interval '13 days'
      );
      insert into estimate_lines (id, tenant_id, estimate_id, sort_order, code, group_key, description, uom, qty, waste_pct, unit_cost, cost_total, component, source, wbs_code, custom_data)
      select pg_temp.pcbs_id(7, el.k), t, pg_temp.pcbs_id(6, 3), el.so, el.cd, el.gk, el.ds, el.um, el.qt, el.wp, el.uc, el.ct, el.cp,
             el.src, el.wbs, el.cu
      from (values
      (301, 0, 'cf_conc', 'precast_foundation_1000_x_1000_x_1200', 'Foundations: concrete', 'm3', 72, 2, 330, 24235.2, 'materials', 'rule', '1.1', $cd${"group":"Precast foundation 1000 x 1000 x 1200"}$cd$::jsonb),
      (302, 1, 'cf_reb', 'precast_foundation_1000_x_1000_x_1200', 'Foundations: reinforcement', 'kg', 6120, 5, 3.2, 20563.2, 'materials', 'rule', '1.2', $cd${"group":"Precast foundation 1000 x 1000 x 1200"}$cd$::jsonb),
      (303, 2, 'cf_mld', 'precast_foundation_1000_x_1000_x_1200', 'Foundations: moulds', 'm3', 72, 0, 90, 6480, 'moulds', 'rule', '1.3', $cd${"group":"Precast foundation 1000 x 1000 x 1200"}$cd$::jsonb),
      (304, 3, 'cf_lab', 'precast_foundation_1000_x_1000_x_1200', 'Foundations: casting labour', 'h', 252, 0, 18, 4536, 'labour', 'rule', '1.4', $cd${"group":"Precast foundation 1000 x 1000 x 1200"}$cd$::jsonb),
      (305, 4, 'cc_conc', 'precast_column_400_x_400_x_4000', 'Columns: concrete', 'm3', 28.16, 2, 330, 9478.59, 'materials', 'rule', '2.1', $cd${"group":"Precast column 400 x 400 x 4000"}$cd$::jsonb),
      (306, 5, 'cc_reb', 'precast_column_400_x_400_x_4000', 'Columns: reinforcement', 'kg', 6195.2, 5, 3.2, 20815.87, 'materials', 'rule', '2.2', $cd${"group":"Precast column 400 x 400 x 4000"}$cd$::jsonb),
      (307, 6, 'cc_mld', 'precast_column_400_x_400_x_4000', 'Columns: moulds', 'm3', 28.16, 0, 90, 2534.4, 'moulds', 'rule', '2.3', $cd${"group":"Precast column 400 x 400 x 4000"}$cd$::jsonb),
      (308, 7, 'cc_lab', 'precast_column_400_x_400_x_4000', 'Columns: casting labour', 'h', 98.56, 0, 18, 1774.08, 'labour', 'rule', '2.4', $cd${"group":"Precast column 400 x 400 x 4000"}$cd$::jsonb),
      (309, 8, 'cb_conc', 'precast_beam_300_x_600_x_6000', 'Beams: concrete', 'm3', 69.12, 2, 330, 23265.66, 'materials', 'rule', '3.1', $cd${"group":"Precast beam 300 x 600 x 6000"}$cd$::jsonb),
      (310, 9, 'cb_reb', 'precast_beam_300_x_600_x_6000', 'Beams: reinforcement', 'kg', 13132.8, 5, 3.2, 44126.21, 'materials', 'rule', '3.2', $cd${"group":"Precast beam 300 x 600 x 6000"}$cd$::jsonb),
      (311, 10, 'cb_mld', 'precast_beam_300_x_600_x_6000', 'Beams: moulds', 'm3', 69.12, 0, 90, 6220.8, 'moulds', 'rule', '3.3', $cd${"group":"Precast beam 300 x 600 x 6000"}$cd$::jsonb),
      (312, 11, 'cb_lab', 'precast_beam_300_x_600_x_6000', 'Beams: casting labour', 'h', 241.92, 0, 18, 4354.56, 'labour', 'rule', '3.4', $cd${"group":"Precast beam 300 x 600 x 6000"}$cd$::jsonb),
      (313, 12, 'ch_sup', 'hollow_core_slab_200_mm', 'Hollow-core planks 200 mm, supplied', 'm2', 5000, 0, 145, 725000, 'materials', 'rule', '4.1', $cd${"group":"Hollow-core slab 200 mm"}$cd$::jsonb),
      (314, 13, 'ch_jnt', 'hollow_core_slab_200_mm', 'Joint grout between planks', 'm2', 5000, 0, 6, 30000, 'materials', 'rule', '4.2', $cd${"group":"Hollow-core slab 200 mm"}$cd$::jsonb),
      (315, 14, 'cs_conc', 'precast_staircase_flight_1200_x_3300', 'Staircase flights: concrete', 'm3', 6.8, 2, 330, 2288.88, 'materials', 'rule', '5.1', $cd${"group":"Precast staircase flight 1200 x 3300"}$cd$::jsonb),
      (316, 15, 'cs_reb', 'precast_staircase_flight_1200_x_3300', 'Staircase flights: reinforcement', 'kg', 1020, 5, 3.2, 3427.2, 'materials', 'rule', '5.2', $cd${"group":"Precast staircase flight 1200 x 3300"}$cd$::jsonb),
      (317, 16, 'cs_mld', 'precast_staircase_flight_1200_x_3300', 'Staircase flights: moulds', 'm3', 6.8, 0, 90, 612, 'moulds', 'rule', '5.3', $cd${"group":"Precast staircase flight 1200 x 3300"}$cd$::jsonb),
      (318, 17, 'cs_lab', 'precast_staircase_flight_1200_x_3300', 'Staircase flights: casting labour', 'h', 23.8, 0, 18, 428.4, 'labour', 'rule', '5.4', $cd${"group":"Precast staircase flight 1200 x 3300"}$cd$::jsonb),
      (319, 18, 'fx_ins', 'lifting_inserts_and_fixings', 'Lifting inserts 2.5 t', 'nr', 147, 0, 32, 4704, 'materials', 'rule', '6.1', $cd${"group":"Lifting inserts and fixings"}$cd$::jsonb),
      (320, 19, 'fx_grt', 'lifting_inserts_and_fixings', 'Non-shrink grout at column bases and bearings', 'bag', 98, 0, 44, 4312, 'materials', 'rule', '6.2', $cd${"group":"Lifting inserts and fixings"}$cd$::jsonb),
      (321, 20, 'fx_sea', 'lifting_inserts_and_fixings', 'Joint sealant', 'nr', 125, 0, 23, 2875, 'materials', 'rule', '6.3', $cd${"group":"Lifting inserts and fixings"}$cd$::jsonb),
      (322, 21, 'hlg', 'transport_and_erection', 'Transport to site (loads by weight, by distance)', 'load-km', 6930, 0, 4.5, 31185, 'transport', 'rule', '7.1', $cd${"group":"Transport and erection"}$cd$::jsonb),
      (323, 22, 'hdl', 'transport_and_erection', 'Loading and unloading', 'load', 77, 0, 120, 9240, 'transport', 'rule', '7.2', $cd${"group":"Transport and erection"}$cd$::jsonb),
      (324, 23, 'crn', 'transport_and_erection', 'Erection crane (days by weight)', 'day', 33, 0, 2600, 85800, 'erection', 'rule', '7.3', $cd${"group":"Transport and erection"}$cd$::jsonb),
      (325, 24, 'crw', 'transport_and_erection', 'Erection crew (same days as the crane)', 'day', 33, 0, 1400, 46200, 'erection', 'rule', '7.4', $cd${"group":"Transport and erection"}$cd$::jsonb)
      ) as el(k, so, cd, gk, ds, um, qt, wp, uc, ct, cp, src, wbs, cu);
    end if;

  raise notice 'PCBS sample estimates are in place (3 estimates and the sample template).';
end $est$;
-- END GENERATED ESTIMATES

-- =====================================================================================================================================
-- BLOCK 4 -- STANDARD QUOTES. 6 quotes: draft, 2 sent, 2 accepted (made from the estimates), 1 rejected. Refs SQ-SMP-#### (a series of
-- their own). Quote 4 and 5 are the ones assembled from an estimate; their lines come from the engine (generated region below).
-- =====================================================================================================================================
do $sq$
declare
  t uuid;
  r record;
  v_sub numeric;
begin
  select id into t from tenants where slug = 'pcbs';
  if t is null then
    raise notice 'No workspace with slug pcbs here. Standard quotes: nothing was created.';
    return;
  end if;

  for r in select * from (values
    (1, 3,  5, 'draft',    'Precast staircases and landings, Tower B',       'Tower B residential, Riyadh',  0::numeric, 30, 4,  null::int, null::int, null::int, null::text, null::int),
    (2, 4,  7, 'sent',     'Precast boundary wall, Dammam yard',             'Marsa Gulf yard, Dammam',      0,          21, 18, 6,         null,      4,         'opportunity', 4),
    (3, 5,  9, 'sent',     'Hollow-core floors, retail podium',              'Qasr Al Sharq podium, Khobar', 2.5,        18, 25, 12,        null,      6,         'opportunity', 6),
    (4, 1,  2, 'accepted', 'Precast package, villa compound',                'Najd Horizon villa compound',  0,          30, 70, 50,        20,        5,         'estimate',    1),
    (5, 2,  3, 'accepted', 'Precast frame and floors, warehouse',            'Sahab warehouse, Jeddah',      0,          30, 45, 30,        8,         null,      'estimate',    2),
    (6, 10, 15, 'rejected', 'Hollow-core floor slabs, warehouse',            'Dune logistics park, Riyadh',  0,          30, 80, 55,        25,        8,         'opportunity', 8)
  ) as v(n, acc, con, st, subj, proj, disc, valid, inq_ago, sent_ago, closed_ago, deal, src, src_n) loop
    if not exists (select 1 from standard_quotes q where q.tenant_id = t and q.id = pg_temp.pcbs_id(16, r.n)) then
      insert into standard_quotes (id, tenant_id, ref, account_id, contact_id, status, valid_until, terms, notes, subtotal, total, header_discount_pct, tax_pct, shipping_amount,
                                   intro_text, inquiry_date, created_at, updated_at, sent_at, closed_at, opportunity_id, subject, project_title, source_type, source_id)
      values (pg_temp.pcbs_id(16, r.n), t, 'SQ-SMP-' || lpad(r.n::text, 4, '0'), pg_temp.pcbs_id(1, r.acc), pg_temp.pcbs_id(2, r.con), r.st,
              current_date + (case when r.st in ('accepted', 'rejected') then -10 else r.valid end),
              'Prices in SAR, excluding VAT (15 percent is added). Payment: 30 percent with the order, 60 percent against delivery, 10 percent after erection. Delivery to site by the factory; erection as listed.',
              'SAMPLE quote for testing. Illustrative placeholder prices.', 0, 0, r.disc, 15, 0,
              'Thank you for your enquiry. We are pleased to offer the precast elements below, manufactured in our factory to your drawings.',
              current_date - r.inq_ago, now() - ((r.inq_ago - 1) || ' days')::interval, now() - interval '1 day',
              case when r.sent_ago is null then null else now() - (r.sent_ago || ' days')::interval end,
              case when r.closed_ago is null then null else now() - (r.closed_ago || ' days')::interval end,
              case when r.deal is null then null else pg_temp.pcbs_id(8, r.deal) end,
              r.subj, r.proj, r.src,
              case when r.src = 'opportunity' then pg_temp.pcbs_id(8, r.src_n) when r.src = 'estimate' then pg_temp.pcbs_id(6, r.src_n) else null end);

      insert into standard_quote_lines (id, tenant_id, standard_quote_id, sl_no, description, uom, qty, rate, discount_pct, amount)
      select pg_temp.pcbs_id(17, l.q * 100 + l.sl), t, pg_temp.pcbs_id(16, l.q), l.sl::text, l.descr, l.um, l.qty, l.rate, l.disc,
             round(l.qty * l.rate * (1 - l.disc / 100.0), 2)
      from (values
        (1, 1, 'Precast staircase flight 1200 x 3300',        'Nos',  24, 1090.00, 0),
        (1, 2, 'Precast landing slab 1200 x 2400',            'Nos',  24,  630.00, 0),
        (1, 3, 'Lifting insert 2.5 t',                        'Nos',  96,   48.00, 0),
        (1, 4, 'Non-shrink grout 25 kg bag',                  'bag',  40,   62.00, 0),
        (2, 1, 'Precast boundary wall panel 2500 x 2400 x 100', 'Nos', 640,  590.00, 2),
        (2, 2, 'Precast boundary wall post 2400',             'Nos', 260,  265.00, 0),
        (2, 3, 'Precast boundary wall base beam',             'm',  1600,  135.00, 0),
        (2, 4, 'Joint sealant, polyurethane 600 ml',          'Nos', 320,   34.00, 0),
        (2, 5, 'Erection of boundary wall (crane and crew)',  'day',  18, 4000.00, 0),
        (3, 1, 'Hollow-core slab 200 mm',                     'm2', 3800,  205.00, 0),
        (3, 2, 'Hollow-core slab 265 mm',                     'm2', 1200,  245.00, 0),
        (3, 3, 'Elastomeric bearing pad 200 x 300 x 20',      'Nos', 380,   85.00, 0),
        (3, 4, 'Non-shrink grout 25 kg bag',                  'bag', 150,   62.00, 0),
        (3, 5, 'Delivery and crane erection',                 'lot',   1, 145000.00, 0),
        (6, 1, 'Hollow-core slab 265 mm',                     'm2', 9500,  245.00, 0),
        (6, 2, 'Precast column 400 x 400 x 4000',             'Nos',  84, 1080.00, 0),
        (6, 3, 'Precast beam 300 x 600 x 6000',               'Nos', 112, 1680.00, 0),
        (6, 4, 'Delivery and erection',                       'lot',   1, 310000.00, 0),
        -- GENERATED: the lines of the quotes made from the two estimates (quote, sl, description, unit, quantity, rate, discount)
-- BEGIN GENERATED QUOTE LINES (scripts/gen-pcbs-sample-estimates.ts)
      (4, 1, 'Precast foundation 1000 x 1000 x 1200', 'Nos', 400, 1097.68, 0),
      (4, 2, 'Precast column 400 x 400 x 4000', 'Nos', 96, 927.99, 0),
      (4, 3, 'Precast beam 300 x 600 x 6000', 'Nos', 140, 1437.52, 0),
      (4, 4, 'Hollow-core slab 200 mm', 'm2', 4800, 178.18, 0),
      (4, 5, 'Precast sandwich wall panel 2500 x 3000 x 200', 'Nos', 220, 1619.2, 0),
      (4, 6, 'Precast staircase flight 1200 x 3300', 'Nos', 16, 996.56, 0),
      (4, 7, 'Lifting inserts and fixings', 'lot', 1, 50575, 0),
      (4, 8, 'Transport and erection', 'lot', 1, 367452, 0),
      (5, 1, 'Precast foundation 1000 x 1000 x 1200', 'Nos', 180, 1079.08, 0),
      (5, 2, 'Precast column 400 x 400 x 4000', 'Nos', 90, 912.27, 0),
      (5, 3, 'Precast beam 300 x 600 x 6000', 'Nos', 120, 1413.16, 0),
      (5, 4, 'Hollow-core slab 200 mm', 'm2', 6200, 175.16, 0),
      (5, 5, 'Lifting inserts and fixings', 'lot', 1, 26598, 0),
      (5, 6, 'Transport and erection', 'lot', 1, 274294, 0)
-- END GENERATED QUOTE LINES
      ) as l(q, sl, descr, um, qty, rate, disc)
      where l.q = r.n;

      select coalesce(sum(l.amount), 0) into v_sub from standard_quote_lines l where l.tenant_id = t and l.standard_quote_id = pg_temp.pcbs_id(16, r.n);
      update standard_quotes q
      set subtotal = round(v_sub, 2),
          total = round((v_sub - v_sub * q.header_discount_pct / 100.0) * (1 + q.tax_pct / 100.0) + q.shipping_amount, 2)
      where q.tenant_id = t and q.id = pg_temp.pcbs_id(16, r.n);
    end if;
  end loop;

  -- The two accepted quotes were made from estimates: the estimate points at its quote and reads Quoted (as the app does).
  update estimates set standard_quote_id = pg_temp.pcbs_id(16, 4), status = 'quoted'
  where tenant_id = t and id = pg_temp.pcbs_id(6, 1) and standard_quote_id is null;
  update estimates set standard_quote_id = pg_temp.pcbs_id(16, 5), status = 'quoted'
  where tenant_id = t and id = pg_temp.pcbs_id(6, 2) and standard_quote_id is null;

  -- A deal led by a quote takes the quote's subtotal as its amount (the app does the same when a quote is linked).
  update opportunities o
  set amount = (select q.subtotal from standard_quotes q where q.tenant_id = t and q.opportunity_id = o.id order by q.created_at desc limit 1)
  where o.tenant_id = t and o.id in (pg_temp.pcbs_id(8, 4), pg_temp.pcbs_id(8, 5), pg_temp.pcbs_id(8, 6), pg_temp.pcbs_id(8, 8))
    and exists (select 1 from standard_quotes q where q.tenant_id = t and q.opportunity_id = o.id);
end $sq$;

-- =====================================================================================================================================
-- BLOCK 5 -- QUOTATIONS (the project quotations module). 2 quotes: one sent, one draft. Refs QT-SMP-####. Each has its first revision row.
-- =====================================================================================================================================
do $quotations$
declare
  t uuid;
  r record;
  v_sub numeric;
  v_disc numeric;
begin
  select id into t from tenants where slug = 'pcbs';
  if t is null then
    raise notice 'No workspace with slug pcbs here. Quotations: nothing was created.';
    return;
  end if;

  for r in select * from (values
    (1, 1, 2, 'sent',  'SAMPLE Precast villa compound, phase 2', 9, 21, 3::numeric,
        '<p>Supply and delivery of precast foundations, columns, beams, hollow-core floors and sandwich wall panels for 24 villas, with erection by the factory crew.</p><p>Drawings: structural set rev C, issued by the client.</p>'),
    (2, 3, 6, 'draft', 'SAMPLE Gatehouse and perimeter precast package', 2, 30, 0,
        '<p>Precast gatehouse frame and perimeter wall panels for the contractor''s camp, delivered in two phases.</p>')
  ) as v(n, acc, con, st, nm, qdate_ago, valid, disc, scope) loop
    if not exists (select 1 from quotes q where q.tenant_id = t and q.id = pg_temp.pcbs_id(18, r.n)) then
      insert into quotes (id, tenant_id, account_id, ref, type, status, total, revision, notes, valid_until, created_at, updated_at, quote_date, name, contact_id,
                          scope_of_work, terms, discount_type, discount_pct, discount_fixed, gst_rate, outcome, inquiry_date, submitted_at)
      values (pg_temp.pcbs_id(18, r.n), t, pg_temp.pcbs_id(1, r.acc), 'QT-SMP-' || lpad(r.n::text, 4, '0'), 'quotation', r.st, 0, 1,
              'SAMPLE quotation for testing. Illustrative placeholder prices.', current_date + r.valid, now() - (r.qdate_ago || ' days')::interval, now() - interval '1 day',
              current_date - r.qdate_ago, r.nm, pg_temp.pcbs_id(2, r.con)::text, r.scope,
              'Prices in SAR. VAT at 15 percent is added. Payment: 30 percent with the order, 60 percent against delivery, 10 percent after erection.',
              'pct', r.disc, 0, 15, 'open', current_date - r.qdate_ago - 5,
              case when r.st = 'sent' then now() - (r.qdate_ago || ' days')::interval else null end);

      insert into quote_lines (id, tenant_id, quote_id, sl_no, description, uom, qty, rate, discount_pct, amount)
      select pg_temp.pcbs_id(19, l.q * 100 + l.sl), t, pg_temp.pcbs_id(18, l.q), l.sl::text, l.descr, l.um, l.qty, l.rate, 0,
             round(l.qty * l.rate, 2)
      from (values
        (1, 1, 'Precast foundation 1000 x 1000 x 1200',            'Nos',  160, 1290.00),
        (1, 2, 'Precast column 400 x 400 x 4000',                  'Nos',   64, 1080.00),
        (1, 3, 'Precast beam 300 x 600 x 6000',                    'Nos',   96, 1680.00),
        (1, 4, 'Hollow-core slab 200 mm',                          'm2',  3200,  205.00),
        (1, 5, 'Precast sandwich wall panel 2500 x 3000 x 200',    'Nos',  140, 1880.00),
        (1, 6, 'Delivery and erection',                            'lot',    1, 210000.00),
        (2, 1, 'Precast gatehouse frame (columns, beams and roof slab)', 'lot', 1, 96000.00),
        (2, 2, 'Precast boundary wall panel 2500 x 2400 x 100',    'Nos',  420,  590.00),
        (2, 3, 'Precast boundary wall post 2400',                  'Nos',  170,  265.00),
        (2, 4, 'Precast boundary wall base beam',                  'm',   1050,  135.00),
        (2, 5, 'Erection of gatehouse and wall',                   'day',   14, 4000.00)
      ) as l(q, sl, descr, um, qty, rate)
      where l.q = r.n;

      select coalesce(sum(l.amount), 0) into v_sub from quote_lines l where l.tenant_id = t and l.quote_id = pg_temp.pcbs_id(18, r.n);
      v_disc := round(v_sub * r.disc / 100);
      update quotes set total = v_sub - v_disc where tenant_id = t and id = pg_temp.pcbs_id(18, r.n);

      insert into quote_revisions (id, tenant_id, quote_id, rev, date, description)
      values (pg_temp.pcbs_id(20, r.n), t, pg_temp.pcbs_id(18, r.n), 1, current_date - r.qdate_ago, 'Initial draft');
    end if;
  end loop;
end $quotations$;

-- =====================================================================================================================================
-- BLOCK 6 -- TENDER DETAILS. Bid versions v1 and v2 of the submitted tender, two competitors and two logged calls.
-- =====================================================================================================================================
do $tender$
declare
  t uuid;
  v_cur text;
  r record;
begin
  select id, coalesce(nullif(config->>'currency', ''), 'SAR') into t, v_cur from tenants where slug = 'pcbs';
  if t is null then
    raise notice 'No workspace with slug pcbs here. Tender details: nothing was created.';
    return;
  end if;
  if not exists (select 1 from opportunities o where o.tenant_id = t and o.id = pg_temp.pcbs_id(8, 3)) then
    raise notice 'The sample tender deal is not there: bid versions, competitors and calls were skipped.';
    return;
  end if;

  -- Bid version 1 is the first price: the four precast lines were 5 percent higher. Version 2 is the deal as it stands now.
  for r in select * from (values (1, 25, null::text), (2, 11, 'The client asked for a lower price after the clarification meeting; the box culvert and headwall rates were reduced.')) as v(vn, ago, why) loop
    if not exists (select 1 from tender_bid_versions b where b.tenant_id = t and b.id = pg_temp.pcbs_id(11, r.vn)) then
      insert into tender_bid_versions (id, tenant_id, opportunity_id, version_no, submitted_at, currency, total, line_count, lines, note, revision_reason)
      select pg_temp.pcbs_id(11, r.vn), t, pg_temp.pcbs_id(8, 3), r.vn, now() - (r.ago || ' days')::interval, v_cur,
             coalesce(sum(round(l.qty * x.rate, 2)), 0), count(*)::int,
             coalesce(jsonb_agg(jsonb_build_object(
               'key', 'no:' || lower(l.sl_no), 'item_no', l.sl_no, 'description', l.description, 'unit', l.uom,
               'qty', l.qty, 'rate', x.rate, 'amount', round(l.qty * x.rate, 2),
               'product_ref', null,
               'price_source', 'Manual') order by l.sl_no::int), '[]'::jsonb),
             case when r.vn = 1 then 'First submission through the portal.' else 'Revised submission.' end,
             r.why
      from opportunity_lines l
      cross join lateral (select case when r.vn = 1 and l.sl_no::int <= 4 then round(l.rate * 1.05, 2) else l.rate end as rate) x
      where l.tenant_id = t and l.opportunity_id = pg_temp.pcbs_id(8, 3);
    end if;
  end loop;

  for r in select * from (values
    (1, 'SAMPLE Gulf Span Precast',        'lower',  'Large factory, usually bids low on standard culverts.',          1),
    (2, 'SAMPLE Riyadh Concrete Elements', 'higher', 'Strong on manholes and chambers, slower on programme.',         2)
  ) as v(n, nm, px, strengths, srt) loop
    if not exists (select 1 from opportunity_competitors c where c.tenant_id = t and c.id = pg_temp.pcbs_id(27, r.n)) then
      insert into opportunity_competitors (id, tenant_id, opportunity_id, name, expected_price, strengths, sort)
      values (pg_temp.pcbs_id(27, r.n), t, pg_temp.pcbs_id(8, 3), r.nm, r.px, r.strengths, r.srt);
    end if;
  end loop;

  for r in select * from (values
    (1, 'call',       'Call with the tender committee secretary',      'Confirmed both bid versions were received and are being evaluated.', null::text, null::date, 5),
    (2, 'site_visit', 'Site visit before the revised bid',             'Walked the culvert crossings with the client engineer; two headwalls moved.', 'Send the revised headwall drawings', current_date + 7, 20)
  ) as v(n, kd, summ, outc, nxt, due, ago) loop
    if not exists (select 1 from deal_activities a where a.tenant_id = t and a.id = pg_temp.pcbs_id(28, r.n)) then
      insert into deal_activities (id, tenant_id, opportunity_id, kind, occurred_at, with_whom, summary, outcome, next_step, next_step_due)
      values (pg_temp.pcbs_id(28, r.n), t, pg_temp.pcbs_id(8, 3), r.kd, now() - (r.ago || ' days')::interval, 'Projects office staff', r.summ, r.outc, r.nxt, r.due);
    end if;
  end loop;
end $tender$;

-- =====================================================================================================================================
-- BLOCK 7 -- RFQ. The fixings and sealants of the boundary wall tender: 4 lines, sent to two suppliers, one replied with prices.
-- =====================================================================================================================================
do $rfq$
declare
  t uuid;
  v_cur text;
  v_n int;
  v_pr int;
  r record;
begin
  select id, coalesce(nullif(config->>'currency', ''), 'SAR') into t, v_cur from tenants where slug = 'pcbs';
  if t is null then
    raise notice 'No workspace with slug pcbs here. RFQ: nothing was created.';
    return;
  end if;
  if not exists (select 1 from opportunities o where o.tenant_id = t and o.id = pg_temp.pcbs_id(8, 2)) then
    raise notice 'The sample boundary wall tender is not there: the RFQ was skipped.';
    return;
  end if;

  if not exists (select 1 from rfqs q where q.tenant_id = t and q.id = pg_temp.pcbs_id(12, 1)) then
    v_n := pg_temp.pcbs_next('rfqs', t, 'RFQ');
    if to_regclass('public.pricing_rfqs') is not null then
      v_pr := pg_temp.pcbs_next('pricing_rfqs', t, 'RFQ');
      v_n := greatest(v_n, v_pr);
    end if;
    insert into rfqs (id, tenant_id, ref, title, status, origin_type, origin_id, origin_label, respond_by, required_by, delivery_terms, currency, notes_to_supplier, created_at, updated_at)
    values (pg_temp.pcbs_id(12, 1), t, 'RFQ-' || lpad(v_n::text, 4, '0'), 'SAMPLE RFQ - Fixings and sealants for the boundary wall tender', 'partially_replied', 'opportunity',
            pg_temp.pcbs_id(8, 2), (select o.ref from opportunities o where o.tenant_id = t and o.id = pg_temp.pcbs_id(8, 2)),
            current_date + 3, current_date + 40, 'DAP factory yard, Dammam', v_cur,
            'Sample request: please quote the four items below, valid for 30 days.', now() - interval '6 days', now() - interval '2 days');

    insert into rfq_lines (id, tenant_id, rfq_id, sl_no, description, spec, uom, qty)
    values
      (pg_temp.pcbs_id(13, 1), t, pg_temp.pcbs_id(12, 1), 1, 'Lifting insert 2.5 t',                    'Galvanised, with test certificate', 'Nos', 1800),
      (pg_temp.pcbs_id(13, 2), t, pg_temp.pcbs_id(12, 1), 2, 'Elastomeric bearing pad 200 x 300 x 20',  'Shore A 60',                        'Nos',  400),
      (pg_temp.pcbs_id(13, 3), t, pg_temp.pcbs_id(12, 1), 3, 'Non-shrink grout 25 kg bag',             'Cementitious, 60 MPa at 28 days',   'bag',  600),
      (pg_temp.pcbs_id(13, 4), t, pg_temp.pcbs_id(12, 1), 4, 'Joint sealant, polyurethane 600 ml',     'Grey, movement class 25',           'Nos',  900);

    -- The tender lines point at the RFQ lines they are waiting for.
    update opportunity_lines set rfq_line_id = pg_temp.pcbs_id(13, 1) where tenant_id = t and id = pg_temp.pcbs_id(9, 209);
    update opportunity_lines set rfq_line_id = pg_temp.pcbs_id(13, 2) where tenant_id = t and id = pg_temp.pcbs_id(9, 210);
    update opportunity_lines set rfq_line_id = pg_temp.pcbs_id(13, 3) where tenant_id = t and id = pg_temp.pcbs_id(9, 211);
    update opportunity_lines set rfq_line_id = pg_temp.pcbs_id(13, 4) where tenant_id = t and id = pg_temp.pcbs_id(9, 212);

    insert into rfq_suppliers (id, tenant_id, rfq_id, supplier_id, status, sent_at, viewed_at, replied_at, currency, valid_until, reply_source, supplier_quote_ref)
    values
      (pg_temp.pcbs_id(14, 1), t, pg_temp.pcbs_id(12, 1), pg_temp.pcbs_id(3, 5), 'replied', now() - interval '6 days', now() - interval '5 days', now() - interval '2 days', v_cur, current_date + 30, 'buyer', 'SAMPLE-LA-Q1'),
      (pg_temp.pcbs_id(14, 2), t, pg_temp.pcbs_id(12, 1), pg_temp.pcbs_id(3, 3), 'sent',    now() - interval '6 days', null, null, null, null, null, null);

    for r in select * from (values (1, 34.00, 10), (2, 61.00, 14), (3, 46.00, 7), (4, 25.00, 7)) as v(k, price, lead) loop
      insert into rfq_responses (id, tenant_id, rfq_supplier_id, rfq_line_id, status, unit_price, currency, fx_rate, lead_time_days, valid_until, source, submitted_at)
      values (pg_temp.pcbs_id(15, r.k), t, pg_temp.pcbs_id(14, 1), pg_temp.pcbs_id(13, r.k), 'quoted', r.price, v_cur, 1, r.lead, current_date + 30, 'buyer', now() - interval '2 days');
    end loop;
  end if;
end $rfq$;

-- =====================================================================================================================================
-- BLOCK 8 -- CONTRACT PROJECT. Made from the accepted estimate quote SQ-SMP-0004 exactly as the app makes it: the quote's lines are the
-- contract (quantity, unit, the client's rate and amount), no cost yet, a baseline revision in Draft. Plus a small WBS of two buildings.
-- The other accepted estimate quote, SQ-SMP-0005, has no project: press Create contract project on it.
-- =====================================================================================================================================
do $project$
declare
  t uuid;
  v_cur text;
  v_value numeric;
begin
  select id, coalesce(nullif(config->>'currency', ''), 'SAR') into t, v_cur from tenants where slug = 'pcbs';
  if t is null then
    raise notice 'No workspace with slug pcbs here. Contract project: nothing was created.';
    return;
  end if;
  if not exists (select 1 from standard_quotes q where q.tenant_id = t and q.id = pg_temp.pcbs_id(16, 4) and q.status = 'accepted') then
    raise notice 'The accepted sample quote SQ-SMP-0004 is not there: the contract project was skipped.';
    return;
  end if;
  if exists (select 1 from contract_projects p where p.tenant_id = t and p.id = pg_temp.pcbs_id(21, 1)) then
    return;
  end if;
  if exists (select 1 from contract_projects p where p.tenant_id = t and p.source_type = 'standard_quote' and p.source_id = pg_temp.pcbs_id(16, 4)) then
    raise notice 'The sample quote SQ-SMP-0004 already has a contract project made by hand: the sample project was skipped.';
    return;
  end if;

  select q.subtotal into v_value from standard_quotes q where q.tenant_id = t and q.id = pg_temp.pcbs_id(16, 4);

  insert into contract_projects (id, tenant_id, ref, name, account_id, source_opportunity_id, status, contract_value, currency, planned_start, planned_end,
                                 source_type, source_id, created_at, updated_at)
  values (pg_temp.pcbs_id(21, 1), t, pg_temp.pcbs_ref('contract_projects', t, 'CPR'), 'SAMPLE Najd Horizon Developments - SQ-SMP-0004',
          pg_temp.pcbs_id(1, 1), pg_temp.pcbs_id(8, 5), 'draft', v_value, v_cur, current_date + 14, current_date + 330,
          'standard_quote', pg_temp.pcbs_id(16, 4), now() - interval '18 days', now() - interval '3 days');

  insert into project_budget_revisions (id, tenant_id, project_id, rev_no, status, total, justification_text, created_at)
  values (pg_temp.pcbs_id(22, 1), t, pg_temp.pcbs_id(21, 1), 0, 'draft', 0, 'Contract lines from the quote; costs to be allocated.', now() - interval '18 days');

  -- One budget line per charged quote line: the client's rate and amount, no cost (allocated = false), the quote line as its source.
  insert into project_budget_lines (id, tenant_id, revision_id, project_id, line_no, line_key, resource_code, wbs, description, qty, unit, unit_cost, amount, cost_known,
                                    reserve, allocated, client_rate, client_amount, source_line_id)
  select pg_temp.pcbs_id(23, l.sl_no::int), t, pg_temp.pcbs_id(22, 1), pg_temp.pcbs_id(21, 1), l.sl_no::int, pg_temp.pcbs_id(29, l.sl_no::int), '11', l.sl_no, left(l.description, 500),
         l.qty, l.uom, 0, 0, true, false, false, l.rate, round(l.qty * l.rate, 2), l.id
  from standard_quote_lines l
  where l.tenant_id = t and l.standard_quote_id = pg_temp.pcbs_id(16, 4)
  order by l.sl_no::int;

  -- The WBS: two buildings, each with a foundations and frame package and a floors, walls and stairs package.
  insert into project_work_packages (id, tenant_id, project_id, parent_id, code, name, sort_order, note, created_at)
  values
    (pg_temp.pcbs_id(24, 1), t, pg_temp.pcbs_id(21, 1), null,                    '1',   'Building A',                                  1, null, now() - interval '17 days'),
    (pg_temp.pcbs_id(24, 2), t, pg_temp.pcbs_id(21, 1), pg_temp.pcbs_id(24, 1),  '1.1', 'Building A: foundations and frame',           1, 'Sample WBS for testing.', now() - interval '17 days'),
    (pg_temp.pcbs_id(24, 3), t, pg_temp.pcbs_id(21, 1), pg_temp.pcbs_id(24, 1),  '1.2', 'Building A: floors, walls and stairs',        2, null, now() - interval '17 days'),
    (pg_temp.pcbs_id(24, 4), t, pg_temp.pcbs_id(21, 1), null,                    '2',   'Building B',                                  2, null, now() - interval '17 days'),
    (pg_temp.pcbs_id(24, 5), t, pg_temp.pcbs_id(21, 1), pg_temp.pcbs_id(24, 4),  '2.1', 'Building B: foundations and frame',           1, null, now() - interval '17 days'),
    (pg_temp.pcbs_id(24, 6), t, pg_temp.pcbs_id(21, 1), pg_temp.pcbs_id(24, 4),  '2.2', 'Building B: floors, walls and stairs',        2, null, now() - interval '17 days');

  -- Lines that belong wholly to one package (wall panels and stairs to A floors, walls and stairs; fixings to A foundations and frame).
  insert into project_work_package_lines (id, tenant_id, project_id, package_id, line_key, sort_order)
  values
    (pg_temp.pcbs_id(25, 5), t, pg_temp.pcbs_id(21, 1), pg_temp.pcbs_id(24, 3), pg_temp.pcbs_id(29, 5), 1),
    (pg_temp.pcbs_id(25, 6), t, pg_temp.pcbs_id(21, 1), pg_temp.pcbs_id(24, 3), pg_temp.pcbs_id(29, 6), 2),
    (pg_temp.pcbs_id(25, 7), t, pg_temp.pcbs_id(21, 1), pg_temp.pcbs_id(24, 2), pg_temp.pcbs_id(29, 7), 1);

  -- Lines shared by both buildings are split by percent (foundations, columns, beams and transport 55/45; hollow-core floors 50/50).
  insert into project_work_package_line_parts (id, tenant_id, project_id, package_id, line_key, share_pct, sort_order)
  values
    (pg_temp.pcbs_id(26, 1),  t, pg_temp.pcbs_id(21, 1), pg_temp.pcbs_id(24, 2), pg_temp.pcbs_id(29, 1), 55, 1),
    (pg_temp.pcbs_id(26, 2),  t, pg_temp.pcbs_id(21, 1), pg_temp.pcbs_id(24, 5), pg_temp.pcbs_id(29, 1), 45, 2),
    (pg_temp.pcbs_id(26, 3),  t, pg_temp.pcbs_id(21, 1), pg_temp.pcbs_id(24, 2), pg_temp.pcbs_id(29, 2), 55, 1),
    (pg_temp.pcbs_id(26, 4),  t, pg_temp.pcbs_id(21, 1), pg_temp.pcbs_id(24, 5), pg_temp.pcbs_id(29, 2), 45, 2),
    (pg_temp.pcbs_id(26, 5),  t, pg_temp.pcbs_id(21, 1), pg_temp.pcbs_id(24, 2), pg_temp.pcbs_id(29, 3), 55, 1),
    (pg_temp.pcbs_id(26, 6),  t, pg_temp.pcbs_id(21, 1), pg_temp.pcbs_id(24, 5), pg_temp.pcbs_id(29, 3), 45, 2),
    (pg_temp.pcbs_id(26, 7),  t, pg_temp.pcbs_id(21, 1), pg_temp.pcbs_id(24, 3), pg_temp.pcbs_id(29, 4), 50, 1),
    (pg_temp.pcbs_id(26, 8),  t, pg_temp.pcbs_id(21, 1), pg_temp.pcbs_id(24, 6), pg_temp.pcbs_id(29, 4), 50, 2),
    (pg_temp.pcbs_id(26, 9),  t, pg_temp.pcbs_id(21, 1), pg_temp.pcbs_id(24, 2), pg_temp.pcbs_id(29, 8), 55, 1),
    (pg_temp.pcbs_id(26, 10), t, pg_temp.pcbs_id(21, 1), pg_temp.pcbs_id(24, 5), pg_temp.pcbs_id(29, 8), 45, 2);

  raise notice 'PCBS sample data is in place. Sign in as a PCBS user and look at Accounts, Pipeline, Tenders, Standard Quotes and Contract projects.';
end $project$;

commit;
