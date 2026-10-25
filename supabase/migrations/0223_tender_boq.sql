-- 0223_tender_boq.sql
--
-- GCC tender deals, slice 3a: the client's BOQ Excel in, a priced Excel out (docs/design/gcc-tender-deals.md section 10, slice 3).
-- The BOQ rows become ordinary deal lines (opportunity_lines, the shared line contract); these two tables hold only what the
-- contract has no place for, so a tender deal stays "an ordinary deal plus side rows" and no column is added to opportunities
-- or opportunity_lines. Needs 0120 (opportunities, opportunity_lines) and 0220 (the tender deal type).
--
-- 1. tender_boq_sources: one row per uploaded workbook of a deal. The ORIGINAL file is kept (private bucket below) together with
--    the sheet, the header row, the column map and the columns the priced file writes to, so the priced workbook can be written
--    back into the client's own layout. A re-upload is a new row (the old one is kept as history, is_current = false).
-- 2. tender_boq_lines: one row per BOQ line of a deal. It remembers where the line sits in the workbook (row_no), the client's
--    item number and cost code, and where its price came from (price_source, price_source_ref, price_as_of) so the screen can
--    say which source set it and whether the source was out of date when somebody chose it knowingly (stale_accepted).
--    unit_cost is the INTERNAL cost behind a rate that was built from a cost (supplier, BOM): it is never written to the
--    priced workbook or to the answer sheet. line_id points at the deal line; the deal's Lines editor saves by delete and
--    re-insert (new ids), so the link is on delete set null and is restored from the item number on the next BOQ screen load.
-- 3. The private bucket tender-boq-files: no storage policy grants anon or authenticated anything; the application uploads and
--    downloads with the service role. First path segment is the tenant id.
--
-- RLS (MULTI_TENANT_GUARDRAILS.md, the 0199 lesson): both tables carry a tenant SELECT policy and NOTHING that writes. Every write
-- is a service-role API route that has already checked the tenant, the deal, the caller's access to the Pipeline and every id.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the BOQ tab says a database update is needed and
-- nothing else changes (42P01 / PGRST205 are read as "not there yet").

create table if not exists tender_boq_sources (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  opportunity_id  uuid not null references opportunities(id) on delete cascade,
  version         int not null default 1,
  is_current      boolean not null default true,
  file_name       text not null,
  storage_path    text not null,
  size_bytes      bigint not null default 0,
  sheet_name      text not null,
  header_row      int not null check (header_row >= 1),
  -- The header row's cell texts when the map was made: the next upload with the same layout reuses the map.
  header_labels   jsonb not null default '[]'::jsonb,
  -- { item_no, description, uom, qty, cost_code, rate, amount } -> 1-based column number
  column_map      jsonb not null default '{}'::jsonb,
  -- Where the priced workbook writes the unit rate and the amount; added_columns = the client's file had none, so they sit after the last used column.
  rate_col        int,
  amount_col      int,
  added_columns   boolean not null default false,
  -- The client's own total row (label + amount cell), when the sheet has one.
  total_row       int,
  line_count      int not null default 0,
  uploaded_by     uuid,
  uploaded_at     timestamptz not null default now()
);

create index if not exists tender_boq_sources_deal_idx on tender_boq_sources (tenant_id, opportunity_id, version desc);
create unique index if not exists tender_boq_sources_current_idx on tender_boq_sources (opportunity_id) where is_current;

create table if not exists tender_boq_lines (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  opportunity_id      uuid not null references opportunities(id) on delete cascade,
  source_id           uuid not null references tender_boq_sources(id) on delete cascade,
  line_id             uuid references opportunity_lines(id) on delete set null,
  -- The matching key of a re-upload: the item number when the line has one, else the description + unit; repeats get #2, #3.
  item_key            text not null,
  item_no             text,
  cost_code           text,
  row_no              int not null check (row_no >= 1),
  -- What the client's file said for this line, as uploaded. A revised file is compared with THIS (not with the deal line, which a
  -- person may have edited), and it re-finds the deal line after the Lines editor re-saved it.
  file_description    text not null,
  file_uom            text,
  file_qty            numeric(14,3) not null default 0,
  -- The rate the client's file already carried, if any.
  file_rate           numeric(14,4),
  price_source        text check (price_source in ('boq_rate', 'bom', 'past_project', 'supplier', 'manual')),
  price_source_ref    text,
  price_as_of         date,
  stale_accepted      boolean not null default false,
  -- INTERNAL: the cost a supplier / BOM rate was built from, and the markup on it. Never exported.
  unit_cost           numeric(14,4),
  markup_pct          numeric(6,2),
  priced_by           uuid,
  priced_at           timestamptz,
  -- Not in the latest upload but kept because it was already priced.
  removed_in_revision boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (opportunity_id, item_key)
);

create index if not exists tender_boq_lines_deal_idx on tender_boq_lines (tenant_id, opportunity_id, row_no);
create index if not exists tender_boq_lines_line_idx on tender_boq_lines (line_id) where line_id is not null;
create index if not exists tender_boq_lines_cost_code_idx on tender_boq_lines (tenant_id, cost_code) where cost_code is not null;

alter table tender_boq_sources enable row level security;
alter table tender_boq_lines   enable row level security;

drop policy if exists "tender_boq_sources: tenant read" on tender_boq_sources;
create policy "tender_boq_sources: tenant read" on tender_boq_sources for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

drop policy if exists "tender_boq_lines: tenant read" on tender_boq_lines;
create policy "tender_boq_lines: tenant read" on tender_boq_lines for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit)
values ('tender-boq-files', 'tender-boq-files', false, 15728640)
on conflict (id) do nothing;
