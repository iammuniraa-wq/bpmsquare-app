-- Removes EVERYTHING scripts/seed-bigblue-sample.sql (or the .mjs twin) put
-- into the Big Blue tenant: every account, contact, supplier, product, deal,
-- Standard Quote and Price Book row in the tenant whose slug is `bigblue`,
-- plus the Price Book routing rules in its config. Run it in the Supabase
-- SQL editor ONLY while the tenant holds nothing but the sample -- it does
-- not distinguish seeded rows from rows typed in later.
--
-- Left in place: the tenant, its users, feature flags, currency, category
-- tree, company info and the other config keys. Run the inspection block
-- first, read the counts, then the delete block.

-- ── 1. Inspection ───────────────────────────────────────────────────────────
with t as (select id from tenants where slug = 'bigblue')
select 'standard_quote_lines' as tbl, count(*) from standard_quote_lines, t where tenant_id = t.id
union all select 'standard_quotes',         count(*) from standard_quotes, t         where tenant_id = t.id
union all select 'contacts',                count(*) from contacts, t                where tenant_id = t.id
union all select 'accounts',                count(*) from accounts, t                where tenant_id = t.id
union all select 'products',                count(*) from products, t                where tenant_id = t.id
union all select 'suppliers',               count(*) from suppliers, t               where tenant_id = t.id
union all select 'pricing_rules',           count(*) from pricing_rules, t           where tenant_id = t.id
union all select 'pricing_config_versions', count(*) from pricing_config_versions, t where tenant_id = t.id
order by 1;

-- ── 2. Delete (dependency order; RESTRICT on standard_quotes.account_id
--       means quotes must go before accounts) ─────────────────────────────
do $$
declare
  t uuid := (select id from tenants where slug = 'bigblue');
  tbl text;
  n bigint;
begin
  if t is null then raise exception 'No tenant with slug bigblue'; end if;
  if exists (select 1 from tenants where id = t and is_demo) then
    raise exception 'bigblue is the is_demo tenant -- refusing';
  end if;

  foreach tbl in array array[
    'pricing_documents', 'pricing_usage', 'pricing_rfqs',
    'standard_quote_attachments', 'standard_quote_lines', 'standard_quotes',
    'opportunity_lines', 'opportunities',
    'contacts', 'accounts', 'products', 'suppliers',
    'pricing_rules', 'pricing_components', 'pricing_procedures', 'pricing_cost_inputs', 'pricing_cost_models',
    'pricing_config_versions', 'pricing_dimensions'
  ] loop
    if to_regclass('public.' || tbl) is null then
      raise notice '% : table not present, skipped', tbl;
      continue;
    end if;
    execute format('delete from %I where tenant_id = $1', tbl) using t;
    get diagnostics n = row_count;
    raise notice '% : % row(s) removed', tbl, n;
  end loop;

  -- The routing rules point at the steel_catalog book that no longer exists.
  update tenants set config = config #- '{pricing,routing}' where id = t;
end $$;
