-- 0102: Remove territory/sales_org entirely (owner decision 2026-08-26).
-- Superseded by Coverage's rule-based Segments (0101) -- territory/sales_org
-- were meant to survive as two of the fields a Segment rule could read
-- (see 0101_coverage.sql's own header comment), but the owner decided
-- against keeping the flat picklist fields at all, everywhere they're used,
-- not just in the Segment rule builder. This is destructive: any value
-- already stored in these columns is gone once this runs. Take a backup
-- first if there's any chance the values are still wanted.
--
-- Also drops business_role_grants.data_scope/territories -- the
-- "territory-scoped" Business Role access-control option. It was never
-- actually wired into any query (confirmed by code audit: computed and
-- editable in Settings -> Business Roles, but nothing downstream ever
-- filtered a record list by it), so dropping it changes zero enforced
-- access-control behaviour today; it just removes a configuration option
-- that didn't do anything yet.

alter table accounts drop column if exists territory;
alter table accounts drop column if exists sales_org;

alter table contacts drop column if exists territory;
alter table contacts drop column if exists sales_org;

alter table quotes drop column if exists territory;
alter table quotes drop column if exists sales_org;

alter table service_cases drop column if exists territory;
alter table service_cases drop column if exists sales_org;

alter table business_role_grants drop column if exists data_scope;
alter table business_role_grants drop column if exists territories;
