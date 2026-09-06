-- Sales Engine, Piece A (docs/sales-engine-architecture.md §3.1): the shared
-- document-line contract. Quotations already have alternative option groups
-- (group_id/group_label/group_type, 0047) -- this migration lifts that model
-- onto Standard Quotes, and adds quantity-break columns to both.
--
-- is_selected drives totals (src/lib/sales/lineTotals.ts): a line with no
-- group and no break is always selected; inside an alternative group only
-- one group's lines count; a break row only counts when it is the chosen
-- quantity for its parent line. Default true so every existing row (no
-- groups, no breaks anywhere yet) keeps counting exactly as it does today.
--
-- RLS unchanged: quote_lines and standard_quote_lines keep their existing
-- policies (standard_quote_lines is "for all" tenant members; quote_lines
-- likewise) -- this migration only adds columns.

alter table standard_quote_lines
  add column if not exists group_id text,
  add column if not exists group_label text,
  add column if not exists group_type text,
  add column if not exists break_of uuid references standard_quote_lines(id) on delete cascade,
  add column if not exists break_qty numeric(10,2),
  add column if not exists is_selected boolean not null default true;

alter table quote_lines
  add column if not exists break_of uuid references quote_lines(id) on delete cascade,
  add column if not exists break_qty numeric(10,2),
  add column if not exists is_selected boolean not null default true;

create index if not exists standard_quote_lines_break_of on standard_quote_lines (break_of) where break_of is not null;
create index if not exists quote_lines_break_of on quote_lines (break_of) where break_of is not null;
