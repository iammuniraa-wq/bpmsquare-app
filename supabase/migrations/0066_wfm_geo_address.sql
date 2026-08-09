-- 0066_wfm_geo_address.sql
-- Human-readable address for a punch's GPS fix, so a supervisor sees
-- "12, MG Road, Bengaluru" rather than 12.90666, 77.60305.
--
-- Resolved via a reverse-geocoding provider (Ola Maps -- see
-- src/lib/wfm/geocode.ts) and CACHED here permanently: the coordinates of a
-- past punch never change, so a given event is geocoded at most once no
-- matter how many times it is viewed or exported. That keeps provider calls
-- proportional to punches, not page views.
--
-- Nullable on purpose, and three distinct states matter:
--   null  = not yet resolved (or the punch had no GPS fix at all)
--   ''    = provider ran and genuinely found no address for those coords
--   text  = the resolved address
-- The empty string is what stops an unresolvable location being retried on
-- every single view forever.

alter table wfm_presence_events add column geo_address text;
