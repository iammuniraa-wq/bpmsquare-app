-- 0131: Project Estimator -- a generic, template-driven estimate as a standard,
-- flag-scoped object (docs/estimator-architecture.md, owner decision
-- 2026-10-17). One core object (`estimates`, EST-####); what differs per trade
-- is the template (`estimate_templates`): named inputs, named rates and an
-- ordered list of rule lines with quantity formulas. An estimate keeps its own
-- computed lines (`estimate_lines`) as a snapshot, so editing a template never
-- silently re-prices an existing estimate.
--
-- Everything trade-specific (a precast manufacturer's rates and rules, say) is
-- tenant data in `estimate_templates`, never code.
--
-- RLS: the standard tenant-isolation policy ("for all"). This is a CRM-shaped
-- object edited directly by its users, like fence_projects (0122) -- not
-- attendance or pay data (MULTI_TENANT_GUARDRAILS.md, WFM lesson). The cost
-- fields are internal: the app and the v1 API never expose them to customers.
--
-- §3 record identity: estimate_lines is a child object family -- its own id is
-- what Update/Delete key on once a line exists; estimate_id only resolves the
-- relationship at create time.
--
-- External ERP ids (whichever ERP the tenant uses) go through connector_links
-- (0129): no ERP-specific columns here.
--
-- Pending-migration behaviour: every route degrades on 42P01 (empty list /
-- "waiting for the database update"), and nothing else in the product depends
-- on these tables.

-- ── Templates ───────────────────────────────────────────────────────────────
create table if not exists estimate_templates (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  name              text not null,
  description       text,
  trade             text,                              -- free text, e.g. 'precast'
  version           int  not null default 1,
  is_active         boolean not null default true,
  -- [{key,label,type: number|select|boolean, default, min, max, options, unit, help}]
  inputs            jsonb not null default '[]'::jsonb,
  -- [{key,label,unit,value}]
  rates             jsonb not null default '[]'::jsonb,
  -- ordered rule lines: [{code,group,description,uom,qty,waste_pct,component,cost:{kind,sku|rate}}]
  rules             jsonb not null default '[]'::jsonb,
  quote_granularity text not null default 'group'
                      check (quote_granularity in ('group','line')),
  custom_data       jsonb,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists estimate_templates_tenant on estimate_templates (tenant_id, is_active, name);
create unique index if not exists estimate_templates_tenant_name_key on estimate_templates (tenant_id, lower(name));

alter table estimate_templates enable row level security;
drop policy if exists "estimate_templates: tenant isolation" on estimate_templates;
create policy "estimate_templates: tenant isolation" on estimate_templates for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ── Estimates ───────────────────────────────────────────────────────────────
create table if not exists estimates (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  ref               text,
  name              text not null,
  account_id        uuid references accounts(id) on delete set null,
  contact_id        uuid references contacts(id) on delete set null,
  template_id       uuid references estimate_templates(id) on delete set null,
  template_version  int,
  status            text not null default 'draft'
                      check (status in ('draft','quoted','won','lost')),
  params            jsonb not null default '{}'::jsonb,  -- the input values
  currency          text,
  margin_pct        numeric(6,2) not null default 0,
  -- snapshot: by group, by cost component, grand total, vat, price
  totals            jsonb,
  standard_quote_id uuid references standard_quotes(id) on delete set null,
  notes             text,
  custom_data       jsonb,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists estimates_tenant_status on estimates (tenant_id, status, created_at desc);
create index if not exists estimates_tenant_account on estimates (tenant_id, account_id);
create index if not exists estimates_tenant_template on estimates (tenant_id, template_id);
create unique index if not exists estimates_tenant_ref_key on estimates (tenant_id, ref) where ref is not null;

alter table estimates enable row level security;
drop policy if exists "estimates: tenant isolation" on estimates;
create policy "estimates: tenant isolation" on estimates for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ── Estimate lines (the BOM) ────────────────────────────────────────────────
-- `component` is not in the spec's column list: a manual line has to say which
-- cost-build-up bucket it belongs to, or the totals could not be recomputed
-- from the stored lines after a hand edit. Null reads as 'other'.
create table if not exists estimate_lines (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  estimate_id   uuid not null references estimates(id) on delete cascade,
  sort_order    int not null default 0,
  code          text,
  group_key     text,
  description   text not null,
  uom           text,
  qty           numeric(14,3) not null default 0,
  waste_pct     numeric(6,2) not null default 0,
  unit_cost     numeric(14,4),
  cost_total    numeric(14,2),
  component     text check (component is null or component in
                  ('materials','moulds','labour','overhead','transport','erection','other')),
  product_id    uuid references products(id) on delete set null,
  source        text not null default 'rule'
                  check (source in ('rule','schedule','manual')),
  element_ref   text,                                  -- mark from an imported schedule
  wbs_code      text,
  custom_data   jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists estimate_lines_estimate on estimate_lines (tenant_id, estimate_id, sort_order);
create index if not exists estimate_lines_product on estimate_lines (tenant_id, product_id) where product_id is not null;

alter table estimate_lines enable row level security;
drop policy if exists "estimate_lines: tenant isolation" on estimate_lines;
create policy "estimate_lines: tenant isolation" on estimate_lines for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ── Custom fields on estimates ──────────────────────────────────────────────
-- Same widening 0128 did for rfq: every object the app offers custom fields
-- on, plus estimate. NOT VALID so an existing row of some object this list
-- doesn't know can never make the migration fail half-way.
alter table custom_fields drop constraint if exists custom_fields_object_type_check;
alter table custom_fields add constraint custom_fields_object_type_check
  check (object_type in ('account','contact','case','quote','work_order','asset','supplier','inventory','purchase_order','invoice',
                         'employee','product','project','opportunity','rfq','estimate')) not valid;

-- ── Exact building model (docs/estimator-architecture.md section 10.2) ──────
-- Appended after first apply on the dev database so the file stays re-runnable:
-- `geometry` names the template's geometry module (null = formula-only, no 3D);
-- `model` is the estimate's snapshot of the pieces it was priced with.
alter table estimate_templates add column if not exists geometry text;
alter table estimates add column if not exists model jsonb;
