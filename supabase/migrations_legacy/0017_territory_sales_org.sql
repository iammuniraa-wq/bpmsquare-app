-- Add territory and sales_org to all core objects.
-- Simple text fields — no FK constraints, controlled values added later via settings if needed.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS territory  text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sales_org  text;

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS territory  text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS sales_org  text;

ALTER TABLE quotes   ADD COLUMN IF NOT EXISTS territory  text;
ALTER TABLE quotes   ADD COLUMN IF NOT EXISTS sales_org  text;

ALTER TABLE service_cases ADD COLUMN IF NOT EXISTS territory  text;
ALTER TABLE service_cases ADD COLUMN IF NOT EXISTS sales_org  text;
