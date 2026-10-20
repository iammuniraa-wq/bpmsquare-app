-- 0161_teams_assignment_mode.sql
-- Marketing platform M2 shell (docs/marketing-platform-architecture.md 4.3):
-- how a Coverage team hands out sales-ready leads.
--   'lead'        the team lead gets them (today's behaviour for accounts; default)
--   'round_robin' the next member in turn, after last_assigned_user_id
--
-- Additive; every existing team stays 'lead'. teams keeps its SELECT-only RLS
-- (0101): the value is written only by the admin-only Coverage route, and
-- last_assigned_user_id only by the server when it assigns a lead.

alter table teams add column if not exists assignment_mode text not null default 'lead'
  check (assignment_mode in ('lead', 'round_robin'));
alter table teams add column if not exists last_assigned_user_id uuid;
