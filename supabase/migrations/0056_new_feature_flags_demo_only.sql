-- 0056_new_feature_flags_demo_only.sql
-- Six recently-built capabilities (Change History, Outbound Email workcenter,
-- Business Roles, Standard Quote incl. its templates/AI/commercial fields,
-- Gmail reply-threading, Quote Lines as a Data Workbench object) are now
-- gated behind TenantFeatures flags (src/lib/constants.ts) instead of being
-- on for every tenant. A missing key reads as `false` everywhere it's
-- checked (requireFeature/tenantHasFeature both use optional chaining), so
-- every existing tenant defaults to off with no explicit action needed --
-- this migration only turns them ON for the demo tenant, so it keeps
-- showcasing everything. Real client tenants (Vikas included) stay off until
-- a platform admin turns a flag on per tenant via /admin/tenants/[id].
--
-- jsonb `||` concatenation only touches the keys listed here -- whatever
-- else is already in a tenant's `features` column (leads, marketing, etc.,
-- whatever values they currently hold) is left untouched.

update tenants
set features = features || '{
  "change_history": true,
  "outbound_email": true,
  "business_roles": true,
  "standard_quotes": true,
  "gmail_reply_threading": true,
  "quote_lines_dw": true
}'::jsonb
where is_demo = true;
