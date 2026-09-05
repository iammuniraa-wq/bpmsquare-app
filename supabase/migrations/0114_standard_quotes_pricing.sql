-- BPMSquare Pricing on Standard Quotes (cost-based technique, step 2 hook
-- for client #3 -- docs/pricing-engine-architecture.md §17 Batch 1½ and
-- Batch 2: "Standard Quotes get the identical hook"). Requires 0113.
--
-- A Standard Quote line was free text (description, uom, qty, rate). To be
-- priced by the engine it needs to name a product, and once priced it
-- remembers the pricing document and the guardrail flags -- the same three
-- columns quote_lines gained in 0113, derived server-side, never trusted
-- from the client. An RFQ raised from a Standard Quote line points back at
-- it the way one raised from a Quotation points at quotes.
--
-- RLS unchanged: standard_quote_lines keeps its for-all tenant policy;
-- pricing_rfqs stays select-only.

alter table standard_quote_lines
  add column if not exists product_id uuid references products(id) on delete set null,
  add column if not exists pricing_document_id uuid references pricing_documents(id) on delete set null,
  add column if not exists pricing_flags jsonb;

create index if not exists standard_quote_lines_product
  on standard_quote_lines (tenant_id, product_id) where product_id is not null;

alter table pricing_rfqs
  add column if not exists standard_quote_id uuid references standard_quotes(id) on delete set null;
