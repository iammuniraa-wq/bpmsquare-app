-- 0071_standard_business_roles.sql
-- Standard Business Roles: a User and an Admin role per product category
-- (Sales / Service / Marketing / WFM), shipped as a CODE catalog
-- (src/lib/standardRoles.ts) and materialised into these tables per tenant
-- on first use -- not seeded here. Seeding rows in a migration needs a
-- backfill for every new tenant and leaves all 8 roles stale, with no safe
-- update path, the moment a new workcenter ships.
--
-- Purely additive. Every existing business_roles row keeps working unchanged
-- -- it simply has is_standard = false and template_key = null, which is
-- exactly what a hand-made custom role should be.

-- Which catalog entry this row was materialised from (null = a custom role
-- the tenant made themselves, including a duplicate of a standard one).
alter table business_roles add column template_key text;

-- Standard rows are read-only in the UI and refuse PATCH/DELETE at the API
-- layer: that is what lets the catalog be re-synced later (e.g. when a new
-- workcenter is added) without ever clobbering a customer's own edits.
-- Customising a standard role is done by DUPLICATING it, which produces a
-- normal row with is_standard = false.
alter table business_roles add column is_standard boolean not null default false;

-- One row per template per tenant -- makes provisioning a safe upsert and
-- stops a double-load of the roles page creating duplicates. Partial, so the
-- many custom roles with a null template_key are unaffected.
create unique index business_roles_template_idx
  on business_roles (tenant_id, template_key) where template_key is not null;
