-- 0207_business_roles_rls.sql
--
-- Security audit 2026-10-22, finding M2 (docs/security-audit-2026-10-22.md).
--
-- business_roles, business_role_grants and business_user_roles (0052) carry the
-- generic "tenant isolation" policy FOR ALL, so any member of the workspace can
-- write them straight through PostgREST with their own session -- the admin
-- check in /api/business-roles* and /api/settings/team/[id]/roles is cosmetic
-- for these tables. A member restricted by a Business Role could
--   DELETE /rest/v1/business_user_roles?user_id=eq.<self>
-- and resolvePermissions() would return UNRESTRICTED (no role = full member
-- access), or insert grants (can_delete) into their own role.
--
-- Members keep SELECT (resolvePermissions reads their own roles and grants with
-- the session client); INSERT / UPDATE / DELETE need tenant_users.role = 'admin'
-- of the row's workspace. The application routes write through the service role
-- after their own admin check, so nothing changes for them. Same pattern as
-- tenant_connectors in 0199. Idempotent; each block runs only if its table
-- exists (migrations are applied by hand, 2026-10-21).

do $$ begin
  if to_regclass('public.business_roles') is null then
    return;
  end if;
  execute 'drop policy if exists "business_roles: tenant isolation" on business_roles';
  execute 'drop policy if exists "business_roles: tenant read" on business_roles';
  execute 'drop policy if exists "business_roles: admin insert" on business_roles';
  execute 'drop policy if exists "business_roles: admin update" on business_roles';
  execute 'drop policy if exists "business_roles: admin delete" on business_roles';
  execute $p$create policy "business_roles: tenant read" on business_roles for select
    using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))$p$;
  execute $p$create policy "business_roles: admin insert" on business_roles for insert
    with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'))$p$;
  execute $p$create policy "business_roles: admin update" on business_roles for update
    using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'))
    with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'))$p$;
  execute $p$create policy "business_roles: admin delete" on business_roles for delete
    using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'))$p$;
end $$;

do $$ begin
  if to_regclass('public.business_role_grants') is null then
    return;
  end if;
  execute 'drop policy if exists "business_role_grants: tenant isolation" on business_role_grants';
  execute 'drop policy if exists "business_role_grants: tenant read" on business_role_grants';
  execute 'drop policy if exists "business_role_grants: admin insert" on business_role_grants';
  execute 'drop policy if exists "business_role_grants: admin update" on business_role_grants';
  execute 'drop policy if exists "business_role_grants: admin delete" on business_role_grants';
  execute $p$create policy "business_role_grants: tenant read" on business_role_grants for select
    using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))$p$;
  execute $p$create policy "business_role_grants: admin insert" on business_role_grants for insert
    with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'))$p$;
  execute $p$create policy "business_role_grants: admin update" on business_role_grants for update
    using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'))
    with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'))$p$;
  execute $p$create policy "business_role_grants: admin delete" on business_role_grants for delete
    using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'))$p$;
end $$;

do $$ begin
  if to_regclass('public.business_user_roles') is null then
    return;
  end if;
  execute 'drop policy if exists "business_user_roles: tenant isolation" on business_user_roles';
  execute 'drop policy if exists "business_user_roles: tenant read" on business_user_roles';
  execute 'drop policy if exists "business_user_roles: admin insert" on business_user_roles';
  execute 'drop policy if exists "business_user_roles: admin update" on business_user_roles';
  execute 'drop policy if exists "business_user_roles: admin delete" on business_user_roles';
  execute $p$create policy "business_user_roles: tenant read" on business_user_roles for select
    using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))$p$;
  execute $p$create policy "business_user_roles: admin insert" on business_user_roles for insert
    with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'))$p$;
  execute $p$create policy "business_user_roles: admin update" on business_user_roles for update
    using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'))
    with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'))$p$;
  execute $p$create policy "business_user_roles: admin delete" on business_user_roles for delete
    using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'))$p$;
end $$;
