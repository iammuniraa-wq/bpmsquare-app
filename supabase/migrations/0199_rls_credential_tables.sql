-- 0199_rls_credential_tables.sql
--
-- Security audit 2026-10-21 (docs/security-audit-2026-10-21.md, findings H1 and H2).
--
-- Three tables that hold or steer credentials carried the generic
-- "tenant isolation" policy FOR ALL, which lets ANY member of the workspace
-- (a WFM employee included) read and write them straight through PostgREST
-- with their own session -- the anon key is public by design, and the same
-- attack was closed for wfm_ot_sessions in 0078. What that allowed:
--
--   api_keys          a member inserts a row whose token_hash is sha256 of a key
--                     they invented, with scopes {read,write,objects:[...]},
--                     then calls /api/v1 with it: full read/write of the
--                     workspace's data, employees and contacts included. The
--                     admin-only gate on /api/settings/api-keys was cosmetic.
--   webhooks          a member registers an endpoint of their own and the
--                     dispatcher (service role) posts the signed change feed of
--                     the whole workspace to it.
--   tenant_connectors a member rewrites config.smtp_host / imap_host of the
--                     mail-server connector; the next RFQ mail or mailbox poll
--                     logs in to THEIR host with the decrypted mailbox password.
--
-- The application never needs the session client on the first two (every
-- route uses createAdminSupabase() with an explicit tenant_id filter), so they
-- become service-role-only: RLS stays enabled and no policy remains. The third
-- is read through the session client by non-admin requests (the RFQ buyer's
-- send path), so members keep SELECT (credentials are ciphertext) and only an
-- admin of the workspace may write.

-- Each block runs only if its table exists: the owner applies migrations by
-- hand and a database that never had 0049 (tenant_connectors) or 0081/0082
-- must not roll the whole script back on a missing table (42P01, 2026-10-21).

-- api_keys: service role only.
do $$ begin
  if to_regclass('public.api_keys') is null then
    return;
  end if;
  execute 'drop policy if exists "api_keys: tenant isolation" on api_keys';
end $$;

-- webhooks: service role only. webhook_deliveries keeps its member read policy.
do $$ begin
  if to_regclass('public.webhooks') is null then
    return;
  end if;
  execute 'drop policy if exists "webhooks: tenant isolation" on webhooks';
end $$;

-- tenant_connectors: members read; admins write.
do $$ begin
  if to_regclass('public.tenant_connectors') is null then
    return;
  end if;
  execute 'drop policy if exists "tenant_connectors: tenant isolation" on tenant_connectors';
  execute 'drop policy if exists "tenant_connectors: tenant read" on tenant_connectors';
  execute 'drop policy if exists "tenant_connectors: admin insert" on tenant_connectors';
  execute 'drop policy if exists "tenant_connectors: admin update" on tenant_connectors';
  execute 'drop policy if exists "tenant_connectors: admin delete" on tenant_connectors';
  execute $p$create policy "tenant_connectors: tenant read" on tenant_connectors for select
    using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))$p$;
  execute $p$create policy "tenant_connectors: admin insert" on tenant_connectors for insert
    with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'))$p$;
  execute $p$create policy "tenant_connectors: admin update" on tenant_connectors for update
    using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'))
    with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'))$p$;
  execute $p$create policy "tenant_connectors: admin delete" on tenant_connectors for delete
    using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid() and role = 'admin'))$p$;
end $$;
