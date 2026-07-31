-- 0048_tenant_plan_segments.sql
-- tenants.plan was "free" | "pro" | "enterprise" -- decorative only (an admin
-- list pill), read by no feature/connector gating logic anywhere yet.
-- Renamed to the actual business-size vocabulary ("personal" | "small_business"
-- | "enterprise") so it reads as what it is and is a clean place to hang
-- future segment-based logic (e.g. which connector auth types a tenant's
-- admin sees) without another rename.

update tenants set plan = 'personal'       where plan = 'free';
update tenants set plan = 'small_business' where plan = 'pro';

alter table tenants drop constraint if exists tenants_plan_check;
alter table tenants alter column plan set default 'personal';
alter table tenants add constraint tenants_plan_check
  check (plan in ('personal', 'small_business', 'enterprise'));
