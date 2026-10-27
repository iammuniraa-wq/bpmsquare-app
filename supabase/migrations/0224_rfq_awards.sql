-- 0224: RFQ awards with a recorded decision, and what a supplier last quoted for a product.
-- GCC tender deals, slice 3b (docs/design/gcc-tender-deals.md section 13). Needs 0128 (rfqs, rfq_lines, rfq_suppliers,
-- rfq_responses). The RFQ module itself is unchanged: this file only ADDS.
--
-- 1. rfq_line_awards: one row per award decision on an RFQ line. Who chose which supplier's answer, when, and -- whenever that
--    answer was not the lowest valid price on the line -- the reason they gave (the application refuses the award without one).
--    Changing an award never rewrites a row: the old row gets superseded_at / superseded_by and a new one is written, so the
--    history of "we first chose A, then B, because ..." is kept. The partial unique index allows exactly one CURRENT award per
--    line, which is also what makes two people awarding the same line at once safe (the second insert fails and is told so).
--    applied_* records that the awarded price was written onto the linked deal line ("Use these prices on the deal lines").
--    landed_unit is the awarded price in the workspace currency (after the exchange rate) and lowest_valid_unit the benchmark it
--    was held against, so the record explains itself even after the answers are edited.
-- 2. product_suppliers: the price a supplier last quoted for a catalog product, upserted when an award is made (source 'rfq').
--    One row per (product, supplier). It is a record of fact, not a rule: the pricing engine does not read it yet (the cost input
--    an award writes is still what the engine uses). `preferred` is left for the product page and is never touched by an award.
--
-- RLS (MULTI_TENANT_GUARDRAILS.md; the WFM and 0199 lessons): both tables carry a tenant SELECT policy and NOTHING that writes.
-- An award drives cost and is the audit trail of a buying decision, so every write is a service-role API route that has already
-- checked the tenant, the RFQ, the line, the response and the supplier; a member cannot forge or erase a decision through
-- PostgREST.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the comparison on the RFQ screen still shows and
-- awarding answers "needs a database update" (42P01 / PGRST205 are read as "not there yet").

create table if not exists rfq_line_awards (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  rfq_id            uuid not null references rfqs(id) on delete cascade,
  rfq_line_id       uuid not null references rfq_lines(id) on delete cascade,
  rfq_supplier_id   uuid not null references rfq_suppliers(id) on delete cascade,
  supplier_id       uuid not null references suppliers(id) on delete cascade,
  response_id       uuid not null references rfq_responses(id) on delete cascade,
  chosen_by         uuid,
  chosen_at         timestamptz not null default now(),
  reason            text check (reason is null or char_length(reason) between 3 and 1000),
  not_lowest        boolean not null default false,
  landed_unit       numeric(14,4),
  lowest_valid_unit numeric(14,4),
  superseded_at     timestamptz,
  superseded_by     uuid,
  applied_to_deal_at timestamptz,
  applied_by        uuid,
  applied_rate      numeric(14,2),
  check (not not_lowest or reason is not null)
);

create unique index if not exists rfq_line_awards_one_current on rfq_line_awards (rfq_line_id) where superseded_at is null;
create index if not exists rfq_line_awards_rfq on rfq_line_awards (tenant_id, rfq_id, chosen_at desc);
create index if not exists rfq_line_awards_supplier on rfq_line_awards (tenant_id, supplier_id);

alter table rfq_line_awards enable row level security;
drop policy if exists "rfq_line_awards: tenant read" on rfq_line_awards;
create policy "rfq_line_awards: tenant read" on rfq_line_awards for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists product_suppliers (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  product_id       uuid not null references products(id) on delete cascade,
  supplier_id      uuid not null references suppliers(id) on delete cascade,
  preferred        boolean not null default false,
  cost             numeric(14,4),
  quoted_price     numeric(14,4),
  currency         text,
  uom              text,
  lead_time_days   int,
  moq              numeric(14,3),
  valid_from       date,
  valid_to         date,
  as_of            date,
  source           text not null default 'manual' check (source in ('manual', 'rfq', 'import')),
  rfq_response_id  uuid references rfq_responses(id) on delete set null,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, product_id, supplier_id)
);

create index if not exists product_suppliers_product on product_suppliers (tenant_id, product_id);

alter table product_suppliers enable row level security;
drop policy if exists "product_suppliers: tenant read" on product_suppliers;
create policy "product_suppliers: tenant read" on product_suppliers for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
