-- 0160_leads_assignment_and_sla.sql
-- Marketing platform M2 shell (docs/marketing-platform-architecture.md 4.2, 4.3,
-- docs/shells/leads-shell.md): what a lead needs to carry its hand-over to a
-- salesperson -- when it became ready, when it was assigned, and why it went to
-- the person it did (so "nobody matched" is a visible chip, not a silent gap).
--
-- Additive and nullable: the existing Leads list and convert route never read
-- these columns. Requires 0140 (sla_due_at, owner_user_id already live there).
-- RLS: leads keeps its tenant-isolation policy from 0000_baseline; new columns
-- inherit it. Everything that writes these columns is behind features.marketing_scoring.

alter table leads add column if not exists ready_at timestamptz;
alter table leads add column if not exists assigned_at timestamptz;
alter table leads add column if not exists assignment_reason text
  check (assignment_reason is null or assignment_reason in
    ('team_lead', 'round_robin', 'fallback_admin', 'unassigned', 'manual', 'claimed'));

-- The "overdue" list: ready leads past their response time.
create index if not exists leads_tenant_sla_idx on leads (tenant_id, sla_due_at) where sla_due_at is not null;
