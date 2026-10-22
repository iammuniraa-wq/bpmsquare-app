-- run-bundle-17-changelog-2026-10-22.sql
-- Security audit 2026-10-22, AI slice (M1). Paste into the Supabase SQL editor of each database (dev, then production).
-- = migration 0208 (change_log: members read, only the server writes). Safe to run twice.
-- The app keeps logging changes before and after this; it only closes the member write path.


-- 0208_change_log_member_insert.sql
--
-- Security audit 2026-10-22 (AI assistant slice), finding M1
-- (docs/security-audit-2026-10-22-ai.md).
--
-- change_log (0050) keeps a member INSERT policy that checks only the tenant. The
-- table is audit evidence (Change History, webhooks, the briefing's "Yesterday",
-- and since 0205 the "via assistant" mark), but RLS cannot constrain column
-- values it does not check, so any member could write
--   POST /rest/v1/change_log {actor_id: <colleague>, via: 'assistant', ...}
-- with their own session token and forge who did what.
--
-- The application now writes change_log only through logChange()/logChangeBatch()
-- (src/lib/changeLog.ts) with the service role, and tenant id and actor come from
-- requireTenantUser(). Members keep SELECT. Idempotent; runs only if the table
-- exists. The app logs changes the same way before and after this migration.

do $$ begin
  if to_regclass('public.change_log') is null then
    return;
  end if;
  execute 'drop policy if exists "change_log: tenant insert" on change_log';
end $$;
