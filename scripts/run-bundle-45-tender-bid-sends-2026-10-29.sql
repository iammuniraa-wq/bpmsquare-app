-- run-bundle-45-tender-bid-sends-2026-10-29.sql
-- Sent to client: what went to the client on a tender, and how. = migration 0237. Safe to run twice. Paste into the Supabase SQL editor of each database (dev, then production, then KAMCO). Needs 0120 (opportunities).

-- 0237: Sent to client -- what went to the client on a tender, and how.
-- KAMCO feedback, slice 5 (docs/design/kamco-feedback-build-spec.md section 7). Needs 0220 (tenders) and 0120 (opportunities).
--
-- tender_bid_sends: one row each time the priced BOQ or the answer sheet (or another document) was handed to the client:
--
--   channel    email (sent from the tender), portal (uploaded to the client's portal, recorded by hand), other
--   document   priced_boq, answer_sheet, other
--   to_text    who it went to, as written (an address, or "Ariba"); on a demo workspace the redirect is named here
--   version_no the submitted bid version it belongs to, when the person says so
--   email_log_id reserved for the outbound-email row of an emailed send
--
-- RLS (MULTI_TENANT_GUARDRAILS.md, the 0199 lesson): a tenant SELECT policy and NOTHING that writes. A "sent" record is evidence of
-- what the client was given, so a member must not be able to forge or erase one through PostgREST; every write is a service-role API
-- route that has already checked the tenant, the deal and the caller's access to the Pipeline.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the Bid tab says a database update is needed for the Sent to
-- client records, "Send by email" refuses before anything is sent, and nothing else changes (42P01 / PGRST205 are read as "not there yet").

do $$
begin
  if to_regclass('public.opportunities') is null then
    raise exception 'Run 0120 (opportunities) first, then run this again.';
  end if;
end $$;

create table if not exists tender_bid_sends (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  opportunity_id  uuid not null references opportunities(id) on delete cascade,
  version_no      int,
  sent_at         timestamptz not null default now(),
  sent_by         uuid,
  channel         text not null check (channel in ('email', 'portal', 'other')),
  document        text not null check (document in ('priced_boq', 'answer_sheet', 'other')),
  to_text         text check (to_text is null or char_length(to_text) <= 300),
  note            text check (note is null or char_length(note) <= 1000),
  email_log_id    uuid,
  created_at      timestamptz not null default now()
);

create index if not exists tender_bid_sends_deal_idx on tender_bid_sends (tenant_id, opportunity_id, sent_at desc);

alter table tender_bid_sends enable row level security;

drop policy if exists "tender_bid_sends: tenant read" on tender_bid_sends;
create policy "tender_bid_sends: tenant read" on tender_bid_sends for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
