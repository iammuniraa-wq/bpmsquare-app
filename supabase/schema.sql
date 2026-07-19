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
