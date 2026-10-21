-- 0198: the hand-over settings need three small things from the leads table
-- (docs/shells/leads-shell.md, Settings -> Marketing -> Hand-over).
--
--   1. leads.source gains 'inbound': a lead the scoring run makes by itself when a person with
--      no open lead becomes Engaged. The list keeps every value it had, 'form' included, so
--      this is safe whether or not 0172 has been applied.
--   2. leads.assignment_reason gains 'fallback_list': the lead went to a person on the
--      workspace's own "when no team covers it" list.
--   3. At most one OPEN auto-created lead per person: two overlapping scoring runs cannot both
--      make one. A lead made any other way is not affected.
--
-- Additive. RLS is unchanged (leads keeps its tenant policy). While this is pending the app
-- degrades: auto-creating leads does nothing, and a lead handed to the fallback list is filed
-- without the reason instead of failing.

alter table leads drop constraint if exists leads_source_check;
alter table leads add constraint leads_source_check
  check (source in ('oem_referral', 'amc', 'direct', 'campaign', 'form', 'inbound'));

alter table leads drop constraint if exists leads_assignment_reason_check;
alter table leads add constraint leads_assignment_reason_check
  check (assignment_reason is null or assignment_reason in
    ('team_lead', 'round_robin', 'fallback_admin', 'fallback_list', 'unassigned', 'manual', 'claimed'));

create unique index if not exists leads_one_open_inbound_idx
  on leads (tenant_id, contact_id)
  where source = 'inbound' and contact_id is not null and status in ('new', 'inspecting', 'quoted');
