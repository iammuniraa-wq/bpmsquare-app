-- Sales Engine, Piece A follow-up (owner decisions 2026-09-06, docs/
-- sales-engine-architecture.md §3.6): the guided "add line" flow and the
-- rep's control over what the PDF shows.
--
--   products.qty_breaks           the product's own quantity breaks, kept
--                                 locally or synced from the ERP:
--                                 [{ "from": 10, "rate": 17900 }, ...] --
--                                 rate optional (null = price it normally).
--                                 What the add-line panel offers when a rep
--                                 says "yes, include quantity breaks".
--   standard_quotes.print_options what the PDF prints for options the
--                                 customer did not choose:
--                                 { "alternatives": "all"|"chosen",
--                                   "breaks": "all"|"chosen" }.
--                                 null = today's behaviour (print all,
--                                 greyed out).
--   standard_quote_lines.show_on_pdf  per-line override: false hides the
--                                 row from the PDF (it still counts if it
--                                 is selected -- hiding is presentation,
--                                 never money).
--
-- RLS unchanged on all three tables -- columns only.

alter table products
  add column if not exists qty_breaks jsonb;

alter table standard_quotes
  add column if not exists print_options jsonb;

alter table standard_quote_lines
  add column if not exists show_on_pdf boolean not null default true;
