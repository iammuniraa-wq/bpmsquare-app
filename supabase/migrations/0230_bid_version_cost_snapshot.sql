-- 0230: the internal cost of each bid version.
-- GCC tender deals, after award (docs/design/gcc-tender-deals.md section 23). Needs 0225 (tender_bid_versions).
--
-- tender_bid_version_costs: when a bid version is submitted, the application also stores, per bid line, the INTERNAL cost behind the
-- price and the row markup, as the budget lines that cost becomes (resource type, cost code, quantity, unit cost; from the BOQ row's
-- recorded cost, the estimates that priced it, or the default margin). The contract project's baseline budget starts from the WINNING
-- version's snapshot instead of the current BOQ, and "Bid against budget" on the project compares the two. One row per version, written
-- once (a trigger refuses an UPDATE), never read by an export, a PDF, a public link, the answer sheet, the v1 API or Talk to data.
--
-- Why a table and not a column on tender_bid_versions: that table has a tenant SELECT policy (a bid is a record every member may read),
-- and a policy cannot hide one column, so a cost column there would be readable by any member through PostgREST with their own session
-- token (the 2026-10-21 audit lesson, 0200). This table has RLS ENABLED and NO policy at all: only the service role reaches it, and
-- every read and write is an API route that has already checked the tenant, the deal and the caller's access.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, a bid is submitted exactly as before (without a snapshot,
-- and the response says so), and a project made from such a tender starts from the current BOQ and says so in its budget note.

do $$
begin
  if to_regclass('public.tender_bid_versions') is null then
    raise exception 'Run 0225 (bundle 35, bid versions) first, then run this again.';
  end if;
end $$;

create table if not exists tender_bid_version_costs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  opportunity_id  uuid not null references opportunities(id) on delete cascade,
  version_no      int not null check (version_no >= 1),
  total_cost      numeric(16,2) not null default 0,
  line_count      int not null default 0,
  snapshot        jsonb not null,
  created_at      timestamptz not null default now(),
  unique (opportunity_id, version_no)
);

create index if not exists tender_bid_version_costs_deal on tender_bid_version_costs (tenant_id, opportunity_id, version_no desc);

create or replace function tender_bid_version_costs_no_update() returns trigger as $$
begin
  raise exception 'the cost of a submitted bid version cannot be changed';
end;
$$ language plpgsql;

drop trigger if exists tender_bid_version_costs_immutable on tender_bid_version_costs;
create trigger tender_bid_version_costs_immutable before update on tender_bid_version_costs
  for each row execute function tender_bid_version_costs_no_update();

alter table tender_bid_version_costs enable row level security;
