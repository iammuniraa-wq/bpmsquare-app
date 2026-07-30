-- Root-cause fix for "new row violates row-level security policy" on writes
-- (e.g. creating an Account on a tenant's custom domain).
--
-- Every original schema.sql table's "X: tenant isolation" policy checks
-- `tenant_id = auth_tenant_id()`, where auth_tenant_id() reads a `tenant_id`
-- claim baked into the JWT once at login by a Postgres Auth Hook. That claim
-- has zero awareness of which hostname/tenant the current request is actually
-- for, and goes stale the moment a user's tenant_users membership changes
-- after login (e.g. a platform admin's row is auto-upserted by
-- resolveTenantIdForPlatformAdmin() the first time they visit a tenant's
-- custom domain -- their existing session JWT was minted before that row
-- existed, so it never gets the new claim without a full re-login).
--
-- The suppliers (0009), inventory/purchase_orders (0021/0022), and invoices
-- (0025) tables already solved this correctly with a live, dynamic
-- tenant_users membership check instead of a static claim. This migration
-- brings every remaining original table onto that same proven pattern.
-- auth_tenant_id() is left in place (unused after this) rather than dropped,
-- in case anything outside this repo's tracked migrations still references it.

drop policy if exists "tenants: members read own" on tenants;
create policy "tenants: members read own" on tenants for select
  using (id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "tenant_users: members read own tenant" on tenant_users;
create policy "tenant_users: members read own tenant" on tenant_users for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "accounts: tenant isolation" on accounts;
create policy "accounts: tenant isolation" on accounts for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "contacts: tenant isolation" on contacts;
create policy "contacts: tenant isolation" on contacts for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "sites: tenant isolation" on sites;
create policy "sites: tenant isolation" on sites for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "assets: tenant isolation" on assets;
create policy "assets: tenant isolation" on assets for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "contracts: tenant isolation" on contracts;
create policy "contracts: tenant isolation" on contracts for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "leads: tenant isolation" on leads;
create policy "leads: tenant isolation" on leads for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "quotes: tenant isolation" on quotes;
create policy "quotes: tenant isolation" on quotes for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "quote_revisions: tenant isolation" on quote_revisions;
create policy "quote_revisions: tenant isolation" on quote_revisions for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "quote_lines: tenant isolation" on quote_lines;
create policy "quote_lines: tenant isolation" on quote_lines for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "technicians: tenant isolation" on technicians;
create policy "technicians: tenant isolation" on technicians for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "technician_leaves: tenant isolation" on technician_leaves;
create policy "technician_leaves: tenant isolation" on technician_leaves for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "service_cases: tenant isolation" on service_cases;
create policy "service_cases: tenant isolation" on service_cases for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "work_orders: tenant isolation" on work_orders;
create policy "work_orders: tenant isolation" on work_orders for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- invoices already got a correct, redundant membership-based policy in 0025
-- (added alongside this original one rather than replacing it). Fixing the
-- original here too so there's exactly one policy per action, not two.
drop policy if exists "invoices: tenant isolation" on invoices;
create policy "invoices: tenant isolation" on invoices for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "visit_logs: tenant isolation" on visit_logs;
create policy "visit_logs: tenant isolation" on visit_logs for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "activities: tenant isolation" on activities;
create policy "activities: tenant isolation" on activities for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "case_photos: tenant isolation" on case_photos;
create policy "case_photos: tenant isolation" on case_photos for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "inspection_reports: tenant isolation" on inspection_reports;
create policy "inspection_reports: tenant isolation" on inspection_reports for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "pricing_items: tenant isolation" on pricing_items;
create policy "pricing_items: tenant isolation" on pricing_items for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "text_fragments: tenant isolation" on text_fragments;
create policy "text_fragments: tenant isolation" on text_fragments for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
