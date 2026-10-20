-- 0143: preferred_language on contacts and accounts (docs/newsletter-studio-
-- architecture.md section 2.3; owner decision 2026-10-19: a STANDARD column,
-- not a per-workspace custom field, so the send rule is the same everywhere).
--
-- ISO 639-1 code (en, ar, hi, ur, fr), nullable. The Newsletter Studio resolves
-- a recipient's language in order: the contact's, the account's, the campaign's
-- fallback. It is a preference, so it is shown on both forms and editable by the
-- person themselves in the preference centre later; it exposes nothing new.
--
-- Additive and nullable: no existing read or write changes. contacts and
-- accounts already have their tenant-isolation policies (0000_baseline); new
-- columns inherit them. The app reads and writes this column defensively, so a
-- save works with or without this migration applied.

alter table contacts add column if not exists preferred_language text;
alter table accounts add column if not exists preferred_language text;

alter table contacts drop constraint if exists contacts_preferred_language_check;
alter table contacts add constraint contacts_preferred_language_check
  check (preferred_language is null or preferred_language ~ '^[a-z]{2}$');
alter table accounts drop constraint if exists accounts_preferred_language_check;
alter table accounts add constraint accounts_preferred_language_check
  check (preferred_language is null or preferred_language ~ '^[a-z]{2}$');
