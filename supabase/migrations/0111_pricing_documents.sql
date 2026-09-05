-- BPMSquare Pricing, Phase 2 batch 1 (docs/pricing-engine-architecture.md
-- §17): store every priced document so it can be replayed, shown to a
-- customer, simulated against and analysed; make publish atomic; give cost
-- inputs a real identity; let metering see the API key.
--
-- RLS posture: tenant-scoped SELECT only, no write policy (the 0083
-- convention -- pricing affects money; every write goes through a
-- service-role route). pricing_documents carries the pricing CONTEXT the
-- caller sent (customer tier, region, product attributes, quantities) and
-- the result + trace. It never carries names, phones or emails: the engine
-- only ever sees matching attributes, and the quote-line adapter passes
-- ids and codes, not people.

-- ── 1. Stored pricing contexts (spec §7, decided v1.1) ──────────────────────
create table if not exists pricing_documents (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  pricing_area   text not null default 'default',
  config_version int not null,
  procedure      text not null,
  pricing_date   date not null,
  -- Where the call came from. 'simulation' rows are replays written by
  -- batch 4 and are excluded from analysis; 'test' rows come from the
  -- cockpit and the wizard's Sample bill.
  source         text not null default 'api'
                   check (source in ('api','quote','standard_quote','work_order','test','simulation')),
  source_id      uuid,                 -- the quote / standard quote / work order, when known
  api_key_id     uuid,                 -- scoped key that made the call (null: session or legacy key)
  replay_of      uuid references pricing_documents(id) on delete set null,
  context        jsonb not null,       -- { attributes, lines[] } exactly as priced
  result         jsonb not null,       -- { currency, totals, lines[]: { line_no, net, subtotals, components } }
  trace          jsonb not null,       -- lines[]: TraceStep[] (spec §6)
  currency       text,
  net_total      numeric(14,2) not null,
  line_count     int not null,
  calc_ms        int,
  created_by     uuid,
  created_at     timestamptz not null default now()
);

create index if not exists pricing_documents_tenant_time
  on pricing_documents (tenant_id, created_at desc);
create index if not exists pricing_documents_source
  on pricing_documents (tenant_id, source, source_id);
create index if not exists pricing_documents_area_version
  on pricing_documents (tenant_id, pricing_area, config_version);
-- Simulation and analysis filter on header attributes (tier, region,
-- document_type) with JSONB containment.
create index if not exists pricing_documents_context_gin
  on pricing_documents using gin ((context -> 'attributes') jsonb_path_ops);

alter table pricing_documents enable row level security;
drop policy if exists "pricing_documents: tenant read" on pricing_documents;
create policy "pricing_documents: tenant read" on pricing_documents for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ── 2. Metering knows the key and the document (spec §15.4) ─────────────────
alter table pricing_usage
  add column if not exists api_key_id uuid,
  add column if not exists document_id uuid;
create index if not exists pricing_usage_key_time
  on pricing_usage (tenant_id, api_key_id, created_at desc);

-- ── 3. Cost inputs get an identity ───────────────────────────────────────────
-- (tenant, model, path, valid_from) is the natural key: two rows differing
-- only in valid_from are a rate history; two rows with the SAME valid_from
-- are a duplicate the engine refuses to resolve (AMBIGUOUS_COST_INPUT). A
-- generated column folds null valid_from into a sentinel so the unique
-- constraint (and PostgREST upsert) can target plain columns.
alter table pricing_cost_inputs
  add column if not exists valid_from_key date
    generated always as (coalesce(valid_from, date '1900-01-01')) stored;

-- Collapse any duplicates that already exist: keep the most recent row of
-- each natural key (the one an admin most likely edited last).
delete from pricing_cost_inputs d
using pricing_cost_inputs k
where d.tenant_id = k.tenant_id
  and d.cost_model_code = k.cost_model_code
  and d.path = k.path
  and d.valid_from_key = k.valid_from_key
  and (d.created_at < k.created_at or (d.created_at = k.created_at and d.id < k.id));

create unique index if not exists pricing_cost_inputs_natural_key
  on pricing_cost_inputs (tenant_id, cost_model_code, path, valid_from_key);

-- ── 4. Atomic publish ────────────────────────────────────────────────────────
-- Supersede the live version and promote the draft in one transaction, so a
-- failure between the two can never leave an area with no PUBLISHED version
-- (the 16.4 #4 defect). Validation stays in the route (it needs the DSL
-- parser); this only flips state. The partial unique index
-- pricing_config_one_published still guards the invariant underneath.
create or replace function pricing_publish_version(
  p_tenant_id uuid, p_area text, p_version int
) returns timestamptz language plpgsql as $$
declare
  v_status text;
  v_now timestamptz := now();
begin
  select status into v_status
    from pricing_config_versions
   where tenant_id = p_tenant_id and pricing_area = p_area and version = p_version
   for update;
  if v_status is null then
    raise exception 'version not found';
  end if;
  if v_status <> 'DRAFT' and v_status <> 'PENDING_APPROVAL' then
    raise exception 'only a DRAFT can be published (this version is %)', v_status;
  end if;

  update pricing_config_versions
     set status = 'SUPERSEDED'
   where tenant_id = p_tenant_id and pricing_area = p_area and status = 'PUBLISHED';

  update pricing_config_versions
     set status = 'PUBLISHED', published_at = v_now
   where tenant_id = p_tenant_id and pricing_area = p_area and version = p_version;

  return v_now;
end;
$$;

-- Only the service-role routes may publish. Without this, PostgREST exposes
-- the function to every authenticated session; RLS would still stop the
-- UPDATEs from touching a row (no write policy on the table), but the
-- validation report and the workcenter permission check live in the route,
-- and a function nobody outside it can call is the honest shape.
revoke execute on function pricing_publish_version(uuid, text, int) from public, anon, authenticated;
grant execute on function pricing_publish_version(uuid, text, int) to service_role;
