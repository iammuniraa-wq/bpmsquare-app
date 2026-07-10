-- Expand accounts and contacts with full standard field sets.
-- Adds address, extended communication, business fields, and custom_data JSONB.

-- ── Accounts ─────────────────────────────────────────────────────────────────

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS address_line1   text,
  ADD COLUMN IF NOT EXISTS address_line2   text,
  ADD COLUMN IF NOT EXISTS state           text,
  ADD COLUMN IF NOT EXISTS postal_code     text,
  ADD COLUMN IF NOT EXISTS country         text,
  ADD COLUMN IF NOT EXISTS phone2          text,
  ADD COLUMN IF NOT EXISTS email2          text,
  ADD COLUMN IF NOT EXISTS website         text,
  ADD COLUMN IF NOT EXISTS industry        text,
  ADD COLUMN IF NOT EXISTS employee_count  text,
  ADD COLUMN IF NOT EXISTS annual_revenue  text,
  ADD COLUMN IF NOT EXISTS gstin           text,
  ADD COLUMN IF NOT EXISTS notes           text,
  ADD COLUMN IF NOT EXISTS custom_data     jsonb;

-- Fix type check constraint to include 'prospect' (was missing from 0001_init.sql).
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_type_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_type_check
  CHECK (type IN ('prospect', 'oem', 'direct', 'end_customer'));

-- ── Contacts ─────────────────────────────────────────────────────────────────

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS department      text,
  ADD COLUMN IF NOT EXISTS birthday        date,
  ADD COLUMN IF NOT EXISTS linkedin_url    text,
  ADD COLUMN IF NOT EXISTS website         text,
  ADD COLUMN IF NOT EXISTS address_line1   text,
  ADD COLUMN IF NOT EXISTS address_line2   text,
  ADD COLUMN IF NOT EXISTS city            text,
  ADD COLUMN IF NOT EXISTS state           text,
  ADD COLUMN IF NOT EXISTS postal_code     text,
  ADD COLUMN IF NOT EXISTS country         text,
  ADD COLUMN IF NOT EXISTS notes           text,
  ADD COLUMN IF NOT EXISTS custom_data     jsonb;
