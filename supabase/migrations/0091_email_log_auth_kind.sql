-- Password-reset emails are now sent by us (POST /api/auth/request-reset)
-- rather than by Supabase Auth, so they belong in the outbound email log
-- alongside quote/campaign/wfm sends -- an admin asking "did the reset link
-- actually go out?" should be able to answer it from Administration →
-- Outbound Emails instead of guessing.
alter table email_log drop constraint if exists email_log_kind_check;
alter table email_log add constraint email_log_kind_check
  check (kind in ('quote', 'campaign', 'wfm', 'auth'));
