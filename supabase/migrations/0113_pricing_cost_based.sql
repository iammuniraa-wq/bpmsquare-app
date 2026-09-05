-- BPMSquare Pricing, cost-based technique step 1 (docs/pricing-engine-
-- architecture.md §17, built one technique at a time -- owner decision
-- 2026-09-06). Requires 0111 (valid_from_key on pricing_cost_inputs).
--
--   1. A product carries a cost sheet (what one unit consumes: copper kg,
--      labour hours, salvage kg, or simply "one bought-in part") and the
--      date its ERP cost price was current -- so the engine can build cost
--      quantities for a quote line without anyone typing them.
--   2. A cost model carries a SOURCE LADDER: which cost figures to try in
--      which order (ERP cost, RFQ reply, price list, hand-kept rate), with
--      quality and freshness. The manufacturer's "SAP first, else confirmed
--      beats calculated, else price list, else ask the supplier" as data.
--   3. Cost inputs know where they came from (source, quality, as-of) and
--      may belong to ONE product (an RFQ reply, an imported price-list
--      cost) instead of being a tenant-wide rate.
--   4. RFQs: the "ask the supplier" outcome as a record with a reply that
--      becomes a confirmed cost input.
--
-- RLS posture unchanged: pricing tables are select-only; writes go through
-- service-role routes. products keeps its ordinary for-all policy.

-- ── 1. Products ──────────────────────────────────────────────────────────────
alter table products
  add column if not exists cost_sheet jsonb,          -- [{ path, qty, kind? }] per unit
  add column if not exists cost_price_as_of date;     -- when cost_price was last confirmed

-- ── 2. Cost model source ladder ──────────────────────────────────────────────
alter table pricing_cost_models
  add column if not exists sources jsonb not null default '[]'::jsonb;
  -- [{ code, label, tier, quality: actual|confirmed|estimate|list, max_age_days, requirement }]

-- ── 3. Cost input provenance and product scope ───────────────────────────────
alter table pricing_cost_inputs
  add column if not exists source_code text,
  add column if not exists quality text check (quality in ('actual','confirmed','estimate','list')),
  add column if not exists as_of date,
  add column if not exists product_id uuid references products(id) on delete cascade;

-- The natural key widens: the same path may legitimately carry one figure
-- per SOURCE (ERP cost and RFQ reply side by side -- the ladder chooses)
-- and per PRODUCT (product-specific costs next to the tenant-wide rate).
-- Generated sentinels keep the unique index on plain columns so PostgREST
-- upsert can target it.
alter table pricing_cost_inputs
  add column if not exists source_key text generated always as (coalesce(source_code, 'MANUAL')) stored,
  add column if not exists product_key uuid generated always as (coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored;

drop index if exists pricing_cost_inputs_natural_key;
create unique index if not exists pricing_cost_inputs_natural_key
  on pricing_cost_inputs (tenant_id, cost_model_code, path, source_key, product_key, valid_from_key);
create index if not exists pricing_cost_inputs_product
  on pricing_cost_inputs (tenant_id, product_id) where product_id is not null;

-- ── 3b. Quote lines remember the price that produced them ───────────────────
-- The stored pricing document behind a line (batch 1) and the guardrail
-- flags it carried at pricing time, denormalised so "can this quote be
-- sent" is one read. The API derives pricing_flags from the document it
-- verified -- never from the client -- so a rep cannot strip a block.
alter table quote_lines
  add column if not exists pricing_document_id uuid references pricing_documents(id) on delete set null,
  add column if not exists pricing_flags jsonb;

-- ── 3c. RFQ email template category ─────────────────────────────────────────
alter table email_templates drop constraint if exists email_templates_category_check;
alter table email_templates add constraint email_templates_category_check
  check (category in ('quote', 'invoice', 'report', 'rfq'));

-- ── 4. RFQs ──────────────────────────────────────────────────────────────────
create table if not exists pricing_rfqs (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  ref                text,                                   -- RFQ-0001, masterRef-assigned
  product_id         uuid not null references products(id) on delete cascade,
  supplier_id        uuid references suppliers(id) on delete set null,
  cost_model_code    text not null,
  path               text not null default 'purchase.unit_cost',
  quantity           numeric(12,2),
  uom                text,
  status             text not null default 'draft'
                       check (status in ('draft','sent','replied','cancelled')),
  requested_by       uuid,
  sent_to            text,                                   -- the address the request went to
  sent_at            timestamptz,
  message            text,
  reply_value        numeric(14,4),
  reply_currency     text,
  reply_valid_from   date,
  reply_valid_to     date,
  reply_note         text,
  replied_at         timestamptz,
  replied_by         uuid,
  cost_input_id      uuid references pricing_cost_inputs(id) on delete set null,
  quote_id           uuid references quotes(id) on delete set null,   -- the line that needed it, when known
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists pricing_rfqs_tenant_ref_uniq on pricing_rfqs (tenant_id, ref) where ref is not null;
create index if not exists pricing_rfqs_product on pricing_rfqs (tenant_id, product_id, status);

alter table pricing_rfqs enable row level security;
drop policy if exists "pricing_rfqs: tenant read" on pricing_rfqs;
create policy "pricing_rfqs: tenant read" on pricing_rfqs for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
