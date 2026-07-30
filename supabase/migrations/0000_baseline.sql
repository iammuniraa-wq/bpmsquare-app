-- 0000_baseline.sql
-- Full multi-tenant schema baseline == supabase/schema.sql as of 2026-07-19
-- (the state after legacy migrations 0001..0029, which live in
-- supabase/migrations_legacy/ and are ALREADY APPLIED on production).
-- A fresh database (e.g. the staging project) is built by applying this
-- baseline followed by 0030+ in filename order -- which is exactly what
-- Supabase's GitHub integration does with this directory.

-- =============================================================================
-- VeveyCRM — Full Schema (Multitenant)
-- Run once in Supabase SQL Editor.
-- =============================================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- =============================================================================
-- 1. PLATFORM LAYER
-- =============================================================================

-- Platform admins (whitelist — your own emails only)
create table platform_admins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  email      text not null unique,
  created_at timestamptz not null default now()
);

-- Seed your own admin email immediately
insert into platform_admins (email) values ('sap.rashid@gmail.com');

-- Tenants (one row per customer / repair-shop business)
create table tenants (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,                      -- URL-safe, e.g. "vikas"
  name         text not null,
  logo_url     text,
  accent_color text not null default '#3b82f6',           -- CSS hex
  status       text not null default 'active'
                 check (status in ('active', 'suspended', 'trial')),
  plan         text not null default 'free'
                 check (plan in ('free', 'pro', 'enterprise')),
  -- Feature flags — admin toggles these per tenant
  features     jsonb not null default '{
    "leads":        false,
    "pipeline":     false,
    "amc":          false,
    "dispatch":     false,
    "invoices":     false,
    "partners":     false,
    "ai_assistant": false,
    "db_export":    false
  }'::jsonb,
  -- Local admin configurable: entities (name, address, GSTIN) + tax settings
  config       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Seed first tenant (Vikas Pioneers — your design partner)
insert into tenants (slug, name, accent_color, status, plan, features)
values (
  'vikas',
  'Vikas Pioneers',
  '#FF6B00',
  'active',
  'pro',
  '{
    "leads":        true,
    "pipeline":     false,
    "amc":          true,
    "dispatch":     false,
    "invoices":     true,
    "partners":     false,
    "ai_assistant": false,
    "db_export":    false
  }'::jsonb
);

-- Tenant users — maps auth.users to a tenant with a role
create table tenant_users (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member'
                check (role in ('admin', 'member')),
  invited_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (tenant_id, user_id)
);

-- =============================================================================
-- 2. DOMAIN TABLES — all carry tenant_id
-- =============================================================================

create table accounts (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id) on delete cascade,
  name                    text not null,
  type                    text not null check (type in ('prospect','oem','direct','end_customer')),
  city                    text,
  phone                   text,
  email                   text,
  referred_by_account_id  uuid references accounts(id),
  created_at              timestamptz not null default now()
);

create table contacts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  account_id  uuid not null references accounts(id) on delete cascade,
  name        text not null,
  role        text,
  phone       text,
  email       text
);

create table sites (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  account_id  uuid not null references accounts(id) on delete cascade,
  label       text not null,
  address     text
);

create table assets (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  account_id     uuid references accounts(id) on delete set null, -- null = company-owned loaner
  kind           text not null check (kind in ('motor','transformer','pump','generator','panel')),
  name           text not null,
  make           text,
  model          text,
  rating         text,
  serial         text,
  notes          text,
  is_loaner      boolean not null default false,
  loaner_status  text check (loaner_status in ('available','on_loan'))
);

create table contracts (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  account_id          uuid not null references accounts(id) on delete cascade,
  ref                 text not null,
  holder_account_id   uuid references accounts(id),
  status              text not null default 'draft' check (status in ('active','expired','draft')),
  start_date          date,
  end_date            date,
  value               numeric(12,2)
);

create table leads (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  account_id  uuid not null references accounts(id) on delete cascade,
  title       text not null,
  source      text not null check (source in ('oem_referral','amc','direct')),
  status      text not null default 'new' check (status in ('new','inspecting','quoted','won','lost')),
  created_at  timestamptz not null default now()
);

create table quotes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  account_id   uuid not null references accounts(id) on delete cascade,
  ref          text not null,
  status       text not null default 'draft' check (status in ('draft','sent','approved','rejected')),
  total        numeric(12,2) not null default 0,
  revision     integer not null default 1,
  notes        text,
  valid_until  date,
  created_at   timestamptz not null default now()
);

create table quote_revisions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  quote_id    uuid not null references quotes(id) on delete cascade,
  rev         integer not null,
  date        date not null,
  description text not null
);

create table quote_lines (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  quote_id     uuid not null references quotes(id) on delete cascade,
  description  text not null,
  qty          numeric(10,2) not null default 1,
  rate         numeric(12,2) not null default 0,
  amount       numeric(12,2) not null default 0
);

create table technicians (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  name                text not null,
  phone               text,
  email               text,
  skills              text,
  certifications      text[] not null default '{}',
  cert_expiry         jsonb not null default '{}',   -- { "HV License": "2026-12-31" }
  status              text not null default 'active' check (status in ('active','on_leave','inactive')),
  base_location       text,
  max_visits_per_day  integer not null default 3
);

create table technician_leaves (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  technician_id  uuid not null references technicians(id) on delete cascade,
  from_date      date not null,
  to_date        date not null,
  reason         text not null check (reason in ('vacation','sick','training','other')),
  notes          text
);

create table service_cases (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  account_id       uuid not null references accounts(id) on delete cascade,
  ref              text not null,
  type             text not null check (type in ('amc','adhoc','direct')),
  status           text not null default 'intake' check (status in (
                     'intake','inspection','report_sent','report_approved',
                     'quote_sent','quote_approved','in_repair','qa',
                     'ready','closed','buyback','scrapped')),
  asset_id         uuid references assets(id),
  equipment_label  text not null,
  complaint        text not null,
  assigned_to      uuid references technicians(id),
  intake_at        timestamptz not null default now(),
  closed_at        timestamptz,
  quote_id         uuid references quotes(id),
  contract_id      uuid references contracts(id),
  has_loaner       boolean not null default false,
  loaner_asset_id  uuid references assets(id),
  parent_case_id   uuid references service_cases(id),
  disposition      text check (disposition in ('repair','buyback','scrap')),
  notes            text
);

create table work_orders (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  account_id      uuid not null references accounts(id) on delete cascade,
  ref             text not null,
  case_id         uuid references service_cases(id),
  asset_id        uuid references assets(id),
  technician_id   uuid references technicians(id),
  auth_kind       text not null check (auth_kind in ('quote','contract')),
  auth_id         uuid not null,   -- FK to quotes.id or contracts.id depending on auth_kind
  status          text not null default 'scheduled' check (status in ('scheduled','in_progress','completed','invoiced')),
  scheduled_for   timestamptz,
  description     text,
  notes           text
);

create table invoices (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  account_id     uuid not null references accounts(id) on delete cascade,
  ref            text not null,
  work_order_id  uuid references work_orders(id),
  status         text not null default 'draft' check (status in ('draft','sent','paid','overdue')),
  total          numeric(12,2) not null default 0,
  issued_at      timestamptz
);

create table visit_logs (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id) on delete cascade,
  work_order_id           uuid not null references work_orders(id) on delete cascade,
  technician_id           uuid not null references technicians(id),
  account_id              uuid not null references accounts(id),
  visit_date              date not null,
  travel_start_time       time,
  travel_distance_km      numeric(8,2),
  arrived_time            time,
  work_start_time         time,
  break_start_time        time,
  break_end_time          time,
  work_end_time           time,
  return_start_time       time,
  return_end_time         time,
  work_done               text,
  parts_used              text,
  customer_feedback       text,
  next_action             text,
  needs_escalation        boolean not null default false,
  customer_acknowledged   boolean not null default false,
  status                  text not null default 'planned' check (status in ('planned','in_progress','completed','cancelled'))
);

create table activities (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  account_id  uuid not null references accounts(id) on delete cascade,
  pillar      text not null check (pillar in ('marketing','sales','service','field','finance')),
  text        text not null,
  at          timestamptz not null default now()
);

create table case_photos (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  case_id   uuid not null references service_cases(id) on delete cascade,
  stage     text not null check (stage in ('intake','inspection','final')),
  caption   text not null,
  taken_at  timestamptz not null default now()
);

create table inspection_reports (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  case_id          uuid not null references service_cases(id) on delete cascade,
  findings         text not null,
  recommendations  text not null,
  estimated_cost   numeric(12,2),
  status           text not null default 'draft' check (status in ('draft','sent','approved','rejected')),
  sent_at          timestamptz,
  approved_at      timestamptz
);

create table pricing_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  category    text not null check (category in ('labour','material','testing','transport')),
  description text not null,
  unit        text not null,
  rate        numeric(12,2) not null default 0,
  notes       text
);

create table text_fragments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  label       text not null,
  category    text not null check (category in ('line_item','notes','terms','sow')),
  text        text not null
);

-- =============================================================================
-- 3. ROW LEVEL SECURITY
-- =============================================================================

-- LEGACY / UNUSED as of migration 0028 — do not use this in new policies.
-- Originally read a `tenant_id` claim baked into the JWT once at login by a
-- Postgres Auth Hook. That claim has zero awareness of which hostname/tenant
-- a given request is actually for and goes stale the moment a user's
-- tenant_users membership changes after login (e.g. a platform admin's row
-- auto-created by resolveTenantIdForPlatformAdmin() on first visiting a new
-- tenant's custom domain) — this caused real "new row violates row-level
-- security policy" failures on writes. Every policy below now checks
-- tenant_users membership live instead (see 0028_fix_rls_stale_jwt_tenant_claim.sql).
-- Kept defined (unused) rather than dropped in case anything outside this
-- repo's tracked migrations still references it.
create or replace function auth_tenant_id()
returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'tenant_id', '')::uuid
$$;

-- Helper: returns true if the calling user is a platform admin.
create or replace function is_platform_admin()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from platform_admins where user_id = auth.uid()
  )
$$;

-- Helper: the calling user's tenant_id(s). SECURITY DEFINER so this query
-- bypasses tenant_users' own RLS (runs as the function owner, who isn't
-- subject to it) — required to avoid "infinite recursion detected in
-- policy for relation tenant_users" (see 0029_fix_tenant_users_recursive_policy.sql).
-- Every other table's "tenant isolation" policy subqueries tenant_users
-- directly (not through this function) and that's fine — it only needed
-- tenant_users' own SELECT policy to be non-recursive, which this fixes.
create or replace function my_tenant_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select tenant_id from tenant_users where user_id = auth.uid()
$$;

-- Enable RLS on every table
alter table platform_admins    enable row level security;
alter table tenants            enable row level security;
alter table tenant_users       enable row level security;
alter table accounts           enable row level security;
alter table contacts           enable row level security;
alter table sites              enable row level security;
alter table assets             enable row level security;
alter table contracts          enable row level security;
alter table leads              enable row level security;
alter table quotes             enable row level security;
alter table quote_revisions    enable row level security;
alter table quote_lines        enable row level security;
alter table technicians        enable row level security;
alter table technician_leaves  enable row level security;
alter table service_cases      enable row level security;
alter table work_orders        enable row level security;
alter table invoices           enable row level security;
alter table visit_logs         enable row level security;
alter table activities         enable row level security;
alter table case_photos        enable row level security;
alter table inspection_reports enable row level security;
alter table pricing_items      enable row level security;
alter table text_fragments     enable row level security;

-- Platform admins: only admins can see/modify
create policy "platform_admins: admin only"
  on platform_admins for all
  using (is_platform_admin());

-- Tenants: platform admins full access; tenant members can read their own row
create policy "tenants: admin full access"
  on tenants for all
  using (is_platform_admin());

create policy "tenants: members read own"
  on tenants for select
  using (id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- Tenant users: admins full; members read own tenant
create policy "tenant_users: admin full"
  on tenant_users for all
  using (is_platform_admin());

create policy "tenant_users: members read own tenant"
  on tenant_users for select
  using (tenant_id in (select my_tenant_ids()));

-- Macro: all domain tables use the same tenant_id isolation pattern —
-- a live tenant_users membership check (NOT the legacy JWT-claim
-- auth_tenant_id(), see the comment above its definition).
-- Members can CRUD rows belonging to their tenant only.
-- Platform admins bypass via service role key (not via RLS — they use
-- the Supabase service role in the /admin API routes).

create policy "accounts: tenant isolation"
  on accounts for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "contacts: tenant isolation"
  on contacts for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "sites: tenant isolation"
  on sites for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "assets: tenant isolation"
  on assets for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "contracts: tenant isolation"
  on contracts for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "leads: tenant isolation"
  on leads for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "quotes: tenant isolation"
  on quotes for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "quote_revisions: tenant isolation"
  on quote_revisions for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "quote_lines: tenant isolation"
  on quote_lines for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "technicians: tenant isolation"
  on technicians for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "technician_leaves: tenant isolation"
  on technician_leaves for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "service_cases: tenant isolation"
  on service_cases for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "work_orders: tenant isolation"
  on work_orders for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "invoices: tenant isolation"
  on invoices for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "visit_logs: tenant isolation"
  on visit_logs for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "activities: tenant isolation"
  on activities for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "case_photos: tenant isolation"
  on case_photos for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "inspection_reports: tenant isolation"
  on inspection_reports for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "pricing_items: tenant isolation"
  on pricing_items for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "text_fragments: tenant isolation"
  on text_fragments for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- =============================================================================
-- 4. INDEXES (performance on the FK columns most queried)
-- =============================================================================

create index on accounts        (tenant_id);
create index on contacts        (tenant_id, account_id);
create index on sites           (tenant_id, account_id);
create index on assets          (tenant_id, account_id);
create index on contracts       (tenant_id, account_id);
create index on leads           (tenant_id, account_id);
create index on quotes          (tenant_id, account_id);
create index on quote_lines     (tenant_id, quote_id);
create index on quote_revisions (tenant_id, quote_id);
create index on technicians     (tenant_id);
create index on technician_leaves (tenant_id, technician_id);
create index on service_cases   (tenant_id, account_id);
create index on work_orders     (tenant_id, account_id);
create index on work_orders     (tenant_id, case_id);
create index on invoices        (tenant_id, account_id);
create index on visit_logs      (tenant_id, work_order_id);
create index on activities      (tenant_id, account_id);
create index on case_photos     (tenant_id, case_id);
create index on inspection_reports (tenant_id, case_id);
create index on tenant_users    (tenant_id, user_id);

-- =============================================================================
-- 5. UPDATED_AT TRIGGER (tenants table)
-- =============================================================================

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tenants_updated_at
  before update on tenants
  for each row execute procedure set_updated_at();

-- =============================================================================
-- NOTES FOR NEXT STEPS
-- =============================================================================
-- A) Supabase Auth Hook — inject tenant_id into the JWT:
--    LEGACY as of migration 0028 — no RLS policy reads this claim anymore
--    (see auth_tenant_id()'s comment above). Safe to leave enabled in the
--    Supabase Dashboard (harmless, just unused) or to disable under
--    Auth → Hooks → "Custom Access Token Hook" — your call, not required
--    either way for tenant isolation to work correctly.
--    In Supabase Dashboard → Auth → Hooks → "Custom Access Token Hook"
--    Point it at a Postgres function like:
--
--    create or replace function public.custom_access_token_hook(event jsonb)
--    returns jsonb language plpgsql stable security definer as $$
--    declare
--      tenant_id uuid;
--    begin
--      select tu.tenant_id into tenant_id
--      from tenant_users tu
--      where tu.user_id = (event ->> 'user_id')::uuid
--      limit 1;
--
--      if tenant_id is not null then
--        event := jsonb_set(event, '{claims,tenant_id}', to_jsonb(tenant_id::text));
--      end if;
--
--      return event;
--    end;
--    $$;
--
-- B) Admin routes use the Supabase SERVICE ROLE KEY (bypasses RLS).
--    Never expose the service role key to the client.
--
-- C) Invite flow: platform admin creates tenant → creates auth user via
--    supabase.auth.admin.inviteUserByEmail() → inserts tenant_users row.

-- =============================================================================
-- BASELINE ADDENDUM (appended 2026-07-30)
-- The schema.sql snapshot above is EARLIER than first assumed: legacy
-- migrations 0007..0027 (supabase/migrations_legacy/) ALTER on top of it, and
-- tenants.company_info was only ever added ad-hoc in the production dashboard.
-- Replaying them here (all statements are if-not-exists-guarded) makes this
-- baseline genuinely complete, so a fresh database built from this directory
-- matches production. 0001..0006 are superseded by the snapshot; 0028/0029's
-- RLS fixes are already reflected in it.
-- =============================================================================

-- ---- legacy 0007_quote_offer_fields.sql ----
-- Quotation offer-type enhancements (BRD: Quotation / Technical offer / Budgetary offer)
-- quote.type now stores: quotation | technical | budgetary | supply | repair (legacy)

alter table quotes
  add column if not exists entity_id       text,          -- which tenant entity issued this quote
  add column if not exists scope_of_work   text,          -- description of work / motor issue
  add column if not exists terms           text,          -- T&C stored separately from notes
  add column if not exists business_status text not null default 'pending';
                                                          -- pending | po_received (Vikas BRD statuses)

alter table quote_lines
  add column if not exists uom text;                     -- Unit of Measure: Nos, Job, Set, Mtr, Kg …

-- ---- legacy 0008_quote_contact_fields.sql ----
-- Additional fields needed by the full quote form
alter table quotes
  add column if not exists name          text,
  add column if not exists contact_id    text,
  add column if not exists po_number     text,
  add column if not exists po_amount     numeric(14,2),
  add column if not exists discount_type text    not null default 'pct',
  add column if not exists discount_pct  numeric(5,2) not null default 0,
  add column if not exists discount_fixed numeric(14,2) not null default 0,
  add column if not exists asset_ids     text[]  not null default '{}';

-- Prevent duplicate refs within a tenant
create unique index if not exists quotes_tenant_ref_uniq on quotes (tenant_id, ref);

-- ---- legacy 0009_suppliers.sql ----
-- Migration 0009: suppliers table
-- Suppliers are vendors/subcontractors (distinct from Accounts which are customers).

create table if not exists suppliers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null,
  type       text not null default 'vendor' check (type in ('vendor', 'subcontractor', 'both')),
  city       text,
  phone      text,
  email      text,
  gstin      text,
  notes      text,
  status     text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);

create index if not exists suppliers_tenant_idx on suppliers (tenant_id);

-- RLS
alter table suppliers enable row level security;

create policy "tenant members can read suppliers"
  on suppliers for select
  using (
    tenant_id in (
      select tenant_id from tenant_users where user_id = auth.uid()
    )
  );

create policy "tenant members can insert suppliers"
  on suppliers for insert
  with check (
    tenant_id in (
      select tenant_id from tenant_users where user_id = auth.uid()
    )
  );

create policy "tenant members can update suppliers"
  on suppliers for update
  using (
    tenant_id in (
      select tenant_id from tenant_users where user_id = auth.uid()
    )
  );

create policy "tenant members can delete suppliers"
  on suppliers for delete
  using (
    tenant_id in (
      select tenant_id from tenant_users where user_id = auth.uid()
    )
  );

-- ---- legacy 0010_expand_accounts_contacts.sql ----
-- Expand accounts and contacts with full standard field sets.
-- Adds address, extended communication, business fields, and custom_data JSONB.

-- ── Accounts ─────────────────────────────────────────────────────────────────

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS address_line1   text,
  ADD COLUMN IF NOT EXISTS address_line2   text,
  ADD COLUMN IF NOT EXISTS state           text,
  ADD COLUMN IF NOT EXISTS postal_code     text,
  ADD COLUMN IF NOT EXISTS country         text,
  ADD COLUMN IF NOT EXISTS phone2          text,
  ADD COLUMN IF NOT EXISTS email2          text,
  ADD COLUMN IF NOT EXISTS website         text,
  ADD COLUMN IF NOT EXISTS industry        text,
  ADD COLUMN IF NOT EXISTS employee_count  text,
  ADD COLUMN IF NOT EXISTS annual_revenue  text,
  ADD COLUMN IF NOT EXISTS gstin           text,
  ADD COLUMN IF NOT EXISTS notes           text,
  ADD COLUMN IF NOT EXISTS custom_data     jsonb;

-- Fix type check constraint to include 'prospect' (was missing from 0001_init.sql).
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_type_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_type_check
  CHECK (type IN ('prospect', 'oem', 'direct', 'end_customer'));

-- ── Contacts ─────────────────────────────────────────────────────────────────

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS department      text,
  ADD COLUMN IF NOT EXISTS birthday        date,
  ADD COLUMN IF NOT EXISTS linkedin_url    text,
  ADD COLUMN IF NOT EXISTS website         text,
  ADD COLUMN IF NOT EXISTS address_line1   text,
  ADD COLUMN IF NOT EXISTS address_line2   text,
  ADD COLUMN IF NOT EXISTS city            text,
  ADD COLUMN IF NOT EXISTS state           text,
  ADD COLUMN IF NOT EXISTS postal_code     text,
  ADD COLUMN IF NOT EXISTS country         text,
  ADD COLUMN IF NOT EXISTS notes           text,
  ADD COLUMN IF NOT EXISTS custom_data     jsonb;

-- ---- legacy 0011_custom_fields.sql ----
-- Custom fields system: tenant-defined fields on any object.
-- Values are stored in the custom_data JSONB column on each record.

CREATE TABLE IF NOT EXISTS custom_fields (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_type  text NOT NULL CHECK (object_type IN ('account','contact','case','quote','work_order','asset')),
  field_key    text NOT NULL,               -- auto-generated: cf_<label_slug>
  field_label  text NOT NULL,
  field_type   text NOT NULL CHECK (field_type IN ('text','number','date','select','checkbox','textarea')),
  field_section text,                       -- which form section: e.g. "Identity", "Address"
  options      text[],                      -- for select type
  is_required  boolean NOT NULL DEFAULT false,
  position     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, object_type, field_key)
);

CREATE INDEX IF NOT EXISTS custom_fields_tenant_object ON custom_fields (tenant_id, object_type);

-- ---- legacy 0012_quote_lines_additions.sql ----
-- Add sl_no (editable serial number, alphanumeric) and group_description to quote_lines
ALTER TABLE quote_lines ADD COLUMN IF NOT EXISTS sl_no text;
ALTER TABLE quote_lines ADD COLUMN IF NOT EXISTS group_description text;

-- Add custom_data to quotes if not present (may already exist)
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS custom_data jsonb;

-- ---- legacy 0013_text_fragments_sow.sql ----
-- Allow 'sow' (scope of work) as a text_fragment category
ALTER TABLE text_fragments DROP CONSTRAINT IF EXISTS text_fragments_category_check;
ALTER TABLE text_fragments ADD CONSTRAINT text_fragments_category_check
  CHECK (category IN ('line_item', 'notes', 'terms', 'sow'));

-- ---- legacy 0014_storage_company_assets.sql ----
-- Public bucket for company logos and partner logos uploaded via /api/upload
insert into storage.buckets (id, name, public)
values ('company-assets', 'company-assets', true)
on conflict (id) do nothing;

-- Allow authenticated users of any tenant to upload to their own folder
create policy "tenant users can upload company assets"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'company-assets');

-- Public read
create policy "public can read company assets"
  on storage.objects for select
  to public
  using (bucket_id = 'company-assets');

-- Allow authenticated users to delete objects they uploaded
create policy "tenant users can delete company assets"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'company-assets');

-- ---- legacy 0015_quotes_pr_no.sql ----
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS pr_no text;

-- ---- legacy 0016_quotes_status_open.sql ----
-- Drop the hard-coded status check so tenant-configured custom statuses are allowed.
-- Validation is now enforced at the application layer via tenant config.
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check;

-- ---- legacy 0017_quote_line_category_deduction.sql ----
-- Per-line category (reuses the pricing-catalog taxonomy) and a deduction amount
-- for material-category lines (e.g. copper wire salvage credit). Deductions are
-- summed and subtracted once at the quote grand-total level, not per line.
ALTER TABLE quote_lines
  ADD COLUMN IF NOT EXISTS category   text,
  ADD COLUMN IF NOT EXISTS deduction  numeric DEFAULT 0;

-- ---- legacy 0017_territory_sales_org.sql ----
-- Add territory and sales_org to all core objects.
-- Simple text fields — no FK constraints, controlled values added later via settings if needed.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS territory  text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sales_org  text;

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS territory  text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS sales_org  text;

ALTER TABLE quotes   ADD COLUMN IF NOT EXISTS territory  text;
ALTER TABLE quotes   ADD COLUMN IF NOT EXISTS sales_org  text;

ALTER TABLE service_cases ADD COLUMN IF NOT EXISTS territory  text;
ALTER TABLE service_cases ADD COLUMN IF NOT EXISTS sales_org  text;

-- ---- legacy 0018_tenant_custom_domain.sql ----
alter table tenants add column if not exists custom_domain text unique;
comment on column tenants.custom_domain is
  'Hostname that resolves to this tenant via middleware (e.g. vikas.bpmsquare.com). Null = no dedicated domain, reachable only via app.bpmsquare.com login.';

-- ---- legacy 0019_quotes_ref_no.sql ----
-- CR-001: client-enterable "Ref No" field, distinct from the system-generated Quote ID
-- (quotes.ref). Free text so clients can use their own letters/numbers/special-character
-- reference convention.
alter table quotes add column if not exists ref_no text;

-- ---- legacy 0020_custom_data_assets_cases_workorders.sql ----
-- custom_fields (migration 0011) supports object_type asset/case/work_order, and their API
-- routes already PATCH custom_data on them, but the column itself was only ever added to
-- accounts/contacts (0010) and quotes (0012) -- never to assets, service_cases, or
-- work_orders. Any attempt to save a custom field value on those three has been failing at
-- the DB level. Adding it now, idempotently, to all three.

alter table assets       add column if not exists custom_data jsonb;
alter table service_cases add column if not exists custom_data jsonb;
alter table work_orders  add column if not exists custom_data jsonb;

-- ---- legacy 0021_inventory.sql ----
-- Migration 0021: inventory_items + inventory_transactions
-- Core product objects (every tenant). qty_on_hand is only ever mutated through
-- adjust_inventory_qty(), which updates the counter and inserts a ledger row atomically --
-- avoids a lost-update race if two receipts/adjustments land concurrently, and guarantees
-- every stock change is audited.

create table if not exists inventory_items (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  sku           text,
  name          text not null,
  description   text,
  category      text,
  uom           text not null default 'Nos',
  supplier_id   uuid references suppliers(id) on delete set null,
  qty_on_hand   numeric(12,2) not null default 0,
  reorder_level numeric(12,2),
  unit_cost     numeric(12,2),
  status        text not null default 'active' check (status in ('active','inactive')),
  notes         text,
  custom_data   jsonb,
  created_at    timestamptz not null default now()
);

create unique index if not exists inventory_items_tenant_sku_uniq
  on inventory_items (tenant_id, sku) where sku is not null;
create index if not exists inventory_items_tenant_idx on inventory_items (tenant_id);
create index if not exists inventory_items_tenant_supplier_idx on inventory_items (tenant_id, supplier_id);

create table if not exists inventory_transactions (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  type              text not null check (type in ('receipt','adjustment')),
  qty_delta         numeric(12,2) not null,
  balance_after     numeric(12,2) not null,
  reference_type    text check (reference_type in ('purchase_order_line','manual')),
  reference_id      uuid,
  note              text,
  created_by        uuid,
  created_at        timestamptz not null default now()
);

create index if not exists inventory_transactions_item_idx
  on inventory_transactions (tenant_id, inventory_item_id, created_at desc);

create or replace function adjust_inventory_qty(
  p_tenant_id uuid, p_item_id uuid, p_delta numeric,
  p_type text, p_reference_type text, p_reference_id uuid,
  p_note text, p_created_by uuid
) returns numeric language plpgsql as $$
declare v_new numeric;
begin
  update inventory_items set qty_on_hand = qty_on_hand + p_delta
    where id = p_item_id and tenant_id = p_tenant_id
    returning qty_on_hand into v_new;
  if v_new is null then
    raise exception 'inventory item not found';
  end if;
  insert into inventory_transactions
    (tenant_id, inventory_item_id, type, qty_delta, balance_after, reference_type, reference_id, note, created_by)
    values (p_tenant_id, p_item_id, p_type, p_delta, v_new, p_reference_type, p_reference_id, p_note, p_created_by);
  return v_new;
end;
$$;

-- RLS -- same tenant-isolation pattern as every other table (see 0009_suppliers.sql)
alter table inventory_items enable row level security;
alter table inventory_transactions enable row level security;

create policy "tenant members can read inventory_items" on inventory_items for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can insert inventory_items" on inventory_items for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can update inventory_items" on inventory_items for update
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can delete inventory_items" on inventory_items for delete
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "tenant members can read inventory_transactions" on inventory_transactions for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can insert inventory_transactions" on inventory_transactions for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ---- legacy 0022_purchase_orders.sql ----
-- Migration 0022: purchase_orders + purchase_order_lines
-- Core product objects (every tenant). A PO always has a supplier; quote_id/case_id are
-- independent optional links (which quote this is fulfilling / which repair job needed the
-- part) -- no account_id, it's derivable through either link when needed.

create table if not exists purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  ref           text not null,
  supplier_id   uuid not null references suppliers(id) on delete restrict,
  quote_id      uuid references quotes(id) on delete set null,
  case_id       uuid references service_cases(id) on delete set null,
  status        text not null default 'draft'
                  check (status in ('draft','sent','partially_received','received','cancelled')),
  order_date    date,
  expected_date date,
  notes         text,
  terms         text,
  total         numeric(12,2) not null default 0,
  custom_data   jsonb,
  created_by    uuid,
  created_at    timestamptz not null default now()
);

create unique index if not exists purchase_orders_tenant_ref_uniq on purchase_orders (tenant_id, ref);
create index if not exists purchase_orders_tenant_idx on purchase_orders (tenant_id);
create index if not exists purchase_orders_tenant_supplier_idx on purchase_orders (tenant_id, supplier_id);

create table if not exists purchase_order_lines (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  po_id             uuid not null references purchase_orders(id) on delete cascade,
  inventory_item_id uuid references inventory_items(id) on delete set null,
  sl_no             integer,
  description       text not null,
  uom               text,
  qty_ordered       numeric(12,2) not null default 1,
  qty_received      numeric(12,2) not null default 0,
  rate              numeric(12,2) not null default 0,
  amount            numeric(12,2) not null default 0
);

create index if not exists purchase_order_lines_po_idx on purchase_order_lines (po_id);

-- Soft link only -- no automatic stock mutation from quote lines in v1.
alter table quote_lines add column if not exists inventory_item_id uuid references inventory_items(id) on delete set null;

-- RLS
alter table purchase_orders enable row level security;
alter table purchase_order_lines enable row level security;

create policy "tenant members can read purchase_orders" on purchase_orders for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can insert purchase_orders" on purchase_orders for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can update purchase_orders" on purchase_orders for update
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can delete purchase_orders" on purchase_orders for delete
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "tenant members can read purchase_order_lines" on purchase_order_lines for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can insert purchase_order_lines" on purchase_order_lines for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can update purchase_order_lines" on purchase_order_lines for update
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can delete purchase_order_lines" on purchase_order_lines for delete
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ---- legacy 0023_custom_fields_widen_and_suppliers_custom_data.sql ----
-- Migration 0023: widen custom_fields.object_type to cover the new objects (+ suppliers,
-- which had zero custom-fields support until now), and add custom_data to suppliers.

alter table custom_fields drop constraint if exists custom_fields_object_type_check;
alter table custom_fields add constraint custom_fields_object_type_check
  check (object_type in ('account','contact','case','quote','work_order','asset','supplier','inventory','purchase_order'));

alter table suppliers add column if not exists custom_data jsonb;

-- ---- legacy 0024_tenants_api_key.sql ----
-- Migration 0024: per-tenant API key for the external /api/v1 surface.
-- The legacy v1 routes (accounts/cases/quotations) only ever checked one process-wide
-- VEVEY_API_KEY boolean against seed data -- there was no real tenant resolution to reuse.
-- Genuinely tenant-scoped live routes (inventory, purchase-orders) need this instead.

alter table tenants add column if not exists api_key text unique;

-- ---- legacy 0025_invoices.sql ----
-- Migration 0025: full invoicing -- extend invoices, add invoice_lines + invoice_payments,
-- widen custom_fields.object_type.
--
-- invoices/work_orders already carry tenant_id live (schema.sql is the source of truth,
-- 0001_init.sql is stale) -- this only ALTERs the existing invoices table, it does not
-- recreate it. RLS is (re)established defensively below even though invoices already accepts
-- inserts via the session client today -- no tracked migration ever proved a full policy set
-- exists, and enabling/creating policies is idempotent, so there's no reason to leave it to
-- chance.

alter table invoices
  add column if not exists contact_id     text,          -- matches quotes.contact_id exactly (text, no FK)
  add column if not exists quote_id       uuid references quotes(id) on delete set null,
  add column if not exists case_id        uuid references service_cases(id) on delete set null,
  add column if not exists contract_id    uuid references contracts(id) on delete set null,
  add column if not exists entity_id      text,          -- matches quotes.entity_id: a JSONB-array id in tenants.config.entities[]
  add column if not exists due_date       date,
  add column if not exists discount_type  text not null default 'pct',
  add column if not exists discount_pct   numeric(5,2) not null default 0,
  add column if not exists discount_fixed numeric(14,2) not null default 0,
  add column if not exists notes          text,
  add column if not exists terms          text,
  add column if not exists custom_data    jsonb,
  add column if not exists paid_amount    numeric(12,2) not null default 0,
  add column if not exists created_by     uuid,
  add column if not exists created_at     timestamptz not null default now();

-- Widen status: draft/sent/paid/overdue existed; add partial (payments ledger needs it) and
-- cancelled (every other billable object already has a terminal cancel state).
alter table invoices drop constraint if exists invoices_status_check;
alter table invoices add constraint invoices_status_check
  check (status in ('draft','sent','partial','paid','overdue','cancelled'));

create unique index if not exists invoices_tenant_ref_uniq on invoices (tenant_id, ref);
create index if not exists invoices_tenant_idx on invoices (tenant_id);
create index if not exists invoices_tenant_account_idx on invoices (tenant_id, account_id);
create index if not exists invoices_quote_idx on invoices (quote_id);

alter table invoices enable row level security;
drop policy if exists "tenant members can read invoices" on invoices;
drop policy if exists "tenant members can insert invoices" on invoices;
drop policy if exists "tenant members can update invoices" on invoices;
drop policy if exists "tenant members can delete invoices" on invoices;
create policy "tenant members can read invoices" on invoices for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can insert invoices" on invoices for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can update invoices" on invoices for update
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can delete invoices" on invoices for delete
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  invoice_id  uuid not null references invoices(id) on delete cascade,
  sl_no       text,          -- text, matches quote_lines.sl_no exactly -- invoice lines are usually a verbatim copy of quote_lines
  description text not null,
  uom         text,
  qty         numeric(10,2) not null default 1,
  rate        numeric(12,2) not null default 0,
  amount      numeric(12,2) not null default 0
);
create index if not exists invoice_lines_invoice_idx on invoice_lines (invoice_id);

create table if not exists invoice_payments (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  amount     numeric(12,2) not null check (amount > 0),
  paid_on    date not null default current_date,
  method     text,          -- free text: cash / cheque / bank transfer / UPI -- no enum, no gateway integration
  reference  text,          -- cheque no. / UTR / txn id
  note       text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists invoice_payments_invoice_idx on invoice_payments (invoice_id);

alter table invoice_lines enable row level security;
alter table invoice_payments enable row level security;

create policy "tenant members can read invoice_lines" on invoice_lines for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can insert invoice_lines" on invoice_lines for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can update invoice_lines" on invoice_lines for update
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can delete invoice_lines" on invoice_lines for delete
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create policy "tenant members can read invoice_payments" on invoice_payments for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can insert invoice_payments" on invoice_payments for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can update invoice_payments" on invoice_payments for update
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "tenant members can delete invoice_payments" on invoice_payments for delete
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

alter table custom_fields drop constraint if exists custom_fields_object_type_check;
alter table custom_fields add constraint custom_fields_object_type_check
  check (object_type in ('account','contact','case','quote','work_order','asset','supplier','inventory','purchase_order','invoice'));

-- ---- legacy 0026_case_assets_and_symptom.sql ----
-- Migration 0026: multi-asset support on cases + a separate symptom field.
--
-- asset_ids is the full list (mirrors quotes.asset_ids' exact text[] pattern for consistency).
-- asset_id stays as-is (nullable FK) and is kept in sync as the "primary" (first) asset, so
-- every existing read site that joins on the single asset_id keeps working unmodified.

alter table service_cases
  add column if not exists asset_ids text[] not null default '{}',
  add column if not exists symptom text;

update service_cases set asset_ids = array[asset_id::text]
  where asset_id is not null and asset_ids = '{}';

-- ---- legacy 0027_quotes_gst_rate.sql ----
-- CR-010: GST is optional per quote. When null, no tax row is shown in the Order
-- Summary or PDF (GST @ 18% is instead covered by the Terms & Conditions text);
-- when set, this rate drives the GST line shown in both places.
alter table quotes add column if not exists gst_rate numeric;

-- ---- ad-hoc gap: tenants.company_info (no tracked migration ever added it) ----
alter table tenants add column if not exists company_info jsonb not null default '{}'::jsonb;
