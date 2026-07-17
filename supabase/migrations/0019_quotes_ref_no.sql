-- CR-001: client-enterable "Ref No" field, distinct from the system-generated Quote ID
-- (quotes.ref). Free text so clients can use their own letters/numbers/special-character
-- reference convention.
alter table quotes add column if not exists ref_no text;
