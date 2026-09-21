-- email_log.kind was never widened for the invoice and RFQ senders, so those
-- two emails go out and are NOT logged (owner question 2026-09-21: "recheck
-- if outbound emails are logged").
--
-- How it went unnoticed: logEmail() (src/lib/emailLog.ts) deliberately never
-- throws -- "a logging failure must not fail the send it's describing", since
-- the mail may already have left. So every invoice and RFQ email since those
-- senders shipped has had its log row rejected by this CHECK constraint and
-- the rejection swallowed. The sends themselves were always fine; only the
-- record of them is missing, and it cannot be backfilled.
--
-- EmailLogKind in TypeScript has read
--   "quote" | "invoice" | "campaign" | "wfm" | "auth" | "rfq"
-- while the constraint stopped at 0091's four. This brings the database to
-- the same list. Nothing else changes: same table, same policies, same
-- indexes.
--
-- Two kinds share a value on purpose and need no entry of their own:
-- standard-quote emails log as 'quote' (one Outbound Emails filter for both
-- quote families is what an admin actually wants), and every WFM
-- notification -- late arrival, correction, leave, recheck, clarification --
-- logs as 'wfm'.

alter table email_log drop constraint if exists email_log_kind_check;
alter table email_log add constraint email_log_kind_check
  check (kind in ('quote', 'invoice', 'campaign', 'wfm', 'auth', 'rfq'));

-- Confirm the constraint now matches the application's own list.
-- select pg_get_constraintdef(oid) from pg_constraint
-- where conname = 'email_log_kind_check';
