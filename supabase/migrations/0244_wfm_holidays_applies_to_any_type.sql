-- 0244_wfm_holidays_applies_to_any_type.sql
--
-- Workforce rules by employment type (docs/design/wfm-rules-by-type.md, section 7). A holiday can apply to everyone ('all') or to
-- one employment type, and the types are a list each workspace edits (Settings > Workforce > Rules). 0062 limited the column to
-- the two seed codes, so an Intern- or Trainee-only holiday could never be stored. The application validates the code against the
-- workspace's own list; this check only keeps the column machine-safe (the same shape the Settings route accepts for a code).
--
-- No RLS change: wfm_holidays keeps the select-only policy from 0062; every write is a service-role route filtered on the workspace.
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, adding a holiday for any type other than full_time or
-- contractor answers "Run migration 0244 to use this type for holidays" and nothing else changes.

alter table wfm_holidays drop constraint if exists wfm_holidays_applies_to_check;
alter table wfm_holidays add constraint wfm_holidays_applies_to_check
  check (applies_to = 'all' or applies_to ~ '^[a-z0-9_]{1,40}$');
