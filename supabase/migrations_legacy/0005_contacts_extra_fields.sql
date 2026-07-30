-- Add extra phone and email fields to contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone2 text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone3 text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email2 text;
