-- 0197: double opt-in. The consent ledger gains one more word, 'pending': a person ticked the
-- box on a form that asks them to confirm by email, and has not confirmed yet.
--
-- Only consent_events (the append-only ledger) takes it. consent_state, the table canContact()
-- reads, keeps its two values, so a pending answer can never be read as a yes and never covers
-- over an earlier real answer. Confirming (the signed link in the thank-you email) appends a
-- 'granted' row through recordConsent, which is what puts it into consent_state.
--
-- Additive and idempotent: the old rows all satisfy the wider check. Requires 0139.
-- While this is pending the form still works: a double-opt-in form records no consent at all
-- (and logs it) rather than writing a yes the person has not confirmed.

alter table consent_events drop constraint if exists consent_events_status_check;
alter table consent_events add constraint consent_events_status_check check (status in ('granted', 'withdrawn', 'pending'));

-- Finding "waiting for confirmation" rows for one person.
create index if not exists consent_events_pending_idx on consent_events (tenant_id, contact_id, created_at desc) where status = 'pending';
