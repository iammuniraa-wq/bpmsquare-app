-- 0138_contacts_email_hash.sql
-- Marketing platform phase M0 (docs/marketing-platform-architecture.md 1.1):
--  * contacts.email_hash -- a blind index (HMAC-SHA256 of the lower-cased,
--    trimmed address, keyed by a subkey derived from FIELD_ENCRYPTION_KEY).
--    Contact emails are AES-GCM encrypted with a random IV, so two
--    encryptions of one address differ and no query can find a contact by
--    email; forms, the preference centre and bounce webhooks need exactly
--    that. The hash reveals nothing without the key and is never returned by
--    any API, export or screen (decryptContact() strips it).
--  * contacts.do_not_contact -- a hard stop on every channel, set by a person
--    or a rep, never by a rule. canContact() refuses on it first.
--
-- Additive and nullable/defaulted: no existing read or write changes. The app
-- sets email_hash in a separate best-effort statement after each contact
-- write, so a contact save works with or without this migration applied.
-- Existing rows are filled by scripts/backfill-contact-email-hash.ts (the
-- owner runs it once, after this).
--
-- Duplicates are expected in real data (the same person at two accounts), so
-- the index is deliberately NOT unique; the form rule in the design handles it.
--
-- RLS: contacts already has its tenant-isolation policy (0000_baseline); new
-- columns on it inherit that.

alter table contacts add column if not exists email_hash text;
alter table contacts add column if not exists do_not_contact boolean not null default false;

create index if not exists contacts_email_hash_idx on contacts (tenant_id, email_hash) where email_hash is not null;
