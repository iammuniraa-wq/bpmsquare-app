-- 0181: Account-Based Marketing, target accounts (docs/abm-architecture.md section 3.2).
-- One company inside one program. The same account can be a target in several
-- programs, each with its own tier, progress and owner, so the key is
-- (tenant, program, account). Requires 0180. Standard tenant-isolation RLS.
--
-- Progress is a status, not a score: planned > reached > engaged > in_talks >
-- deal_open > won | lost, or dropped. progress_source records whether the last
-- change came from the fixed rules (src/lib/abm/progress.ts) or a person; a
-- manual change always carries a reason (checked in the route), and a dropped
-- target must carry one (the constraint below).
--
-- Targets and members are children: no master ref of their own, they are
-- referenced through their program and account, and their own id is the
-- update contract (bpmsquarecore section 3).

create table if not exists abm_target_accounts (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  program_id           uuid not null references abm_programs(id) on delete cascade,
  account_id           uuid not null references accounts(id) on delete cascade,
  tier                 text not null default 'one_to_many'
    check (tier in ('one_to_one', 'one_to_few', 'one_to_many')),
  progress             text not null default 'planned'
    check (progress in ('planned', 'reached', 'engaged', 'in_talks', 'deal_open', 'won', 'lost', 'dropped')),
  progress_source      text not null default 'rule' check (progress_source in ('rule', 'manual')),
  progress_reason      text,
  progress_changed_at  timestamptz not null default now(),
  progress_changed_by  uuid,                              -- the person for a manual change, null for a rule
  owner_user_id        uuid,
  owner_source         text not null default 'coverage' check (owner_source in ('coverage', 'program', 'manual')),
  next_step            text,
  next_step_due        date,
  next_step_user_id    uuid,
  added_via            text not null default 'manual' check (added_via in ('segment', 'target_group', 'manual', 'import')),
  added_by             uuid,
  dropped_reason       text,
  opportunity_id       uuid references opportunities(id) on delete set null,
  notes                text,
  custom_data          jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint abm_target_dropped_needs_reason check (progress <> 'dropped' or coalesce(trim(dropped_reason), '') <> '')
);

create unique index if not exists abm_targets_program_account_key on abm_target_accounts (tenant_id, program_id, account_id);
create index if not exists abm_targets_tenant_program on abm_target_accounts (tenant_id, program_id);
create index if not exists abm_targets_tenant_account on abm_target_accounts (tenant_id, account_id);
create index if not exists abm_targets_tenant_opportunity on abm_target_accounts (tenant_id, opportunity_id) where opportunity_id is not null;

alter table abm_target_accounts enable row level security;
drop policy if exists "abm_target_accounts: tenant isolation" on abm_target_accounts;
create policy "abm_target_accounts: tenant isolation" on abm_target_accounts for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
