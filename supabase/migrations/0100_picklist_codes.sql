-- 0100: Picklist values get stable CODES (owner decision 2026-08-22).
--
-- Territories, sales orgs and product categories/sub-categories were plain
-- display strings, stored verbatim on records — renaming a value orphaned
-- every record carrying the old text, and ERP integration would have had to
-- match on free text. Now every picklist value is { code, name }: records
-- store the CODE (stable, uppercase, immutable once used), screens show the
-- name, and a rename is a display-only config change.
--
-- This migration converts, in ONE transaction:
--   1. tenants.config: territories / sales_orgs (string[] -> {code,name}[])
--      and product_categories ({name,subs:[text]} -> {code,name,subs:[{code,name}]})
--   2. stored record values -> derived codes: accounts / contacts / quotes /
--      service_cases (territory, sales_org) and products (category, sub_category)
--   3. business_role_grants.territories (territory-scoped data access)
--
-- The derivation rule MUST stay identical to deriveCode() in
-- src/lib/picklists.ts: trim, non-alphanumerics -> "_", collapse, upper, 40
-- chars. It is idempotent (derive(code) = code), so re-running this file is
-- safe, and rows created between deploy and migration (already codes) pass
-- through unchanged.

create or replace function pg_temp.derive_code(v text) returns text
language sql immutable as $$
  select upper(
    left(
      trim(both '_' from regexp_replace(coalesce(trim(v), ''), '[^a-zA-Z0-9]+', '_', 'g')),
      40
    )
  );
$$;

-- 1a. territories / sales_orgs: convert string entries; leave coded ones.
update tenants
set config = config
  || jsonb_build_object('territories', (
       select coalesce(jsonb_agg(
         case
           when jsonb_typeof(e) = 'string'
             then jsonb_build_object('code', pg_temp.derive_code(e #>> '{}'), 'name', e #>> '{}')
           else e
         end), '[]'::jsonb)
       from jsonb_array_elements(config->'territories') e
     ))
where jsonb_typeof(config->'territories') = 'array';

update tenants
set config = config
  || jsonb_build_object('sales_orgs', (
       select coalesce(jsonb_agg(
         case
           when jsonb_typeof(e) = 'string'
             then jsonb_build_object('code', pg_temp.derive_code(e #>> '{}'), 'name', e #>> '{}')
           else e
         end), '[]'::jsonb)
       from jsonb_array_elements(config->'sales_orgs') e
     ))
where jsonb_typeof(config->'sales_orgs') = 'array';

-- 1b. product_categories: add codes to nodes and convert string subs.
update tenants
set config = config
  || jsonb_build_object('product_categories', (
       select coalesce(jsonb_agg(
         jsonb_build_object(
           'code', case when node ? 'code' then node->>'code' else pg_temp.derive_code(node->>'name') end,
           'name', node->>'name',
           'subs', (
             select coalesce(jsonb_agg(
               case
                 when jsonb_typeof(s) = 'string'
                   then jsonb_build_object('code', pg_temp.derive_code(s #>> '{}'), 'name', s #>> '{}')
                 else s
               end), '[]'::jsonb)
             from jsonb_array_elements(coalesce(node->'subs', '[]'::jsonb)) s
           )
         )), '[]'::jsonb)
       from jsonb_array_elements(config->'product_categories') node
       where node ? 'name'
     ))
where jsonb_typeof(config->'product_categories') = 'array';

-- 2. Stored record values -> codes (idempotent; codes map to themselves).
update accounts      set territory = pg_temp.derive_code(territory)   where territory is not null and territory <> pg_temp.derive_code(territory);
update accounts      set sales_org = pg_temp.derive_code(sales_org)   where sales_org is not null and sales_org <> pg_temp.derive_code(sales_org);
update contacts      set territory = pg_temp.derive_code(territory)   where territory is not null and territory <> pg_temp.derive_code(territory);
update contacts      set sales_org = pg_temp.derive_code(sales_org)   where sales_org is not null and sales_org <> pg_temp.derive_code(sales_org);
update quotes        set territory = pg_temp.derive_code(territory)   where territory is not null and territory <> pg_temp.derive_code(territory);
update quotes        set sales_org = pg_temp.derive_code(sales_org)   where sales_org is not null and sales_org <> pg_temp.derive_code(sales_org);
update service_cases set territory = pg_temp.derive_code(territory)   where territory is not null and territory <> pg_temp.derive_code(territory);
update service_cases set sales_org = pg_temp.derive_code(sales_org)   where sales_org is not null and sales_org <> pg_temp.derive_code(sales_org);
update products      set category  = pg_temp.derive_code(category)    where category  is not null and category  <> pg_temp.derive_code(category);
update products      set sub_category = pg_temp.derive_code(sub_category) where sub_category is not null and sub_category <> pg_temp.derive_code(sub_category);

-- 3. Territory-scoped role grants store territory values too.
update business_role_grants
set territories = (select coalesce(array_agg(pg_temp.derive_code(t)), '{}') from unnest(territories) t)
where territories <> '{}'
  and exists (select 1 from unnest(territories) t where t <> pg_temp.derive_code(t));
