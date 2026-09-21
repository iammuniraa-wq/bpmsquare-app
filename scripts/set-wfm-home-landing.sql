-- Send a WFM workspace's logins straight to My Workforce instead of the
-- dashboard (config.wfm.home_landing).
--
-- Why this is a script and not a migration: it is one tenant's PREFERENCE,
-- not schema. Landing on My Workforce shipped 2026-09-10 as a rule for every
-- WFM workspace; the owner corrected that on 2026-09-21 ("this is true for
-- only BIM client not for any other tenant including demo"), so the code now
-- reads config.wfm.home_landing and defaults to the dashboard. Every tenant
-- that never had this switched on therefore needs nothing -- including demo,
-- which is the point.
--
-- Run the BIM block below on PRODUCTION only. The setting is also editable in
-- the app: Settings -> Workforce -> "Where a login lands", so this script is
-- only the one-time backfill for the tenant that already relied on the old
-- product-wide behaviour.
--
-- It applies at SIGN-IN ONLY. Pressing Dashboard afterwards always works, for
-- every role -- which is the other half of the 2026-09-21 correction (the old
-- redirect lived on "/" and fired on every visit, throwing an admin out of
-- Settings and the dashboard Adapt drawer mid-task).

-- ── 1. Inspection: where does each WFM tenant land today? ──────────────────
select
  slug,
  name,
  coalesce(config -> 'wfm' ->> 'home_landing', 'dashboard (default)') as home_landing
from tenants
where (features ->> 'wfm')::boolean is true
order by slug;

-- ── 2. BIM: land on My Workforce ───────────────────────────────────────────
-- jsonb_set with create_if_missing, on a config that may have no 'wfm' key at
-- all yet -- hence the coalesce building the object first, which leaves every
-- other wfm setting exactly as it is.
update tenants
set config = jsonb_set(
      coalesce(config, '{}'::jsonb),
      '{wfm,home_landing}',
      '"my_workforce"'::jsonb,
      true
    )
where slug = 'bim';

-- ── 3. Confirm ─────────────────────────────────────────────────────────────
select slug, config -> 'wfm' ->> 'home_landing' as home_landing
from tenants
where slug = 'bim';

-- ── To undo ────────────────────────────────────────────────────────────────
-- update tenants
-- set config = config #- '{wfm,home_landing}'
-- where slug = 'bim';
