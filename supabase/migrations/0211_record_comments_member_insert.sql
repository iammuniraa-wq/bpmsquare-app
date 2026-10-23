-- 0211_record_comments_member_insert.sql
--
-- Security audit 2026-10-21, finding L1 (docs/security-audit-2026-10-21.md).
--
-- record_comments (0089) keeps a member INSERT policy that checks only the tenant.
-- RLS cannot constrain column values it does not check, so any member could write
--   POST /rest/v1/record_comments {author_email: <colleague>, mentions: [<anyone>], ...}
-- with their own session token and forge who said what, or notify an arbitrary address.
--
-- POST /api/nova/comments now writes with the service role after it has checked the
-- module, the workcenter grant and the record, and takes author_id/author_email from
-- the session and mentions from real workspace members only. Members keep SELECT.
-- Idempotent; runs only if the table exists. The app comments the same way before
-- and after this migration.

do $$ begin
  if to_regclass('public.record_comments') is null then
    return;
  end if;
  execute 'drop policy if exists "record_comments: tenant insert" on record_comments';
end $$;
