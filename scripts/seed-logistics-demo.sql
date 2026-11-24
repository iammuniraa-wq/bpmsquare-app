-- Sample data for the BPMSquare Logistics demo and template workspace (transport and fleet hire, GCC).
-- Run by hand in the PRODUCTION Supabase SQL editor, once the workspace exists (docs/instances/provision-logistics-tenant-2026-11-24.md).
--
-- Needs: migrations up to 0133 (item types) and the Standard Quotes tables (0053 to 0119). Nothing new is created: tables, only rows.
-- The workspace is found by its slug 'logistics'. If it is missing, or it is NOT flagged is_demo, the script stops before writing anything.
-- Touches only that workspace. Sends nothing anywhere. No users, no passwords, no e-mail or phone numbers (those columns are encrypted
-- by the app and stay empty here).
--
-- Idempotent: every record is skipped when its name / ref already exists for the workspace, so running twice adds nothing.
-- Does NOT change the feature flags (the Tenant Creation Studio set them). Standard Quotes, Products, Accounts, Contacts and Suppliers
-- must already be on.
--
-- What it sets up:
--   Currency: NOT touched. The workspace keeps whatever currency is set in Settings > General (rates below are plain numbers in that currency).
--   Item types: the manufacturing types are hidden and six fleet types are added (Fleet only, Fleet with driver, Driver by hour,
--     Operator or helper by hour, Customs and permits, Extras and waiting). Only written when the workspace has no custom item types yet.
--   Product categories for fleet (trailers, trucks, lifting, drivers, services and permits). Only written when none are set.
--   Product custom fields "Fleet details": payload (t), length, width, height (m), hydraulic, axles, ownership, permit zone.
--   21 catalogue items: 3 trailers, 7 trucks, 2 lifting units, 4 driver / operator lines, 5 services (list price + cost, in the workspace currency).
--   6 customers with one contact each, 4 external fleet suppliers.
--   1 Standard Quote template "Fleet quotation" (default when the workspace has no default yet).
--   3 sample Standard Quotes at three stages: sent (oversize haul), accepted (cross-border), draft (crane hire).
--
-- Names are fictional. To find them again later: accounts ref ACC-xxxx created today, or search the names below.

do $seed$
declare
  t uuid;
  v_demo boolean;
  v_cfg jsonb;
  r record;
  v_year text := to_char(now(), 'YYYY');
  v_tpl uuid;
  q_id uuid;
  c_terms constant text := E'1. Rates are in the currency shown on this quote and exclude VAT unless the quote shows a tax rate.\n2. Vehicle hire is charged per calendar day or part day. Hourly lines are charged from vehicle release to return.\n3. Two hours of waiting per stop are free. Further waiting is charged per hour at the rate on this quote.\n4. Customs duties, port charges and cross-border permit fees are for the client unless a line on this quote includes them.\n5. Cargo insurance is the client responsibility. Carrier liability is limited to the declared value on the consignment note.\n6. Payment within 30 days of invoice. Cancellation less than 24 hours before loading is charged at 50 percent of the first day.\n7. This quote is valid for 14 days.';
begin
  select id, coalesce(is_demo, false), coalesce(config, '{}'::jsonb) into t, v_demo, v_cfg from tenants where slug = 'logistics';
  if t is null then
    raise exception 'No workspace with slug logistics was found. Nothing was created.';
  end if;
  if not v_demo then
    raise exception 'The workspace logistics is not flagged is_demo. Run: update tenants set is_demo = true where slug = ''logistics''; then run this script again. Nothing was created.';
  end if;
  if to_regclass('public.standard_quotes') is null or to_regclass('public.standard_quote_templates') is null then
    raise exception 'The Standard Quote tables are missing. Nothing was created.';
  end if;

  -- ---- Helpers (live only for this session) ---------------------------------------------------------------------------------------
  create or replace function pg_temp.logi_ref(p_table text, p_tenant uuid, p_prefix text) returns text
  language plpgsql as $f$
  declare n int;
  begin
    execute format('select coalesce(max(substring(ref from %L)::int), 0) + 1 from %I where tenant_id = $1 and ref ~ %L',
                   '^' || p_prefix || '-(\d+)$', p_table, '^' || p_prefix || '-\d+$')
      into n using p_tenant;
    return p_prefix || '-' || lpad(n::text, 4, '0');
  end $f$;

  -- ---- Workspace settings: currency, item types, product categories ---------------------------------------------------------------
  if not (v_cfg ? 'item_types') then
    update tenants set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('item_types', jsonb_build_object(
      'hidden', jsonb_build_array('finished_product','semi_finished','raw_material','bought_out_component','consumable',
                                  'custom_made_to_order','tool_equipment','certification_document','bom_kit'),
      'custom', jsonb_build_array(
        jsonb_build_object('key','fleet_only','label','Fleet only','description','A vehicle or unit hired without a driver','stocked',false,'sellable',true,'purchasable',true),
        jsonb_build_object('key','fleet_with_driver','label','Fleet with driver','description','A vehicle hired together with its driver, by the hour','stocked',false,'sellable',true,'purchasable',true),
        jsonb_build_object('key','driver_hourly','label','Driver by hour','description','A licensed driver charged by the hour','stocked',false,'sellable',true,'purchasable',false),
        jsonb_build_object('key','operator_hourly','label','Operator or helper by hour','description','A crane operator or loading helper charged by the hour','stocked',false,'sellable',true,'purchasable',false),
        jsonb_build_object('key','customs','label','Customs and permits','description','Customs clearance and cross-border permits','stocked',false,'sellable',true,'purchasable',true),
        jsonb_build_object('key','extras','label','Extras and waiting','description','Escorts, route surveys and waiting time','stocked',false,'sellable',true,'purchasable',false)
      )
    )) where id = t;
  end if;

  if not (v_cfg ? 'product_categories') then
    update tenants set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('product_categories', '[
      {"code": "TRAILERS",         "name": "Trailers",            "subs": [{"code": "FLATBED", "name": "Flatbed"}, {"code": "LOWBED", "name": "Lowbed"}, {"code": "CURTAIN", "name": "Curtain-side"}]},
      {"code": "TRUCKS",           "name": "Trucks",              "subs": [{"code": "PRIME", "name": "Prime mover"}, {"code": "BOX", "name": "Box and tail-lift"}, {"code": "PICKUP", "name": "Pickup"}, {"code": "TIPPER", "name": "Tipper"}, {"code": "REEFER", "name": "Refrigerated"}]},
      {"code": "LIFTING",          "name": "Lifting",             "subs": [{"code": "CRANE", "name": "Crane truck"}, {"code": "FORKLIFT", "name": "Forklift"}]},
      {"code": "DRIVERS",          "name": "Drivers and crew",    "subs": [{"code": "DRIVER", "name": "Drivers"}, {"code": "OPERATOR", "name": "Operators"}, {"code": "HELPER", "name": "Helpers"}]},
      {"code": "SERVICES_PERMITS", "name": "Services and permits","subs": [{"code": "CUSTOMS", "name": "Customs"}, {"code": "PERMITS", "name": "Permits and surveys"}, {"code": "ESCORT", "name": "Escort"}, {"code": "EXTRAS", "name": "Extras and waiting"}]}
    ]'::jsonb) where id = t;
  end if;

  -- ---- Product custom fields: Fleet details ----------------------------------------------------------------------------------------
  insert into custom_fields (tenant_id, object_type, field_key, field_label, field_type, field_section, options, is_required, position)
  select t, 'product', v.k, v.l, v.ty, 'Fleet details', v.o, false, v.p
  from (values
    ('cf_payload_t',    'Payload or lift (t)',  'number', null::jsonb,                                       1),
    ('cf_length_m',     'Length (m)',           'number', null::jsonb,                                       2),
    ('cf_width_m',      'Width (m)',            'number', null::jsonb,                                       3),
    ('cf_height_m',     'Height (m)',           'number', null::jsonb,                                       4),
    ('cf_hydraulic',    'Hydraulic',            'select', '["Yes","No"]'::jsonb,                           5),
    ('cf_axles',        'Axles',                'number', null::jsonb,                                       6),
    ('cf_ownership',    'Fleet source',         'select', '["Own fleet","External"]'::jsonb,                      7),
    ('cf_permit_zone',  'Permit zone',          'select', '["UAE only","GCC cross-border"]'::jsonb,               8)
  ) as v(k, l, ty, o, p)
  where not exists (select 1 from custom_fields f where f.tenant_id = t and f.object_type = 'product' and f.field_key = v.k);

  -- ---- Suppliers (external fleet partners) ----------------------------------------------------------------------------------------
  for r in select * from (values
    ('Gulf Haulage Services LLC'),
    ('Al Khaleej Heavy Transport'),
    ('Oman Lowbed Carriers'),
    ('Qatar Crane and Rigging')
  ) as v(nm) loop
    if not exists (select 1 from suppliers s where s.tenant_id = t and s.name = r.nm) then
      insert into suppliers (tenant_id, ref, name, type, status)
      values (t, pg_temp.logi_ref('suppliers', t, 'SUP'), r.nm, 'vendor', 'active');
    end if;
  end loop;

  -- ---- Customers and one contact each ---------------------------------------------------------------------------------------------
  for r in select * from (values
    ('Emirates Steel Fabrication LLC',   'direct',   'Abu Dhabi',   'Khalid Al Mansoori',   'Logistics manager'),
    ('Doha Marine Contracting',          'direct',   'Doha',        'Faisal Al Thani',      'Procurement manager'),
    ('Riyadh Industrial Equipment Co',   'direct',   'Riyadh',      'Omar Al Qahtani',      'Operations manager'),
    ('Muscat Power Projects',            'prospect', 'Muscat',      'Salim Al Harthy',      'Project coordinator'),
    ('Jebel Ali Freight Forwarders',     'oem',      'Dubai',       'Rashid Al Falasi',     'Operations lead'),
    ('Kuwait Oilfield Services',         'prospect', 'Kuwait City', 'Yousef Al Sabah',      'Logistics coordinator')
  ) as v(nm, ty, city, contact, role) loop
    if not exists (select 1 from accounts a where a.tenant_id = t and a.name = r.nm) then
      insert into accounts (tenant_id, ref, name, type, city)
      values (t, pg_temp.logi_ref('accounts', t, 'ACC'), r.nm, r.ty, r.city);
    end if;
    if not exists (select 1 from contacts c where c.tenant_id = t and c.name = r.contact) then
      insert into contacts (tenant_id, ref, account_id, name, role)
      values (t, pg_temp.logi_ref('contacts', t, 'CON'),
              (select a.id from accounts a where a.tenant_id = t and a.name = r.nm), r.contact, r.role);
    end if;
  end loop;

  -- ---- Catalogue: fleet, crew and services ----------------------------------------------------------------------------------------
  for r in select * from (values
    ('Flatbed trailer 40 ft',             'FLT-40',      'TRAILERS',         'FLATBED',  'Day',      'fleet_only',        650.00,  480.00, '13.6 m flatbed with twist locks',                  '{"cf_payload_t":28,"cf_length_m":13.6,"cf_width_m":2.5,"cf_height_m":1.6,"cf_hydraulic":"No","cf_axles":3,"cf_ownership":"Own fleet","cf_permit_zone":"GCC cross-border"}'),
    ('Lowbed trailer 60 t',               'LOW-60',      'TRAILERS',         'LOWBED',   'Day',      'fleet_only',       1800.00, 1350.00, 'Modular lowbed with hydraulic ramps for heavy and oversize cargo', '{"cf_payload_t":60,"cf_length_m":14.5,"cf_width_m":3.0,"cf_height_m":1.0,"cf_hydraulic":"Yes","cf_axles":5,"cf_ownership":"Own fleet","cf_permit_zone":"UAE only"}'),
    ('Curtain-side trailer 13.6 m',       'CUR-136',     'TRAILERS',         'CURTAIN',  'Day',      'fleet_only',        700.00,  500.00, 'Curtain-side with side loading',                 '{"cf_payload_t":24,"cf_length_m":13.6,"cf_width_m":2.5,"cf_height_m":2.7,"cf_hydraulic":"No","cf_axles":3,"cf_ownership":"External","cf_permit_zone":"GCC cross-border"}'),
    ('Prime mover 6x4',                   'PRM-64',      'TRUCKS',           'PRIME',    'Day',      'fleet_only',        550.00,  400.00, 'Tractor unit for trailers',                      '{"cf_axles":3,"cf_hydraulic":"No","cf_ownership":"Own fleet","cf_permit_zone":"GCC cross-border"}'),
    ('Box truck 7 t',                     'BOX-7',       'TRUCKS',           'BOX',      'Day',      'fleet_only',        450.00,  320.00, 'Closed box body',                                '{"cf_payload_t":7,"cf_length_m":6.2,"cf_width_m":2.4,"cf_height_m":2.4,"cf_hydraulic":"No","cf_axles":2,"cf_ownership":"Own fleet","cf_permit_zone":"GCC cross-border"}'),
    ('Box truck 7 t with driver',         'BOX-7-DRV',   'TRUCKS',           'BOX',      'Hr',       'fleet_with_driver',  95.00,   68.00, 'Closed box truck with driver, by the hour',      '{"cf_payload_t":7,"cf_length_m":6.2,"cf_width_m":2.4,"cf_height_m":2.4,"cf_hydraulic":"No","cf_axles":2,"cf_ownership":"Own fleet","cf_permit_zone":"UAE only"}'),
    ('Pickup 1 t',                        'PCK-1',       'TRUCKS',           'PICKUP',   'Day',      'fleet_only',        220.00,  150.00, 'Light pickup for small loads',                   '{"cf_payload_t":1,"cf_length_m":2.3,"cf_width_m":1.8,"cf_height_m":1.5,"cf_hydraulic":"No","cf_axles":2,"cf_ownership":"Own fleet","cf_permit_zone":"UAE only"}'),
    ('Tipper truck 20 t',                 'TIP-20',      'TRUCKS',           'TIPPER',   'Day',      'fleet_only',        600.00,  430.00, 'Hydraulic tipping body',                         '{"cf_payload_t":20,"cf_length_m":5.5,"cf_width_m":2.5,"cf_height_m":2.2,"cf_hydraulic":"Yes","cf_axles":3,"cf_ownership":"External","cf_permit_zone":"UAE only"}'),
    ('Refrigerated truck 10 t',           'RFT-10',      'TRUCKS',           'REEFER',   'Day',      'fleet_only',        750.00,  540.00, 'Temperature-controlled box, minus 20 to plus 25 C', '{"cf_payload_t":10,"cf_length_m":7.2,"cf_width_m":2.4,"cf_height_m":2.4,"cf_hydraulic":"No","cf_axles":2,"cf_ownership":"External","cf_permit_zone":"GCC cross-border"}'),
    ('Tail-lift truck 3 t',               'TLT-3',       'TRUCKS',           'BOX',      'Day',      'fleet_only',        380.00,  270.00, 'Box truck with hydraulic tail-lift',             '{"cf_payload_t":3,"cf_length_m":4.2,"cf_width_m":2.1,"cf_height_m":2.2,"cf_hydraulic":"Yes","cf_axles":2,"cf_ownership":"Own fleet","cf_permit_zone":"UAE only"}'),
    ('Hydraulic crane truck 25 t',        'CRN-25',      'LIFTING',          'CRANE',    'Day',      'fleet_only',       1500.00, 1100.00, 'Hydraulic knuckle-boom crane, 25 t lift',        '{"cf_payload_t":25,"cf_length_m":10.5,"cf_width_m":2.5,"cf_height_m":3.9,"cf_hydraulic":"Yes","cf_axles":3,"cf_ownership":"External","cf_permit_zone":"UAE only"}'),
    ('Forklift 5 t',                      'FLK-5',       'LIFTING',          'FORKLIFT', 'Day',      'fleet_only',        350.00,  240.00, 'Diesel forklift, 5 t',                           '{"cf_payload_t":5,"cf_hydraulic":"Yes","cf_axles":2,"cf_ownership":"Own fleet","cf_permit_zone":"UAE only"}'),
    ('Driver, heavy vehicle',             'DRV-HGV',     'DRIVERS',          'DRIVER',   'Hr',       'driver_hourly',      35.00,   24.00, 'Licensed heavy vehicle driver',                  null),
    ('Driver, oversize and heavy haul',   'DRV-OS',      'DRIVERS',          'DRIVER',   'Hr',       'driver_hourly',      48.00,   34.00, 'Driver certified for oversize and heavy haul',   null),
    ('Crane operator',                    'OPR-CRN',     'DRIVERS',          'OPERATOR', 'Hr',       'operator_hourly',    60.00,   42.00, 'Certified mobile crane operator',                null),
    ('Loading helper',                    'HLP-01',      'DRIVERS',          'HELPER',   'Hr',       'operator_hourly',    22.00,   14.00, 'Loading and unloading helper',                   null),
    ('Customs clearance, per shipment',   'SVC-CUS',     'SERVICES_PERMITS', 'CUSTOMS',  'Shipment', 'customs',           350.00,  220.00, 'Declaration and clearance at the border or port', null),
    ('Cross-border permit, per trip',     'SVC-PRM',     'SERVICES_PERMITS', 'PERMITS',  'Trip',     'customs',           500.00,  380.00, 'Transit and entry permit for one cross-border trip', null),
    ('Escort vehicle, oversize cargo',    'SVC-ESC',     'SERVICES_PERMITS', 'ESCORT',   'Trip',     'extras',            400.00,  280.00, 'Escort vehicle with flashing beacons',           null),
    ('Route survey, oversize cargo',      'SVC-SRV',     'SERVICES_PERMITS', 'PERMITS',  'Job',      'extras',            600.00,  400.00, 'Route survey and authority approval for oversize loads', null),
    ('Waiting time, per hour',            'SVC-WAIT',    'SERVICES_PERMITS', 'EXTRAS',   'Hr',       'extras',            120.00,   70.00, 'Waiting beyond the free two hours per stop',     null)
  ) as v(nm, sku, cat, sub, uo, ty, lp, cp, dsc, cd) loop
    if not exists (select 1 from products p where p.tenant_id = t and p.name = r.nm) then
      insert into products (tenant_id, ref, name, sku, category, sub_category, uom, description, list_price, cost_price, tax_percent, status, item_type, custom_data)
      values (t, pg_temp.logi_ref('products', t, 'PRD'), r.nm, r.sku, r.cat, r.sub, r.uo, r.dsc, r.lp, r.cp, 5, 'active', r.ty, r.cd::jsonb);
    end if;
  end loop;

  -- ---- Standard Quote template "Fleet quotation" ----------------------------------------------------------------------------------
  if not exists (select 1 from standard_quote_templates x where x.tenant_id = t and x.name = 'Fleet quotation') then
    insert into standard_quote_templates (tenant_id, name, is_default, accent_color, logo_position, blocks)
    values (t, 'Fleet quotation',
            not exists (select 1 from standard_quote_templates x where x.tenant_id = t and x.is_default),
            '#1f5f8b', 'left',
            jsonb_build_array(
              jsonb_build_object('id','letterhead','type','letterhead','visible',true),
              jsonb_build_object('id','quote_meta','type','quote_meta','visible',true),
              jsonb_build_object('id','bill_to','type','bill_to','visible',true),
              jsonb_build_object('id','intro_text','type','intro_text','visible',true,'content','Thank you for your inquiry. We are pleased to quote for the transport and fleet services below.'),
              jsonb_build_object('id','line_items','type','line_items','visible',true),
              jsonb_build_object('id','totals','type','totals','visible',true),
              jsonb_build_object('id','notes','type','notes','visible',true),
              jsonb_build_object('id','terms','type','terms','visible',true),
              jsonb_build_object('id','signature','type','signature','visible',true),
              jsonb_build_object('id','footer_text','type','footer_text','visible',true,'content','Fleet availability is confirmed on acceptance.')
            ));
  end if;
  select id into v_tpl from standard_quote_templates where tenant_id = t and name = 'Fleet quotation';

  -- ---- Three sample Standard Quotes ------------------------------------------------------------------------------------------------
  for r in select * from (values
    (1, 'Emirates Steel Fabrication LLC', 'Khalid Al Mansoori', 'sent',     5.00, 0.00, 5.00, 4, 'Oversize haul, Abu Dhabi fabrication yard to Jebel Ali port.',
        E'Scope of work: collect two fabricated steel girders (14 m, 38 t each) from the Abu Dhabi yard, haul on lowbed with escort to Jebel Ali port, offload at the berth. Route survey and authority approval included.'),
    (2, 'Doha Marine Contracting',    'Faisal Al Thani',    'accepted', 0.00, 5.00, 0.00, 9, 'Cross-border transport of marine equipment, UAE to Qatar.',
        E'Scope of work: load marine equipment at Jebel Ali, transport by flatbed to the Doha site via the Abu Samra border, customs clearance and permits at both borders, delivery and offloading at site.'),
    (3, 'Riyadh Industrial Equipment Co', 'Omar Al Qahtani', 'draft',   15.00, 0.00, 0.00, 1, 'Crane truck hire with operator for a plant installation.',
        E'Scope of work: 25 t hydraulic crane truck with operator and helper on site in Riyadh for five working days, for positioning of plant equipment.')
  ) as v(n, acc, contact, st, taxp, hd, ship, age, intro, notes) loop
    if not exists (select 1 from standard_quotes q where q.tenant_id = t and q.ref = 'SQ-' || v_year || '-' || lpad(r.n::text, 4, '0')) then
      insert into standard_quotes (tenant_id, ref, account_id, contact_id, status, valid_until, terms, notes, subtotal, total,
                                   header_discount_pct, tax_pct, shipping_amount, intro_text, template_id, created_at, sent_at)
      values (t, 'SQ-' || v_year || '-' || lpad(r.n::text, 4, '0'),
              (select a.id from accounts a where a.tenant_id = t and a.name = r.acc),
              (select c.id from contacts c where c.tenant_id = t and c.name = r.contact),
              r.st, (current_date + 14 - r.age)::date, c_terms, r.notes, 0, 0,
              r.hd, r.taxp, r.ship, r.intro, v_tpl, now() - (r.age || ' days')::interval,
              case when r.st in ('sent','accepted') then now() - (r.age || ' days')::interval + interval '2 hours' else null end);
    end if;
  end loop;

  -- Lines: only for a sample quote that has none yet; rate is the product list price.
  for r in select * from (values
    (1, 1, 'LOW-60',  2, 0),
    (1, 2, 'PRM-64',  2, 0),
    (1, 3, 'DRV-OS', 20, 0),
    (1, 4, 'SVC-ESC', 2, 0),
    (1, 5, 'SVC-SRV', 1, 0),
    (2, 1, 'FLT-40',  3, 0),
    (2, 2, 'PRM-64',  3, 0),
    (2, 3, 'DRV-HGV',36, 0),
    (2, 4, 'SVC-CUS', 2, 0),
    (2, 5, 'SVC-PRM', 3, 0),
    (3, 1, 'CRN-25',  5, 0),
    (3, 2, 'OPR-CRN',40, 0),
    (3, 3, 'HLP-01', 40, 0),
    (3, 4, 'TLT-3',   2, 0)
  ) as v(qn, sl, sku, qty, disc) loop
    select id into q_id from standard_quotes where tenant_id = t and ref = 'SQ-' || v_year || '-' || lpad(r.qn::text, 4, '0');
    if q_id is not null and not exists (select 1 from standard_quote_lines l where l.standard_quote_id = q_id and l.sl_no = r.sl::text) then
      insert into standard_quote_lines (tenant_id, standard_quote_id, sl_no, description, uom, qty, rate, discount_pct, amount, product_id)
      select t, q_id, r.sl::text, p.name || ' - ' || p.description, p.uom, r.qty, p.list_price, r.disc,
             round(r.qty * p.list_price * (1 - r.disc / 100.0), 2), p.id
      from products p where p.tenant_id = t and p.sku = r.sku;
    end if;
  end loop;

  -- Totals, same order as the app: subtotal, header discount, tax on the taxable value, shipping added last and untaxed.
  update standard_quotes q
  set subtotal = s.sub,
      total = round((s.sub - s.sub * q.header_discount_pct / 100) * (1 + q.tax_pct / 100) + q.shipping_amount, 2)
  from (select standard_quote_id, sum(amount) as sub from standard_quote_lines where tenant_id = t group by standard_quote_id) s
  where q.id = s.standard_quote_id and q.tenant_id = t and q.ref like 'SQ-' || v_year || '-000_' and q.subtotal = 0;

  raise notice 'Logistics sample data is in place for the workspace logistics.';
end $seed$;

-- Check: counts for the workspace.
select
  (select count(*) from products          where tenant_id = (select id from tenants where slug = 'logistics')) as products,
  (select count(*) from accounts          where tenant_id = (select id from tenants where slug = 'logistics')) as accounts,
  (select count(*) from contacts          where tenant_id = (select id from tenants where slug = 'logistics')) as contacts,
  (select count(*) from suppliers         where tenant_id = (select id from tenants where slug = 'logistics')) as suppliers,
  (select count(*) from standard_quotes   where tenant_id = (select id from tenants where slug = 'logistics')) as quotes,
  (select count(*) from custom_fields     where tenant_id = (select id from tenants where slug = 'logistics') and object_type = 'product') as product_fields;
