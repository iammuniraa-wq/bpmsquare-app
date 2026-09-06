-- 0120: Opportunities -- Sales Engine Piece B (docs/sales-engine-architecture.md
-- §4, owner decisions 2026-09-06: a deal is OPTIONAL before a quote and a
-- lead is optional before a deal; nothing auto-creates one).
--
-- An opportunity is a pursuit with a customer: the lines being pursued
-- (the §3.1 shared line contract, engine-priced), a stage from the tenant's
-- own stage list (config.opportunity_stages), an outcome (the same
-- open/won/lost/dropped vocabulary quotes use), the people on it, and the
-- quotes that came out of it (quotes/standard_quotes.opportunity_id).
--
-- §3b: tenant_id + RLS + isolation policy in this file, custom_data from
-- day one, ref (OPP-####) via masterRef. Standard tenant-isolation policy
-- ("for all"): a CRM object edited by its users, not attendance/pricing.

create table if not exists opportunities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  ref text,
  account_id uuid not null references accounts(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  source text,                                   -- lead | campaign | direct | referral | other
  source_campaign_id uuid,
  title text not null,
  description text,
  stage text not null,                           -- config.opportunity_stages value
  outcome text not null default 'open',          -- open | won | lost | dropped
  loss_reason text,
  loss_note text,
  expected_close date,
  amount numeric(14,2) not null default 0,       -- latest linked quote's subtotal, else the lines' total (§4.4)
  currency text,
  probability int,                               -- 0..100: override if set, else the stage's hint
  probability_override int,
  probability_override_reason text,
  owner_id uuid,
  team jsonb not null default '[]',              -- [{ user_id, role }]
  competitor text,
  approval_status text,                          -- piece C
  custom_data jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists opportunities_tenant_stage on opportunities (tenant_id, stage);
create index if not exists opportunities_tenant_account on opportunities (tenant_id, account_id);
create index if not exists opportunities_tenant_owner on opportunities (tenant_id, owner_id);
create unique index if not exists opportunities_tenant_ref_key on opportunities (tenant_id, ref) where ref is not null;

alter table opportunities enable row level security;
create policy "opportunities: tenant isolation" on opportunities for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- The shared document-line contract (§3.1), keyed to the opportunity.
-- break_of is text (0117): lines are deleted and re-inserted on every save.
create table if not exists opportunity_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  sl_no text,
  description text not null,
  uom text,
  qty numeric(12,2) not null default 1,
  rate numeric(12,2) not null default 0,
  discount_pct numeric(5,2) not null default 0,
  amount numeric(14,2) not null default 0,
  product_id uuid references products(id) on delete set null,
  pricing_document_id uuid,
  pricing_flags jsonb,
  group_id text,
  group_label text,
  group_type text,
  break_of text,
  break_qty numeric(10,2),
  is_selected boolean not null default true,
  show_on_pdf boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists opportunity_lines_parent on opportunity_lines (tenant_id, opportunity_id);

alter table opportunity_lines enable row level security;
create policy "opportunity_lines: tenant isolation" on opportunity_lines for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- A quote MAY belong to a deal (decision 5: optional, never required).
alter table quotes           add column if not exists opportunity_id uuid references opportunities(id) on delete set null;
alter table standard_quotes  add column if not exists opportunity_id uuid references opportunities(id) on delete set null;
alter table pricing_rfqs     add column if not exists opportunity_id uuid references opportunities(id) on delete set null;

create index if not exists quotes_tenant_opportunity on quotes (tenant_id, opportunity_id) where opportunity_id is not null;
create index if not exists standard_quotes_tenant_opportunity on standard_quotes (tenant_id, opportunity_id) where opportunity_id is not null;

-- A pricing document can now come from a deal line (§4.3: Price all on an
-- opportunity). 0111 created the check inline, so its name is Postgres's
-- default for a column check.
alter table pricing_documents drop constraint if exists pricing_documents_source_check;
alter table pricing_documents add constraint pricing_documents_source_check
  check (source in ('api','quote','standard_quote','work_order','opportunity','test','simulation'));
