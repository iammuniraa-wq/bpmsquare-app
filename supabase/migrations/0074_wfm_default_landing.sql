-- Lets a WFM supervisor choose their own default landing page (Live Board
-- vs the plain CRM Dashboard) instead of always being forced to one. Null
-- means "use the role-based default" (Live Board for a supervisor) --
-- additive, defaults null, no existing login's behaviour changes.

alter table tenant_users
  add column if not exists wfm_default_landing text
    check (wfm_default_landing in ('live_board', 'dashboard'));
