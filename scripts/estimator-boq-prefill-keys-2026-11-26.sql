-- Tell the already-installed LOCKED civil and pipe starter templates of ONE workspace which input takes a tender BOQ line's quantity,
-- so "Build up this rate" fills it in (excavation volume for m3, wall area for m2, concrete for m3, pipeline length for m).
-- Run by hand in the SQL editor of the database that holds the workspace. Needs supabase/migrations/0131_estimator.sql and
-- 0213_estimate_template_catalogue.sql. The code reads the declaration from each input's "boq_units" list; a workspace that has not run
-- this script still works, it just keeps asking the person to set the quantity by hand.
--
-- WHICH WORKSPACE: change the one line marked CHANGE THIS (v_slug) and nothing else. The script stops, changing nothing, when no workspace
-- has that slug.
--
-- ADD ONLY: an input that already has a "boq_units" list is left exactly as it is, a template that is not locked (the workspace's own
-- editable copy) is never touched, and nothing is removed or reordered. A template whose inputs gained a declaration goes up one version.
-- Safe to run again: the second run changes nothing and says so.

do $fix$
declare
  v_slug text := 'CHANGE-ME'; -- CHANGE THIS: the slug of the workspace
  t uuid;
  r record;
  n int;
  total int := 0;
begin
  if to_regclass('public.estimate_templates') is null then
    raise exception 'Run supabase/migrations/0131_estimator.sql first.';
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'estimate_templates' and column_name = 'locked') then
    raise exception 'Run supabase/migrations/0213_estimate_template_catalogue.sql first (estimate_templates.locked is missing).';
  end if;

  select id into t from tenants where slug = v_slug;
  if t is null then
    raise exception 'No workspace with slug % was found. Nothing was changed. Check the slug in the tenants table.', v_slug;
  end if;

  for r in
    select * from (values
      ('Excavation and backfill (illustrative)', 'exc_m3', '["m3"]'::jsonb),
      ('Reinforced concrete (illustrative)', 'concrete_m3', '["m3"]'::jsonb),
      ('Blockwork and plaster (illustrative)', 'wall_area_m2', '["m2"]'::jsonb),
      ('Pipes and fittings (illustrative)', 'length_m', '["m"]'::jsonb)
    ) as v(tname, ikey, units)
  loop
    update estimate_templates et set
      inputs = (
        select jsonb_agg(
          case when x.e->>'key' = r.ikey and x.e->>'type' = 'number' and not (x.e ? 'boq_units')
               then x.e || jsonb_build_object('boq_units', r.units) else x.e end
          order by x.ord)
        from jsonb_array_elements(et.inputs) with ordinality as x(e, ord)
      ),
      version = et.version + 1,
      updated_at = now()
    where et.tenant_id = t and et.locked = true and lower(et.name) = lower(r.tname)
      and exists (
        select 1 from jsonb_array_elements(et.inputs) as y(e)
        where y.e->>'key' = r.ikey and y.e->>'type' = 'number' and not (y.e ? 'boq_units')
      );
    get diagnostics n = row_count;
    total := total + n;
  end loop;

  if total = 0 then
    raise notice 'Workspace %: nothing to change (already declared, or the starters are not installed).', v_slug;
  else
    raise notice 'Workspace %: % starter template(s) now declare which input takes the BOQ quantity.', v_slug, total;
  end if;
end
$fix$;
