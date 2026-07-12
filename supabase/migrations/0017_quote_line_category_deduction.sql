-- Per-line category (reuses the pricing-catalog taxonomy) and a deduction amount
-- for material-category lines (e.g. copper wire salvage credit). Deductions are
-- summed and subtracted once at the quote grand-total level, not per line.
ALTER TABLE quote_lines
  ADD COLUMN IF NOT EXISTS category   text,
  ADD COLUMN IF NOT EXISTS deduction  numeric DEFAULT 0;
