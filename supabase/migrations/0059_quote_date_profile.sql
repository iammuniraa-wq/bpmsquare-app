-- 0059_quote_date_profile.sql
-- Date profile for both quote objects. Until now the only reliably-correct
-- date on either was created_at: quotes had no updated_at at all, no record
-- of when a quote actually reached the customer, and no closed date (outcome
-- won/lost is a bare flag); standard_quotes.updated_at existed but nothing
-- ever wrote it, and sent_at was only stamped by "Mark as sent", not by
-- actually emailing the quote.
--
-- inquiry_date is business-entered (the customer asked before the quote
-- existed, so it can't be auto-stamped). submitted_at/sent_at and closed_at
-- are auto-stamped by the API on the relevant transitions but manually
-- overridable (a quote handed over on WhatsApp or closed verbally happened
-- outside the system). updated_at is system-only, written by every mutating
-- route.

alter table quotes
  add column inquiry_date date,
  add column submitted_at timestamptz,
  add column closed_at    timestamptz,
  add column updated_at   timestamptz not null default now();

alter table standard_quotes
  add column inquiry_date date,
  add column closed_at    timestamptz;
