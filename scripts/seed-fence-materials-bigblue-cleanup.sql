-- Removes ONLY the fence sample data seeded into bigblue by
-- seed-fence-materials-bigblue.sql. Unlike seed-bigblue-sample-cleanup.sql
-- (which wipes bigblue's whole quote/product/pricing sandbox), bigblue also
-- carries the client's own real prospect data by the time this runs, so this
-- script is surgical: it deletes fence_projects/fence_gates rows (a client
-- may have started a real project by then), the 3 fence_security_profiles,
-- the 26 FNC-sku products, and the 3 FENCE_* category entries -- nothing else
-- in the tenant is touched, and every other product_categories entry
-- (REBAR, DOWEL_BARS, BEARINGS, FASTENERS, SAFETY_GEAR, BIRD_CONTROL) and
-- every non-fence product/quote survives untouched. The fence_projects
-- feature flag is left ON (matches keeping it enabled on demo too).

-- ── 1. Inspection ────────────────────────────────────────────────────────────
with t as (select id from tenants where slug = 'bigblue')
select 'fence_gates' as tbl, count(*) from fence_gates, t where tenant_id = t.id
union all select 'fence_projects', count(*) from fence_projects, t where tenant_id = t.id
union all select 'fence_security_profiles', count(*) from fence_security_profiles, t where tenant_id = t.id
union all select 'fence products (FNC-%)', count(*) from products, t where tenant_id = t.id and sku like 'FNC-%'
order by 1;

-- ── 2. Delete (dependency order: gates before projects) ─────────────────────
do $$
declare
  t uuid := (select id from tenants where slug = 'bigblue');
  tbl text;
  n bigint;
begin
  if t is null then
    raise exception 'No tenant with slug bigblue';
  end if;
  if exists (select 1 from tenants where id = t and is_demo) then
    raise exception 'bigblue is flagged is_demo -- refusing to run the bigblue-specific cleanup against it.';
  end if;

  foreach tbl in array array['fence_gates', 'fence_projects', 'fence_security_profiles'] loop
    if to_regclass('public.' || tbl) is null then
      raise notice '% : table not present, skipped', tbl;
      continue;
    end if;
    execute format('delete from %I where tenant_id = $1', tbl) using t;
    get diagnostics n = row_count;
    raise notice '% : % row(s) removed', tbl, n;
  end loop;

  delete from products where tenant_id = t and sku like 'FNC-%';
  get diagnostics n = row_count;
  raise notice 'products (FNC-%%) : % row(s) removed', n;

  update tenants
  set config = jsonb_set(
    config,
    '{product_categories}',
    coalesce(
      (select jsonb_agg(cat) from jsonb_array_elements(config -> 'product_categories') cat
       where cat ->> 'code' not in ('FENCE_PIPES', 'FENCE_FABRIC', 'FENCE_HARDWARE')),
      '[]'::jsonb
    )
  )
  where id = t;
  raise notice 'product_categories : FENCE_* entries removed, other categories preserved';
end $$;

-- ── 3. Verify ────────────────────────────────────────────────────────────────
with t as (select id from tenants where slug = 'bigblue')
select 'fence_gates' as tbl, count(*) from fence_gates, t where tenant_id = t.id
union all select 'fence_projects', count(*) from fence_projects, t where tenant_id = t.id
union all select 'fence_security_profiles', count(*) from fence_security_profiles, t where tenant_id = t.id
union all select 'fence products (FNC-%)', count(*) from products, t where tenant_id = t.id and sku like 'FNC-%'
order by 1;
-- Expected: all four rows 0. Check bigblue's other products/quotes/accounts
-- are still present separately -- this script never touches them.
