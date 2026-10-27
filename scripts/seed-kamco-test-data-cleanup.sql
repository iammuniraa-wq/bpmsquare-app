-- KAMCO test data CLEANUP -- removes what scripts/seed-kamco-test-data.sql created. Run on the KAMCO Supabase project ONLY, by hand,
-- LATER, when the test walk-through is over. Nothing runs this automatically and it is not part of any run bundle.
--
-- SAFE BY DEFAULT: as written it only COUNTS what it would delete and prints the numbers as notices (a dry run). To delete for real,
-- change the one line `v_confirm constant boolean := false;` below to `true` and run the script again.
--
-- What it deletes: only rows of the 'kamco' workspace whose name / title starts with 'TEST ' (the seed's naming rule), and the rows
-- that hang off them:
--   * RFQs titled 'TEST ...'   (their lines, suppliers, replies, messages and awards go with them)
--   * estimates named 'TEST ...' (their lines and BOQ links go with them)
--   * contract projects named 'TEST ...' (their budget, buy-out packages and package lines go with them)
--   * deals titled 'TEST ...'  (their tender row, deal lines, BOQ source and lines, bid versions, competitors, logged calls go with
--     them) and any approval requests that point at those deals (the Tender desk's waiting bid decision among them)
--   * products, inventory items, contacts, accounts and suppliers named 'TEST ...'
--   * employees whose first name starts with 'TEST '
-- Everything is filtered by tenant_id of the 'kamco' workspace, so another workspace is never touched. If somebody created their own
-- records under a TEST account or TEST deal in the meantime (a quote, an invoice), the database either removes them with it (cascade)
-- or refuses with a foreign-key error: read the dry-run counts first.
--
-- NOT undone: the feature flags the seed switched on (set them in /admin/tenants), the app's own 'Tender' deal type, change-log
-- entries the app wrote while you worked, and anything else that has no link to a TEST record.

do $cleanup$
declare
  v_confirm constant boolean := false;

  t uuid;
  v_demo boolean;
  v_opps uuid[];
  v_n int;
begin
  select id, coalesce(is_demo, false) into t, v_demo from tenants where slug = 'kamco';
  if t is null then
    raise exception 'No workspace with slug kamco was found. Nothing was deleted.';
  end if;
  if v_demo then
    raise exception 'The workspace kamco is flagged as a demo workspace. Nothing was deleted.';
  end if;

  select coalesce(array_agg(id), '{}') into v_opps from opportunities where tenant_id = t and title like 'TEST %';

  if not v_confirm then
    raise notice 'DRY RUN. Nothing is deleted. Set v_confirm to true to delete the rows counted below.';
  end if;

  -- 1. RFQs
  if to_regclass('public.rfqs') is not null then
    select count(*) into v_n from rfqs where tenant_id = t and title like 'TEST %';
    raise notice 'rfqs: %', v_n;
    if v_confirm then
      delete from rfqs where tenant_id = t and title like 'TEST %';
    end if;
  end if;

  -- 2. Estimates
  if to_regclass('public.estimates') is not null then
    select count(*) into v_n from estimates where tenant_id = t and name like 'TEST %';
    raise notice 'estimates: %', v_n;
    if v_confirm then
      delete from estimates where tenant_id = t and name like 'TEST %';
    end if;
  end if;

  -- 3. Approval requests that point at a TEST deal (they have no foreign key, so they would be left behind)
  if to_regclass('public.approval_requests') is not null then
    select count(*) into v_n from approval_requests where tenant_id = t and object_id = any(v_opps);
    raise notice 'approval_requests: %', v_n;
    if v_confirm then
      delete from approval_requests where tenant_id = t and object_id = any(v_opps);
    end if;
  end if;

  -- 3b. Contract projects named 'TEST ...' (their budget revisions and lines, buy-out packages and package lines follow by cascade).
  --     The RFQs of the packages were already removed in step 1.
  if to_regclass('public.contract_projects') is not null then
    select count(*) into v_n from contract_projects where tenant_id = t and name like 'TEST %';
    raise notice 'contract_projects: %', v_n;
    if v_confirm then
      delete from contract_projects where tenant_id = t and name like 'TEST %';
    end if;
  end if;

  -- 4. Deals (the tender row, lines, BOQ, bid versions, competitors and calls follow by cascade)
  select count(*) into v_n from opportunities where tenant_id = t and title like 'TEST %';
  raise notice 'opportunities (tender deals): %', v_n;
  if v_confirm then
    delete from opportunities where tenant_id = t and id = any(v_opps);
  end if;

  -- 5. Catalogue and stock
  select count(*) into v_n from products where tenant_id = t and name like 'TEST %';
  raise notice 'products: %', v_n;
  if v_confirm then
    delete from products where tenant_id = t and name like 'TEST %';
  end if;

  if to_regclass('public.inventory_items') is not null then
    select count(*) into v_n from inventory_items where tenant_id = t and name like 'TEST %';
    raise notice 'inventory_items: %', v_n;
    if v_confirm then
      delete from inventory_items where tenant_id = t and name like 'TEST %';
    end if;
  end if;

  -- 6. People and companies
  select count(*) into v_n from employees where tenant_id = t and first_name like 'TEST %';
  raise notice 'employees: %', v_n;
  if v_confirm then
    delete from employees where tenant_id = t and first_name like 'TEST %';
  end if;

  select count(*) into v_n from contacts where tenant_id = t and name like 'TEST %';
  raise notice 'contacts: %', v_n;
  if v_confirm then
    delete from contacts where tenant_id = t and name like 'TEST %';
  end if;

  select count(*) into v_n from accounts where tenant_id = t and name like 'TEST %';
  raise notice 'accounts: %', v_n;
  if v_confirm then
    delete from accounts where tenant_id = t and name like 'TEST %';
  end if;

  select count(*) into v_n from suppliers where tenant_id = t and name like 'TEST %';
  raise notice 'suppliers: %', v_n;
  if v_confirm then
    delete from suppliers where tenant_id = t and name like 'TEST %';
  end if;

  if v_confirm then
    raise notice 'KAMCO test data deleted.';
  end if;
end $cleanup$;
