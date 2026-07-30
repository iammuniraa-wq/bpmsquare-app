-- 0047_schema_drift_reconcile.sql
-- Columns production has -- and the app actively reads/writes -- that never
-- landed in any tracked migration. Surfaced when importing a production
-- tenant export into staging failed with missing-column errors (2026-07-30).
-- Everything is guarded, so this is a no-op on production and completes
-- staging (and any future fresh database) to match reality.

alter table contacts
  add column if not exists phone2 text,
  add column if not exists phone3 text,
  add column if not exists email2 text;

alter table quotes
  add column if not exists type text not null default 'quotation',
  add column if not exists selected_option_id text,
  add column if not exists meta jsonb;

alter table quote_lines
  add column if not exists discount_pct numeric(5,2) not null default 0,
  add column if not exists group_id text,
  add column if not exists group_label text,
  add column if not exists group_type text;

alter table case_photos
  add column if not exists url text;

-- Quote statuses are tenant-configurable (Settings -> Statuses stores the
-- custom *value* in quotes.status), so the baseline's hardcoded allow-list
-- rejects any custom pipeline value. Drop it; validity is enforced app-side
-- against the tenant's configured status set.
alter table quotes drop constraint if exists quotes_status_check;
