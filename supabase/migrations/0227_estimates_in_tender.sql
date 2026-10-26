-- 0227: Estimates inside the tender flow.
-- GCC tender deals, slice 3c-1 (docs/design/gcc-tender-deals.md section 18). Needs 0131 (estimates), 0128 (RFQ) and 0223 (the tender BOQ).
--
-- 1. estimates.opportunity_id: the tender deal an estimate was made for (null for every standard estimate). Same workspace by
--    construction: the application only ever writes a deal it has just looked up in the caller's workspace, and every read joins
--    through tenant_id, so a stray value naming another workspace's deal resolves to nothing.
-- 2. tender_boq_estimate_links: which output of which estimate prices which BOQ line. `output` is 'total' (the whole estimate),
--    'line:<estimate line id>' or 'wbs:<wbs code>'. `basis` says how the output becomes a cost per BOQ unit: 'total' spreads the cost
--    (times share_pct) over the BOQ quantity, 'per_unit' takes the output's own cost per unit (times share_pct). applied_cost is the
--    cost per BOQ unit this link contributed when it was last applied (INTERNAL, never exported); estimate_updated_at is the
--    estimate's updated_at at that moment, so "the estimate changed since" is a plain comparison and no clock can disagree;
--    applied_at is null while a "Build up this rate" estimate is still being worked on. needs_review is set when an RFQ award
--    re-priced the line by itself and cleared when a person looks at it. One link per (BOQ line, estimate, output); many BOQ lines
--    may share one estimate output as long as the shares of 'total' links on that output add up to 100 or less (the application
--    checks that; the database holds the range).
-- 3. rfqs.origin_type gains 'estimate' (an RFQ raised for the missing costs of an estimate) and rfq_lines.estimate_line_id remembers
--    which estimate line a quoted line is for, so an award can write the cost back to it.
-- 4. tender_boq_lines.price_source gains 'estimate'.
--
-- RLS (MULTI_TENANT_GUARDRAILS.md; the WFM and 0199 lessons): the new table carries a tenant SELECT policy and NOTHING that writes.
-- A link drives the cost and the rate of a BOQ line, so every write is a service-role API route that has already checked the tenant,
-- the deal, the caller's access and every id. The existing tables keep the policies they have.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the Estimates tab, "Price from estimate" and the RFQ for
-- missing costs say a database update is needed and nothing crashes (42P01 / 42703 / PGRST205 read as "not there yet").

do $$
begin
  if to_regclass('public.estimates') is null then
    raise exception 'Run 0131 (the estimator) first: public.estimates does not exist';
  end if;
  if to_regclass('public.estimate_lines') is null then
    raise exception 'Run 0131 (the estimator) first: public.estimate_lines does not exist';
  end if;
  if to_regclass('public.tender_boq_lines') is null then
    raise exception 'Run 0223 (bundle 33, the tender BOQ) first: public.tender_boq_lines does not exist';
  end if;
  if to_regclass('public.rfqs') is null or to_regclass('public.rfq_lines') is null then
    raise exception 'Run 0128 (RFQ) first: public.rfqs does not exist';
  end if;
end $$;

-- 1. The deal an estimate belongs to.
alter table estimates add column if not exists opportunity_id uuid references opportunities(id) on delete set null;
create index if not exists estimates_tenant_opportunity on estimates (tenant_id, opportunity_id) where opportunity_id is not null;

-- 2. Estimate outputs that price BOQ lines.
create table if not exists tender_boq_estimate_links (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  opportunity_id       uuid not null references opportunities(id) on delete cascade,
  boq_line_id          uuid not null references tender_boq_lines(id) on delete cascade,
  estimate_id          uuid not null references estimates(id) on delete cascade,
  output               text not null check (output = 'total' or output ~ '^line:[0-9a-fA-F-]{36}$' or output ~ '^wbs:[A-Za-z0-9._-]{1,30}$'),
  basis                text not null default 'total' check (basis in ('per_unit', 'total')),
  share_pct            numeric(7,2) not null default 100 check (share_pct > 0 and share_pct <= 100),
  applied_cost         numeric(14,4) check (applied_cost is null or applied_cost >= 0),
  applied_at           timestamptz,
  estimate_updated_at  timestamptz,
  needs_review         boolean not null default false,
  review_note          text check (review_note is null or char_length(review_note) <= 300),
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (boq_line_id, estimate_id, output)
);

create index if not exists tender_boq_estimate_links_deal_idx on tender_boq_estimate_links (tenant_id, opportunity_id);
create index if not exists tender_boq_estimate_links_estimate_idx on tender_boq_estimate_links (tenant_id, estimate_id);

alter table tender_boq_estimate_links enable row level security;
drop policy if exists "tender_boq_estimate_links: tenant read" on tender_boq_estimate_links;
create policy "tender_boq_estimate_links: tenant read" on tender_boq_estimate_links for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- 3. RFQs raised for an estimate's missing costs. The old check constraint is found by what it checks, not by its generated name.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.rfqs'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%origin_type%'
  loop
    execute format('alter table rfqs drop constraint %I', c.conname);
  end loop;
  alter table rfqs add constraint rfqs_origin_type_check
    check (origin_type in ('manual','standard_quote','quote','opportunity','case','inspection_report','work_order','fence_project','pricing','estimate'));
end $$;

alter table rfq_lines add column if not exists estimate_line_id uuid references estimate_lines(id) on delete set null;
create index if not exists rfq_lines_estimate_line on rfq_lines (tenant_id, estimate_line_id) where estimate_line_id is not null;

-- 4. A BOQ line priced from an estimate says so.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.tender_boq_lines'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%price_source%'
  loop
    execute format('alter table tender_boq_lines drop constraint %I', c.conname);
  end loop;
  alter table tender_boq_lines add constraint tender_boq_lines_price_source_check
    check (price_source is null or price_source in ('boq_rate', 'bom', 'past_project', 'supplier', 'manual', 'estimate'));
end $$;
