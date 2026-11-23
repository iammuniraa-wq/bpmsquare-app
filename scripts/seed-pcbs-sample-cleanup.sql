-- PCBS SAMPLE DATA CLEANUP -- removes what scripts/seed-pcbs-sample.sql created. Run on the PCBS Supabase project ONLY, by hand, in the SQL
-- editor, LATER, when the testing with sample data is over. Nothing runs this automatically.
--
-- SAFE BY DEFAULT: as written it only COUNTS what it would delete and prints the numbers as notices (a dry run). To delete for real,
-- change the one line `v_confirm constant boolean := false;` below to `true` and run the script again.
--
-- HOW IT FINDS THE SAMPLE ROWS: every row the seed wrote has an id in the reserved range 5a3b1e00-5a3b-4000-8000-KKKKNNNNNNNN (the
-- marker, see the header of the seed). This script deletes rows of the 'pcbs' workspace whose id is in that range, and nothing else:
-- not by name, so a sample row somebody renamed is still found, and a record the owner or the client made can never be matched (a real
-- record has a random id). Every delete is filtered by the tenant id of the 'pcbs' workspace as well.
--
-- The order is children first: the project and its WBS, the RFQ, the estimates and templates, the quotes and quotations, the tender
-- details and deals, then the catalogue, contacts, accounts and suppliers. Rows that hang off a sample row by a cascading link (for
-- example a milestone or a variation somebody added to the sample project) go with it.
--
-- IF A RECORD YOU MADE POINTS AT A SAMPLE RECORD (for example your own quote on a sample account): the database refuses to delete the
-- sample record, the script stops with a message that says so, and NOTHING is deleted (one transaction). Move or delete your record
-- first, then run this again.
--
-- NOT undone: change-history entries and comments written while people worked with the sample records, the 'tender' deal type the app
-- may have made, and anything else that has no link to a sample row. The script never changes the workspace row, its settings or its flags.

begin;

do $cleanup$
declare
  v_confirm constant boolean := false;

  v_pat constant text := '5a3b1e00-5a3b-4000-8000-%';
  t uuid;
  v_tbl text;
  v_n int;
  v_total int := 0;
begin
  select id into t from tenants where slug = 'pcbs';
  if t is null then
    raise notice 'No workspace with slug pcbs was found in this database. PCBS sample data cleanup: nothing was deleted.';
    return;
  end if;

  if not v_confirm then
    raise notice 'DRY RUN. Nothing is deleted. Set v_confirm to true to delete the rows counted below.';
  end if;

  begin
    -- Children first. A table that does not exist yet (a database that never ran its migration) cannot hold sample rows and is skipped.
    foreach v_tbl in array array[
      'project_work_package_line_parts', 'project_work_package_lines', 'project_work_packages', 'project_budget_lines',
      'project_budget_revisions', 'contract_projects',
      'rfq_responses', 'rfq_suppliers', 'rfq_lines', 'rfqs',
      'estimate_lines', 'estimates', 'estimate_templates',
      'standard_quote_lines', 'standard_quotes', 'quote_lines', 'quote_revisions', 'quotes',
      'tender_bid_versions', 'opportunity_competitors', 'deal_activities', 'opportunity_lines'
    ] loop
      if to_regclass('public.' || v_tbl) is not null then
        execute format('select count(*) from %I where tenant_id = $1 and id::text like $2', v_tbl) into v_n using t, v_pat;
        raise notice '%: %', v_tbl, v_n;
        v_total := v_total + v_n;
        if v_confirm and v_n > 0 then
          execute format('delete from %I where tenant_id = $1 and id::text like $2', v_tbl) using t, v_pat;
        end if;
      end if;
    end loop;

    -- The tender row has no id of its own: its key is the deal's id.
    if to_regclass('public.opportunity_tenders') is not null then
      select count(*) into v_n from opportunity_tenders where tenant_id = t and opportunity_id::text like v_pat;
      raise notice 'opportunity_tenders: %', v_n;
      v_total := v_total + v_n;
      if v_confirm and v_n > 0 then
        delete from opportunity_tenders where tenant_id = t and opportunity_id::text like v_pat;
      end if;
    end if;

    -- An approval request that points at a sample deal has no foreign key (the bid / no-bid proposal), so it would be left behind.
    if to_regclass('public.approval_requests') is not null then
      select count(*) into v_n from approval_requests where tenant_id = t and object_id::text like v_pat;
      raise notice 'approval_requests: %', v_n;
      v_total := v_total + v_n;
      if v_confirm and v_n > 0 then
        delete from approval_requests where tenant_id = t and object_id::text like v_pat;
      end if;
    end if;

    -- The deals, then the catalogue, the people and the companies.
    foreach v_tbl in array array['opportunities', 'contacts', 'accounts', 'suppliers'] loop
      execute format('select count(*) from %I where tenant_id = $1 and id::text like $2', v_tbl) into v_n using t, v_pat;
      raise notice '%: %', v_tbl, v_n;
      v_total := v_total + v_n;
      if v_confirm and v_n > 0 then
        execute format('delete from %I where tenant_id = $1 and id::text like $2', v_tbl) using t, v_pat;
      end if;
    end loop;
  exception when foreign_key_violation or restrict_violation then
    raise exception 'A record that is not sample data still points at a sample record (%). Nothing was deleted. Move or delete that record first, then run this again.', sqlerrm;
  end;

  if v_confirm then
    raise notice 'PCBS sample data deleted: % rows.', v_total;
  else
    raise notice 'DRY RUN finished: % rows would be deleted.', v_total;
  end if;
end $cleanup$;

commit;
