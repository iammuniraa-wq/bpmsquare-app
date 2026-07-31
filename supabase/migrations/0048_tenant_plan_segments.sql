-- 0048_tenant_plan_segments.sql
-- tenants.plan was "free" | "pro" | "enterprise" -- decorative only (an admin
-- list pill), read by no feature/connector gating logic anywhere yet.
-- Renamed to the actual business-size vocabulary ("personal" | "small_business"
-- | "enterprise") so it reads as what it is and is a clean place to hang
-- future segment-based logic (e.g. which connector auth types a tenant's
-- admin sees) without another rename.

-- Drop the ORIGINAL constraint FIRST. It only allows ('free','pro',
-- 'enterprise') -- every earlier version of this migration updated the data
-- to the new vocabulary before dropping it, so the very first UPDATE
-- introducing 'small_business'/'personal' was rejected by the *old*
-- constraint immediately, and (since a multi-statement script here runs as
-- one transaction) that single failure silently rolled back the whole
-- script every time, including anything that looked like it had succeeded.
alter table tenants drop constraint if exists tenants_plan_check;

-- Defensive normalization kept from troubleshooting this: strips anything
-- that isn't a-z/underscore in case of a stray invisible character, then
-- maps old values, then a catch-all for anything still unrecognized
-- (including NULL) so the constraint below can never fail on a row this
-- script didn't anticipate. Turned out not to be the actual bug this time,
-- but it's a correct safeguard regardless and costs nothing to keep.
update tenants set plan = regexp_replace(lower(plan), '[^a-z_]', '', 'g');
update tenants set plan = 'personal'       where plan = 'free';
update tenants set plan = 'small_business' where plan = 'pro';
update tenants set plan = 'personal' where plan is null or plan not in ('personal', 'small_business', 'enterprise');

alter table tenants alter column plan set default 'personal';
alter table tenants add constraint tenants_plan_check
  check (plan in ('personal', 'small_business', 'enterprise'));
