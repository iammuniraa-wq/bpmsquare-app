-- Quotation offer-type enhancements (BRD: Quotation / Technical offer / Budgetary offer)
-- quote.type now stores: quotation | technical | budgetary | supply | repair (legacy)

alter table quotes
  add column if not exists entity_id       text,          -- which tenant entity issued this quote
  add column if not exists scope_of_work   text,          -- description of work / motor issue
  add column if not exists terms           text,          -- T&C stored separately from notes
  add column if not exists business_status text not null default 'pending';
                                                          -- pending | po_received (Vikas BRD statuses)

alter table quote_lines
  add column if not exists uom text;                     -- Unit of Measure: Nos, Job, Set, Mtr, Kg …
