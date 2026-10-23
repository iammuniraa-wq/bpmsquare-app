-- run-bundle-18-standard-quotes-custom-data-2026-10-23.sql
-- Paste into the Supabase SQL editor of each database (dev, then production). Safe to run twice.
-- = migration 0209 (standard_quotes.custom_data). No seed. The app works before and after this;
-- until it runs, custom field values on a standard quote are not stored.

alter table standard_quotes add column if not exists custom_data jsonb;
