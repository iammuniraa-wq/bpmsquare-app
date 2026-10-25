-- run-bundle-35-tender-bids-2026-10-26.sql
-- Paste into the Supabase SQL editor of each database (dev, then production). Safe to run twice.
-- = migration 0225: GCC tender deals, slice 4. Creates tender_bid_versions (one row per bid that went in: an append-only snapshot of
--   the deal lines in the client's file order, never a cost or a markup; no cap on versions; a reason is required from version 2; an
--   UPDATE is refused by a trigger) and deal_activities (calls, meetings, site visits and notes with an optional next step and due
--   date), each with RLS and a tenant SELECT policy ONLY (every write goes through a service-role API route). Adds the four outcome
--   columns award_value, winning_bidder, award_date and outcome_note to opportunity_tenders.
-- Needs 0120 (opportunities) and 0220 (opportunity_tenders) before it (bundle 31); it does not need bundles 32 to 34.
-- The app works before and after: until it runs, the Bids tab, the calls list and the Outcome section say a database update is needed,
--   and every other tender screen is unchanged; nothing crashes (42P01 / 42703 / PGRST205 are read as "not there yet").
-- Demo data: none.


-- 0225: bid versions, logged calls and outcome facts of a tender deal.
-- GCC tender deals, slice 4 (docs/design/gcc-tender-deals.md section 15). Needs 0120 (opportunities) and 0220 (opportunity_tenders).
--
-- 1. tender_bid_versions: one row per bid that went in. Append-only: the application only ever inserts (there is no update or delete
--    route), a trigger refuses an UPDATE, and the unique (opportunity_id, version_no) makes two people submitting at once safe (the
--    second insert fails and is told so). There is no cap on the number of versions. `lines` is the snapshot of the deal lines at the
--    moment of submission (item no, description, unit, qty, rate, amount, product ref, price source) in the client's file order; it
--    NEVER carries a cost or a markup. Version 2 onwards must say why the bid was revised (revision_reason, checked here as well).
-- 2. deal_activities: calls, meetings, site visits and notes logged against a deal, with an optional next step and due date.
--    next_step_done_at lets a person tick a next step off so it stops showing as overdue.
-- 3. opportunity_tenders gets the four outcome facts: award_value, winning_bidder, award_date, outcome_note. (The loss reason and the
--    competitor stay on the deal, where they already are.)
--
-- RLS (MULTI_TENANT_GUARDRAILS.md, the WFM and 0199 lessons): both new tables carry a tenant SELECT policy and NOTHING that writes. A
-- submitted bid is the record of what was offered, so a member must not be able to forge or erase one through PostgREST; every write is
-- a service-role API route that has already checked the tenant, the deal and the caller's access to the Pipeline.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the Bids tab, the calls list and the Outcome section say a
-- database update is needed and nothing else changes (42P01 / 42703 / PGRST205 are read as "not there yet").

create table if not exists tender_bid_versions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  opportunity_id   uuid not null references opportunities(id) on delete cascade,
  version_no       int not null check (version_no >= 1),
  submitted_at     timestamptz not null default now(),
  submitted_by     uuid,
  currency         text,
  total            numeric(16,2) not null default 0,
  line_count       int not null default 0,
  lines            jsonb not null default '[]'::jsonb,
  note             text check (note is null or char_length(note) <= 1000),
  revision_reason  text check (revision_reason is null or char_length(revision_reason) between 3 and 1000),
  unique (opportunity_id, version_no),
  check (version_no = 1 or revision_reason is not null)
);

create index if not exists tender_bid_versions_deal on tender_bid_versions (tenant_id, opportunity_id, version_no desc);

create or replace function tender_bid_versions_no_update() returns trigger as $$
begin
  raise exception 'a submitted bid version cannot be changed';
end;
$$ language plpgsql;

drop trigger if exists tender_bid_versions_immutable on tender_bid_versions;
create trigger tender_bid_versions_immutable before update on tender_bid_versions
  for each row execute function tender_bid_versions_no_update();

alter table tender_bid_versions enable row level security;
drop policy if exists "tender_bid_versions: tenant read" on tender_bid_versions;
create policy "tender_bid_versions: tenant read" on tender_bid_versions for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists deal_activities (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  opportunity_id    uuid not null references opportunities(id) on delete cascade,
  kind              text not null default 'call' check (kind in ('call', 'meeting', 'site_visit', 'note')),
  occurred_at       timestamptz not null default now(),
  with_whom         text check (with_whom is null or char_length(with_whom) <= 200),
  summary           text not null check (char_length(summary) between 1 and 2000),
  outcome           text check (outcome is null or char_length(outcome) <= 500),
  next_step         text check (next_step is null or char_length(next_step) <= 300),
  next_step_due     date,
  next_step_done_at timestamptz,
  logged_by         uuid,
  created_at        timestamptz not null default now(),
  check (next_step_due is null or next_step is not null)
);

create index if not exists deal_activities_deal on deal_activities (tenant_id, opportunity_id, occurred_at desc);
create index if not exists deal_activities_due on deal_activities (tenant_id, next_step_due) where next_step_due is not null and next_step_done_at is null;

alter table deal_activities enable row level security;
drop policy if exists "deal_activities: tenant read" on deal_activities;
create policy "deal_activities: tenant read" on deal_activities for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

alter table opportunity_tenders add column if not exists award_value    numeric(16,2) check (award_value is null or award_value >= 0);
alter table opportunity_tenders add column if not exists winning_bidder  text check (winning_bidder is null or char_length(winning_bidder) <= 200);
alter table opportunity_tenders add column if not exists award_date      date;
alter table opportunity_tenders add column if not exists outcome_note    text check (outcome_note is null or char_length(outcome_note) <= 1000);
