-- run-bundle-32-tender-approval-and-room-2026-10-25.sql
-- Paste into the Supabase SQL editor of each database (dev, then production). Safe to run twice.
-- Run bundle 31 (= 0220) FIRST: both files below need opportunity_tenders.
-- = migration 0221: GCC tender deals, slice 1b. Creates approval_requests (one row per bid / no-bid proposal, the row is the history;
--   a tenant SELECT policy ONLY, every write is a service-role route) and adds bond_status / bond_released_at / bond_released_by
--   to opportunity_tenders. No column is added to opportunities.
-- The app works before and after: until it runs, the Tender tab says a database update is needed, proposing answers 503, the stage
--   guard stays at its slice-1 behaviour, and nothing crashes.


-- 0221_tender_approval_and_bond.sql
--
-- GCC tender deals, slice 1b (docs/design/gcc-tender-deals.md section 10, "Slice 1b"). Needs 0220 (opportunity_tenders).
--
-- 1. approval_requests: a small, generic table, NOT an engine. One row per proposal: who proposed what (proposed_value) and
--    why, then who decided, when, and with which comment. The row IS the history: a rejected or withdrawn proposal stays, and
--    a new proposal is a new row. Slice 1b uses kind 'tender_bid_decision' (proposed_value 'go' or 'no_go'); slice 5 reuses
--    the table for the project baseline. At most ONE proposal per record and kind can be pending at a time (partial unique
--    index), so two people cannot decide the same question twice and a race ends in a clean 23505.
-- 2. opportunity_tenders gains the bond's life: bond_status held / released, when and by whom. A released bond stops the
--    expiry warning and the reminders that mention the bond.
--
-- RLS (MULTI_TENANT_GUARDRAILS.md; the 0199 lesson): approval_requests carries a tenant SELECT policy and NOTHING that
-- writes. A member must not be able to approve their own proposal, forge a decision under a manager's name, or rewrite the
-- history through PostgREST with their own session token, so every write is a service-role API route that has already
-- checked the tenant, the caller and the approver list.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the Tender tab explains that a database update is
-- needed, the stage guard stays at its slice-1 behaviour, and nothing crashes (42P01 / 42703 / PGRST205 read as "not there yet").

create table if not exists approval_requests (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  object_type      text not null,
  object_id        uuid not null,
  kind             text not null,
  proposed_value   text not null,
  reason           text,
  requested_by     uuid not null,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_comment text,
  created_at       timestamptz not null default now()
);

create index if not exists approval_requests_object_idx
  on approval_requests (tenant_id, object_type, object_id, kind, created_at desc);

create unique index if not exists approval_requests_one_pending
  on approval_requests (tenant_id, object_type, object_id, kind) where status = 'pending';

alter table approval_requests enable row level security;

drop policy if exists "approval_requests: tenant read" on approval_requests;
create policy "approval_requests: tenant read" on approval_requests for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

alter table if exists opportunity_tenders add column if not exists bond_status text not null default 'held' check (bond_status in ('held', 'released'));
alter table if exists opportunity_tenders add column if not exists bond_released_at timestamptz;
alter table if exists opportunity_tenders add column if not exists bond_released_by uuid;
