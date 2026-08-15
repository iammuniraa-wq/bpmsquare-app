-- PricingEngine ontology (docs/pricing-engine-architecture.md §2-§4, v1.4).
--
-- RLS posture: tenant-scoped SELECT ONLY, no write policy on any table here.
-- This is the WFM lesson (0078) applied up front: pricing rules affect money,
-- and a "for all" policy would let any tenant member self-grant a discount
-- through PostgREST with their own session token, bypassing the approval
-- workflow (§7). All writes go through service-role routes that enforce
-- admin/Business-Role checks and, later, the version state machine.
--
-- Config versioning (§7): rules/components/procedures carry config_version.
-- Version rows live in pricing_config_versions; exactly one PUBLISHED per
-- tenant per pricing area is enforced by a partial unique index. Cost INPUT
-- rates are deliberately NOT version-pinned -- they resolve by effective date
-- only (§3 amendment, v1.2): the version pins model structure, not rates.

-- ── Config versions ─────────────────────────────────────────────────────────
create table if not exists pricing_config_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  pricing_area text not null default 'default',
  version int not null,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','IN_SIMULATION','PENDING_APPROVAL','PUBLISHED','SUPERSEDED')),
  dsl_version int not null default 1,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (tenant_id, pricing_area, version)
);

create unique index if not exists pricing_config_one_published
  on pricing_config_versions (tenant_id, pricing_area) where status = 'PUBLISHED';

-- ── Dimension registry (§4) ────────────────────────────────────────────────
create table if not exists pricing_dimensions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  attribute text not null,          -- e.g. 'customer.tier', 'region', 'document_type'
  weight int not null check (weight > 0),
  label text,
  created_at timestamptz not null default now(),
  unique (tenant_id, attribute)
);

-- ── Components (§2.1) ──────────────────────────────────────────────────────
create table if not exists pricing_components (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  config_version int not null,
  code text not null,
  name text not null,
  class text not null check (class in
    ('PRICE','COST_BUILDUP','MARKUP','DISCOUNT','SURCHARGE','FREIGHT','TAX','REBATE_ACCRUAL','STATISTICAL')),
  calc_type text not null check (calc_type in
    ('FIXED_AMOUNT','PERCENT','PER_UNIT','SCALE_TIERED','SCALE_GRADUATED','FORMULA','COST_ROLLUP')),
  calc_basis text not null default 'NET_SO_FAR' check (calc_basis in
    ('GROSS','NET_SO_FAR','QUANTITY','WEIGHT','SUBTOTAL_REF','COST_REF','CUSTOM_METRIC')),
  sign text not null default 'BOTH' check (sign in ('POSITIVE','NEGATIVE','BOTH')),
  rounding_rule jsonb,
  manual_override text not null default 'FORBIDDEN'
    check (manual_override in ('FORBIDDEN','ALLOWED_WITH_REASON','FREE')),
  is_statistical boolean not null default false,
  resolution_strategy text not null default 'MOST_SPECIFIC'
    check (resolution_strategy in ('MOST_SPECIFIC','BEST_FOR_CUSTOMER','ALL_APPLY')),
  created_at timestamptz not null default now(),
  unique (tenant_id, config_version, code)
);

-- ── Procedures (§2.2) — steps as ordered jsonb ─────────────────────────────
create table if not exists pricing_procedures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  config_version int not null,
  code text not null,
  name text not null,
  entry_mode text not null default 'LIST_DOWN' check (entry_mode in ('LIST_DOWN','COST_UP')),
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, config_version, code)
);

-- ── Rules (§2.3) ───────────────────────────────────────────────────────────
create table if not exists pricing_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  config_version int not null,
  component_code text not null,
  match_attributes jsonb not null default '{}'::jsonb,
  value numeric,
  scale jsonb,
  formula text,
  currency text,
  uom text,
  valid_from date,
  valid_to date,
  origin text not null default 'MANUAL' check (origin in ('MANUAL','IMPORT','AI_PROPOSED_APPROVED')),
  created_by uuid,
  created_at timestamptz not null default now()
);

-- The hot lookup: candidate rules per component matched by JSONB containment.
create index if not exists pricing_rules_lookup
  on pricing_rules (tenant_id, config_version, component_code);
create index if not exists pricing_rules_match_gin
  on pricing_rules using gin (match_attributes jsonb_path_ops);

-- ── Cost models + inputs (§3) ──────────────────────────────────────────────
create table if not exists pricing_cost_models (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  config_version int not null,
  code text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, config_version, code)
);

create table if not exists pricing_cost_inputs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  cost_model_code text not null,
  path text not null,               -- 'material.copper_per_kg'
  kind text not null check (kind in ('MATERIAL','LABOUR','EQUIPMENT','SALVAGE_CREDIT','OVERHEAD','INDEX')),
  value numeric not null,
  uom text,
  currency text,
  valid_from date,
  valid_to date,
  source text not null default 'MANUAL' check (source in ('MANUAL','IMPORT','API_FEED')),
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists pricing_cost_inputs_lookup
  on pricing_cost_inputs (tenant_id, cost_model_code, path);

-- ── RLS: tenant SELECT only, writes via service-role routes ────────────────
alter table pricing_config_versions enable row level security;
alter table pricing_dimensions      enable row level security;
alter table pricing_components      enable row level security;
alter table pricing_procedures      enable row level security;
alter table pricing_rules           enable row level security;
alter table pricing_cost_models     enable row level security;
alter table pricing_cost_inputs     enable row level security;

create policy "pricing_config_versions: tenant read" on pricing_config_versions for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "pricing_dimensions: tenant read" on pricing_dimensions for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "pricing_components: tenant read" on pricing_components for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "pricing_procedures: tenant read" on pricing_procedures for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "pricing_rules: tenant read" on pricing_rules for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "pricing_cost_models: tenant read" on pricing_cost_models for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "pricing_cost_inputs: tenant read" on pricing_cost_inputs for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
