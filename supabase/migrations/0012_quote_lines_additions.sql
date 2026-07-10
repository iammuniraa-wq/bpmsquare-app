-- Add sl_no (editable serial number, alphanumeric) and group_description to quote_lines
ALTER TABLE quote_lines ADD COLUMN IF NOT EXISTS sl_no text;
ALTER TABLE quote_lines ADD COLUMN IF NOT EXISTS group_description text;

-- Add custom_data to quotes if not present (may already exist)
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS custom_data jsonb;
