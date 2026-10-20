-- 0177: Buying signals shell (docs/signals-architecture.md section 9.4).
-- account_intent_history: one row per account per day with the score, stage and
-- factors as they were. "Did it work?" reads the days before and after a send
-- from here; nothing else does, and nothing keeps a private copy.
--
-- Written only by the recompute (an upsert on the primary key, so running it
-- twice in a day writes the same row twice, not two rows). Rows older than 120
-- days are removed by the same cron. A day with no row means Quiet, score 0.
--
-- RLS: members SELECT their tenant's rows; NO write policy (history that drives a
-- before/after claim must not be editable from a session token).
-- Run after 0176.

create table if not exists account_intent_history (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  account_id  uuid not null references accounts(id) on delete cascade,
  day         date not null,
  score       int not null check (score between 0 and 100),
  stage       text not null check (stage in ('quiet', 'looking', 'comparing', 'deciding')),
  factors     jsonb not null default '[]'::jsonb,
  primary key (tenant_id, account_id, day)
);

create index if not exists account_intent_history_day_idx on account_intent_history (tenant_id, day);

alter table account_intent_history enable row level security;
drop policy if exists "account_intent_history: tenant read" on account_intent_history;
create policy "account_intent_history: tenant read" on account_intent_history for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
-- No write policy on purpose.
