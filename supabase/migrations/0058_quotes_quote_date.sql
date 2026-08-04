-- VIK-7: the quote form has always had a "Date" picker, but the value was never
-- persisted -- every surface printed created_at instead, so the quote was always
-- stamped with the day it was entered. Back-dating a quote is a normal business
-- need (the paperwork often follows the conversation by days or weeks).
--
-- A dedicated column rather than writing created_at: created_at is the audit
-- timestamp that change history and ref sequencing order by, and it must keep
-- meaning "when this row was created".
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS quote_date date;

-- Existing quotes keep the date they have always displayed.
UPDATE quotes SET quote_date = created_at::date WHERE quote_date IS NULL;
