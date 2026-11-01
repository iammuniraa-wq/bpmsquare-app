-- BIM Trainee rules (2026-11-03). Design: docs/design/wfm-rules-by-type.md, section 2 (storage) and 9 (this script).
-- Run on the database behind the BIM workspace (production) AFTER the slice-1 code is deployed; before that the key is
-- simply ignored (getWfmConfig spreads the stored object over DEFAULT_WFM_CONFIG and nothing reads type_rules yet).
--
-- Policy (owner, from the client): "No leaves even on Sunday, training is there; no sick leave; no comp off. When
-- required, upon leave request they will get leave approved by BIM."
--   weekly off      -> none (Sunday is a training day: absence and standard hours count it)
--   every leave type whose category is NOT 'unpaid' -> not offered
--   the unpaid-category type ("Leave on approval")   -> stays available, counted as unpaid, approved as usual
--
-- Touches ONLY the tenant with slug 'bim', ONLY config -> wfm -> type_rules -> trainee. Every other key of config is
-- preserved: jsonb_set builds a copy of the existing document and replaces one path. Safe to run twice: the value is
-- recomputed from the live leave types each time, so a second run writes the same thing (or picks up a leave type
-- added since). Wrapped in a transaction; nothing is written if a check fails.

begin;

-- ── 0. Checks ──────────────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  t_id uuid;
  has_trainee boolean;
  unpaid_types int;
begin
  select id into t_id from tenants where slug = 'bim';
  if t_id is null then raise exception 'No tenant with slug bim on this database'; end if;

  select exists (
    select 1 from jsonb_array_elements(coalesce(config->'wfm'->'employment_types', '[]'::jsonb)) e
    where e->>'code' = 'trainee'
  ) into has_trainee from tenants where id = t_id;
  if not has_trainee then
    raise exception 'Employment type code trainee is not in config.wfm.employment_types for bim -- add it in Settings > Workforce > Rules first';
  end if;

  select count(*) into unpaid_types from wfm_leave_types where tenant_id = t_id and active and category = 'unpaid';
  if unpaid_types = 0 then
    raise exception 'bim has no active leave type with category unpaid. Create "Leave on approval" (category Unpaid, 30 a year) under Settings > Workforce > Leave first, then run this again';
  end if;
end $$;

-- ── 1. Preview BEFORE ────────────────────────────────────────────────────────────────────────────────────────────
select slug,
       config->'wfm'->'employment_types'          as employment_types,
       config->'wfm'->'type_rules'                as type_rules_before
from tenants where slug = 'bim';

select id, name, category, active,
       case when category = 'unpaid' then 'stays available (unpaid, on approval)' else 'NOT OFFERED for trainee' end as trainee_rule
from wfm_leave_types where tenant_id = (select id from tenants where slug = 'bim') and active
order by name;

-- ── 2. Write ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- The rules apply FROM 1 November 2026 (effective_from), never to earlier days or months (owner: "from now on, not
-- past month", "from 1st of Nov"). To start on a different day, change the date below.
-- The trainee entry: {"effective_from": "YYYY-MM-DD", "week_off_days": [], "leave": {"<leave_type_id>": {"mode": "off"}, ...}}
-- (shape = WfmTypeRules in src/lib/wfm/typeRules.ts; leave is keyed by wfm_leave_types.id, same as everywhere else).
with t as (select id, config from tenants where slug = 'bim'),
     trainee as (
       select jsonb_build_object(
                'effective_from', '2026-11-01',
                'week_off_days', '[]'::jsonb,
                'leave', coalesce(
                  (select jsonb_object_agg(lt.id::text, jsonb_build_object('mode', 'off'))
                     from wfm_leave_types lt, t
                    where lt.tenant_id = t.id and lt.active and lt.category <> 'unpaid'),
                  '{}'::jsonb)
              ) as rules
     )
update tenants
   set config = jsonb_set(
                  jsonb_set(
                    jsonb_set(coalesce(tenants.config, '{}'::jsonb), '{wfm}', coalesce(tenants.config->'wfm', '{}'::jsonb), true),
                    '{wfm,type_rules}', coalesce(tenants.config->'wfm'->'type_rules', '{}'::jsonb), true),
                  '{wfm,type_rules,trainee}', trainee.rules, true)
  from trainee
 where tenants.slug = 'bim';

-- ── 3. Preview AFTER ─────────────────────────────────────────────────────────────────────────────────────────────
select slug,
       jsonb_pretty(config->'wfm'->'type_rules') as type_rules_after,
       (select count(*) from employees e where e.tenant_id = tenants.id and e.employment_type = 'trainee' and e.status = 'active') as active_trainees
from tenants where slug = 'bim';

commit;

-- No cache to clear: getWfmConfig (src/lib/wfm/server.ts) is a per-request React cache() over tenants.config, read fresh on
-- every request, and the Settings screen's GET reads the row directly. The next page load, punch, leave request or
-- monthly summary is on the new rules. (getTenantBrandingByHost is the only unstable_cache over tenants and carries
-- branding keys only.)

-- ── Rollback (run by hand if needed): removes only the trainee entry, leaves every other type and key alone ──────
-- update tenants
--    set config = jsonb_set(config, '{wfm,type_rules}', (config->'wfm'->'type_rules') - 'trainee', true)
--  where slug = 'bim' and config->'wfm'->'type_rules' ? 'trainee';
-- select slug, config->'wfm'->'type_rules' from tenants where slug = 'bim';
