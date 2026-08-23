-- 0101: Coverage — replaces the flat territory/sales_org picklists with a
-- rule-based org model (owner decision 2026-08-26, "BPMSquare Coverage",
-- from the Orbit proposal deck). Three pieces:
--   TEAM     -- a group of people with a lead. Pure people structure,
--              separate from tenant_users' permission role.
--   SEGMENT  -- a saved rule over accounts (state/industry/size/... via
--              src/lib/marketingSegmentation.ts's existing filter engine,
--              plus an explicit named-account-id list this migration adds
--              support for), OR a rule, never both required.
--   COVERAGE -- the wiring: Team x Segment x Role (owner/overlay/service),
--              with effective dates and a priority for owner-conflict
--              precedence. Nothing is ever written onto an account record
--              for this -- coverage is computed live from the rule, not
--              stored as a label.
--
-- Territory and sales_org survive unchanged as two of the fields a segment
-- rule can read (already true today via SEGMENT_FIELDS) -- fully backward
-- compatible, per the proposal's own framing.
--
-- RISK-BASED RLS CHOICE (MULTI_TENANT_GUARDRAILS.md's WFM lesson, "check
-- what the risk profile actually calls for before defaulting to FOR ALL"):
-- unlike products/custom_fields (ordinary master data -- any tenant member
-- editing them is a data-quality issue at worst), a forged row here can
-- reassign account ownership (accounts.owner_user_id), redirect which ERP a
-- record pushes to (coverages.erp_endpoint_id), or broaden a segment's
-- reach to grab accounts/products it shouldn't match. That is the same
-- "any employee can alter data with real consequence via direct PostgREST"
-- risk class the wfm_ot_sessions incident was. So: SELECT-only RLS on all
-- four tables (every tenant member can read, since the Account 360 card and
-- quote-line availability checks need it), no insert/update/delete policy
-- at all -- every write goes through the admin client from an app route
-- that checks role === "admin" first, matching custom_fields' POST route.

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  lead_user_id uuid references auth.users(id),
  custom_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists teams_tenant_idx on teams (tenant_id, name);

create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (team_id, user_id)
);
create index if not exists team_members_team_idx on team_members (team_id);
create index if not exists team_members_tenant_idx on team_members (tenant_id);

create table if not exists segments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  code text not null,                 -- short rule code, e.g. "SOUTH", "HOSPITALS"
  name text not null,
  -- Same shape as marketing target groups' filters/match (SegmentFilter[]
  -- / "all"|"any") -- src/lib/marketingSegmentation.ts's engine, reused,
  -- not reimplemented. sanitizeSegmentFilters()/sanitizeMatch() validate
  -- both server-side on every write, same as the marketing route does.
  filters jsonb not null default '[]'::jsonb,
  match text not null default 'all' check (match in ('all', 'any')),
  -- Explicit named-account overrides -- ORed with the filter match, not
  -- ANDed, so a strategic account can be pinned to a segment regardless of
  -- whether it happens to also match the field rule.
  account_ids uuid[] not null default '{}',
  custom_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists segments_tenant_idx on segments (tenant_id, name);
create unique index if not exists segments_tenant_code_key on segments (tenant_id, code);

create table if not exists coverages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  segment_id uuid not null references segments(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  role text not null check (role in ('owner', 'overlay', 'service')),
  -- Owner-conflict precedence when two OWNER coverages match the same
  -- account: lower priority number wins; ties break on created_at (older
  -- wins) with a Settings-page warning surfaced for the tie. Irrelevant to
  -- overlay/service, which are additive by design (many can match at once).
  priority integer not null default 100,
  -- Which named ERP endpoint (config.integration_push.endpoints[].id, a
  -- client-generated id, not a DB fk -- endpoints live in tenant config
  -- jsonb) an owner coverage's accounts push to. Null = the tenant's
  -- existing single default webhook_url/webhook_secret, unchanged.
  erp_endpoint_id text,
  effective_from date not null default current_date,
  effective_to date,
  custom_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coverages_dates_check check (effective_to is null or effective_to >= effective_from)
);
create index if not exists coverages_tenant_idx on coverages (tenant_id);
create index if not exists coverages_segment_idx on coverages (segment_id);
create index if not exists coverages_team_idx on coverages (team_id);

alter table teams enable row level security;
alter table team_members enable row level security;
alter table segments enable row level security;
alter table coverages enable row level security;

create policy "teams: tenant read" on teams for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "team_members: tenant read" on team_members for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "segments: tenant read" on segments for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "coverages: tenant read" on coverages for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- Auto-ownership (the deck's "unlocked" feature, built alongside core since
-- the owner asked for the full scope in one pass, not phased). Nullable and
-- unset by default -- an account with no matching OWNER coverage simply has
-- no owner, same as today.
alter table accounts add column if not exists owner_user_id uuid references auth.users(id);
create index if not exists accounts_owner_idx on accounts (tenant_id, owner_user_id);

-- Product availability gating (also an "unlocked" feature). Empty/null =
-- sellable everywhere, i.e. today's behaviour, unchanged -- a product only
-- becomes restricted once a tenant explicitly assigns it to specific
-- segments.
alter table products add column if not exists available_segment_ids uuid[] not null default '{}';
