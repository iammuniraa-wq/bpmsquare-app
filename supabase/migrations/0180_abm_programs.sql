-- 0180: Account-Based Marketing, programs (docs/abm-architecture.md section 3.1).
-- A program is a named effort to win or grow a chosen set of companies, with a
-- goal and a time window. The doc numbered its migration 0137; that number was
-- taken by the domain event table, so ABM is 0180-0183:
--   0180 programs (this file)   0181 target accounts   0182 buying group members
--   0183 custom field object types.
-- Apply in that order. The demo seed scripts/seed-abm-demo.sql runs AFTER all four.
--
-- RLS: the standard tenant-isolation policy ("for all"). Programs, targets and
-- buying-group rows are CRM records a member edits, like accounts and contacts;
-- they are not pay, attendance or a score someone has a reason to forge.
-- Progress history is not a table: it is domain_event rows (0137).
--
-- Pending-migration behaviour: every route and page reads 42P01 / 42703 /
-- PGRST204 / PGRST205 as "waiting for the database update", never a crash.

create table if not exists abm_programs (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id) on delete cascade,
  ref                    text,                              -- ABM-0001, MASTER_REF_TABLES
  name                   text not null,
  kind                   text not null default 'new_business'
    check (kind in ('new_business', 'expansion')),
  goal                   text,                              -- one plain sentence
  goal_metric            text not null default 'deals_won'
    check (goal_metric in ('deals_won', 'deals_opened', 'accounts_engaged', 'revenue')),
  goal_target            numeric,
  starts_on              date,
  ends_on                date,
  owner_user_id          uuid,
  status                 text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'completed', 'archived')),
  default_tier           text not null default 'one_to_many'
    check (default_tier in ('one_to_one', 'one_to_few', 'one_to_many')),
  -- Which buying roles a target needs filled before it counts as complete.
  required_roles         text[] not null default array['decision_maker', 'influencer'],
  -- Where the list was built from. Remembered, never re-applied by itself.
  source_target_group_id uuid,
  source_segment_id      uuid,
  source_snapshot_at     timestamptz,
  custom_data            jsonb,
  created_by             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists abm_programs_tenant_status on abm_programs (tenant_id, status);
create unique index if not exists abm_programs_tenant_ref_key on abm_programs (tenant_id, ref) where ref is not null;

alter table abm_programs enable row level security;
drop policy if exists "abm_programs: tenant isolation" on abm_programs;
create policy "abm_programs: tenant isolation" on abm_programs for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
