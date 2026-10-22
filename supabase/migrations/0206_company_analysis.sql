-- 0206_company_analysis.sql
--
-- Company analysis (docs/design/account-analysis.md section 4): the saved web half of an analysis, one row per workspace
-- and company. `company_key` is the normalised website domain, else the normalised name plus the country, so two accounts
-- that are the same company share one row inside a workspace and two workspaces never share one.
--
--   data           the validated claims, the size figure, the sentence and the verdict snapshot (never page bodies, never
--                  anything about a named person beyond a title the company itself published)
--   previous_data  the version before the last refresh, for "what changed since last time"
--   changes        that difference, as computed when the refresh ran
--   sources        address, title, publisher and fetch time of every page used: kept for audit, never shown on the card
--
-- What the card says about the workspace's own records (contacts, quotes, cases, invoices) is NOT stored: it is read live
-- on every render, with the person's own permissions.
--
-- Access: members of the workspace may READ the rows. There is deliberately NO insert/update/delete policy: only the
-- server writes, through the service role with the workspace in the filter, so a member cannot plant a finding that steers
-- who gets called (the 2026-08-12 and 2026-10-21 lesson). Nothing is added to `tenants`, so the column-grant rule of 0200
-- does not apply.
--
-- Additive and idempotent. Until it is applied an analysis still runs and is returned, just not saved.

create table if not exists company_analyses (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  company_key    text not null,
  account_id     uuid references accounts(id) on delete set null,
  name           text not null,
  domain         text,
  data           jsonb not null,
  previous_data  jsonb,
  changes        jsonb,
  sources        jsonb not null default '[]'::jsonb,
  version        integer not null default 1,
  searches       integer not null default 0,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  requested_by   uuid,
  computed_at    timestamptz not null default now(),
  expires_at     timestamptz not null
);

create unique index if not exists company_analyses_key on company_analyses (tenant_id, company_key);
create index if not exists company_analyses_account on company_analyses (tenant_id, account_id) where account_id is not null;
create index if not exists company_analyses_computed on company_analyses (tenant_id, computed_at);

alter table company_analyses enable row level security;

drop policy if exists "company_analyses: tenant read" on company_analyses;
create policy "company_analyses: tenant read" on company_analyses for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
