-- tenant_users has an existing index on (tenant_id, user_id) — tenant_id
-- leading. But my_tenant_ids() (migration 0029) and effectively every RLS
-- policy in the schema resolve tenant membership via
--   select tenant_id from tenant_users where user_id = auth.uid()
-- a lookup filtered on user_id alone, which a (tenant_id, user_id) index
-- can't serve efficiently (tenant_id isn't a known predicate). That query
-- runs on nearly every RLS-protected read/write in the app, so it's the
-- single most-executed unindexed-for-its-actual-predicate lookup in the
-- schema. Index on (user_id, tenant_id) so it's also index-only for
-- my_tenant_ids().
create index if not exists tenant_users_user_id_tenant_id_idx
  on tenant_users (user_id, tenant_id);
