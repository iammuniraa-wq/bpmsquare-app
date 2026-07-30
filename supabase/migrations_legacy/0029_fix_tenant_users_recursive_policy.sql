-- Fix: "infinite recursion detected in policy for relation tenant_users"
-- (reproduced creating an Account on vikas.bpmsquare.com, 2026-07-19)
--
-- 0028 replaced the stale-JWT auth_tenant_id() check on ~20 tables with a
-- live subquery against tenant_users:
--   tenant_id in (select tenant_id from tenant_users where user_id = auth.uid())
-- That subquery runs under the caller's session and must itself satisfy
-- tenant_users' own RLS policies. But tenant_users' pre-existing
-- "members read own tenant" SELECT policy is self-referential — it
-- subqueries tenant_users to decide whether you're allowed to read
-- tenant_users — so Postgres recurses evaluating it and errors out.
-- This recursive policy predates 0028 and was always broken, but sat
-- dormant: nothing queried tenant_users under RLS until 0028 made every
-- other table's policy do exactly that.
--
-- Fix: a SECURITY DEFINER function bypasses RLS on its own internal query
-- (it runs as the function owner, which owns tenant_users and isn't
-- subject to its own table's RLS), breaking the recursion. Same pattern
-- already used by is_platform_admin() elsewhere in this schema.

create or replace function my_tenant_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select tenant_id from tenant_users where user_id = auth.uid()
$$;

drop policy if exists "tenant_users: members read own tenant" on tenant_users;
create policy "tenant_users: members read own tenant" on tenant_users for select
  using (tenant_id in (select my_tenant_ids()));
