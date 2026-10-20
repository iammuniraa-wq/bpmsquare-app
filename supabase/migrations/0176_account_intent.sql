-- 0176: Buying signals shell (docs/signals-architecture.md section 7.3).
-- account_intent: the ONE stored result per account -- score, stage and the
-- working behind them. The list, the Account 360 card, the segment fields and
-- getBuyingStage() all read this row; no surface computes its own number.
-- Written only by src/lib/signals/recompute.ts (cron and "Rescore now").
--
-- Accounts with no signal and no earlier row simply have no row: absence means
-- Quiet, score 0, so the table holds only accounts that have ever mattered.
--
-- RLS: members SELECT their tenant's rows; NO write policy. A score decides who
-- gets called first, so a member must not be able to forge one through
-- PostgREST with their own session (the WFM overtime lesson, MULTI_TENANT_GUARDRAILS.md).

create table if not exists account_intent (
  tenant_id                 uuid not null references tenants(id) on delete cascade,
  account_id                uuid not null references accounts(id) on delete cascade,
  score                     int not null default 0 check (score between 0 and 100),
  stage                     text not null default 'quiet' check (stage in ('quiet', 'looking', 'comparing', 'deciding')),
  previous_stage            text check (previous_stage in ('quiet', 'looking', 'comparing', 'deciding')),
  -- [{group, label, points, detail}] -- the rubric's own working.
  factors                   jsonb not null default '[]'::jsonb,
  -- The newest few signals in words: [{kind, group, source, headline, occurred_at, href}].
  top_signals               jsonb not null default '[]'::jsonb,
  signal_count              int not null default 0,
  stage_changed_at          timestamptz,
  -- A person said "not in market": the score is held at zero for 30 days.
  marked_not_in_market_at   timestamptz,
  computed_at               timestamptz not null default now(),
  primary key (tenant_id, account_id)
);

create index if not exists account_intent_rank_idx on account_intent (tenant_id, score desc);
create index if not exists account_intent_stage_idx on account_intent (tenant_id, stage);

alter table account_intent enable row level security;
drop policy if exists "account_intent: tenant read" on account_intent;
create policy "account_intent: tenant read" on account_intent for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
-- No write policy on purpose.
