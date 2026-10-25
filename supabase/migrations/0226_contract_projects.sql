-- 0226: Contract projects -- the project a won tender becomes, with its cost budget, numbered revisions and the ERP code lists.
-- GCC tender deals, slice 5a (docs/design/gcc-tender-deals.md section 15). Needs 0120 (opportunities, accounts) before it; asking for a
-- baseline approval also needs 0221 (approval_requests), which an older database may still be waiting for -- the app says so.
--
-- 1. erp_masters: the code lists a budget line points at, one generic table. kind = resource (the ePROMIS resource levels: 11
--    Material, 21 Asset, 31 Man Power, 32 Hiring Man Power, 41 Sub Contractor, 51 Other Direct Cost; 91 Revenue and 92 On Account
--    are flagged revenue_side and are not cost types), cost_code (the MasterFormat tree), justification (why a revision was made),
--    reserve_type, division, job_location. STARTER lists (source 'default': the resource levels with material sub-groups, the
--    MasterFormat division level of the cost codes and a few sections, the justification reasons) are seeded by the application the
--    first time the module is opened, never overwriting an edit; a file import on Settings > Contract projects replaces or extends
--    them (matched on kind + code), and later ePROMIS refreshes them (slice 5b). `flags` carries link_to_inventory,
--    budget_validation and revenue_side.
-- 2. contract_projects: one row per project, ref CPR-####. source_opportunity_id is unique per workspace: one project per won tender.
-- 3. project_budget_revisions: revision 0 is the baseline, each later change a new revision with a justification. At most ONE open
--    (draft or pending) revision and at most ONE approved revision per project, so two people cannot both be "the current budget".
-- 4. project_budget_lines: the budget by resource and cost code. line_key is stable across revisions (copies keep it), which is what
--    a revision diff matches on. committed / actual are read-only here and filled by slice 5b from the ERP.
--
-- The budget is internal cost: nothing here is ever printed on a customer document or shown through a public link.
--
-- RLS (MULTI_TENANT_GUARDRAILS.md; the WFM and 0199 lessons): every table carries a tenant SELECT policy and NOTHING that writes. A
-- budget drives margin and an approved baseline is an audit record, so every write is a service-role API route that has already
-- checked the tenant, the caller, the lock and the approver list; a member cannot edit an approved budget through PostgREST.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the screens say a database update is needed and nothing
-- crashes (42P01 / 42703 / PGRST205 read as "not there yet").

create table if not exists erp_masters (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  kind        text not null check (kind in ('resource', 'cost_code', 'justification', 'reserve_type', 'division', 'job_location')),
  code        text not null check (char_length(code) between 1 and 40),
  name        text not null check (char_length(name) between 1 and 200),
  parent_code text check (parent_code is null or char_length(parent_code) between 1 and 40),
  flags       jsonb not null default '{}'::jsonb,
  source      text not null default 'manual' check (source in ('manual', 'file', 'epromis', 'default')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, kind, code)
);

create index if not exists erp_masters_kind_idx on erp_masters (tenant_id, kind, code);

alter table erp_masters enable row level security;
drop policy if exists "erp_masters: tenant read" on erp_masters;
create policy "erp_masters: tenant read" on erp_masters for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists contract_projects (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  ref                   text,
  name                  text not null check (char_length(name) between 1 and 200),
  account_id            uuid references accounts(id) on delete set null,
  source_opportunity_id uuid references opportunities(id) on delete set null,
  status                text not null default 'draft' check (status in ('draft', 'baseline_pending', 'active', 'closed')),
  contract_value        numeric(14,2) not null default 0 check (contract_value >= 0),
  currency              text,
  planned_start         date,
  planned_end           date,
  manager_id            uuid,
  erp_system            text,
  erp_id                text,
  custom_data           jsonb,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists contract_projects_tenant_ref_uniq on contract_projects (tenant_id, ref) where ref is not null;
create unique index if not exists contract_projects_one_per_tender on contract_projects (tenant_id, source_opportunity_id) where source_opportunity_id is not null;
create index if not exists contract_projects_status_idx on contract_projects (tenant_id, status, updated_at desc);

alter table contract_projects enable row level security;
drop policy if exists "contract_projects: tenant read" on contract_projects;
create policy "contract_projects: tenant read" on contract_projects for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists project_budget_revisions (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  project_id         uuid not null references contract_projects(id) on delete cascade,
  rev_no             int not null check (rev_no >= 0),
  status             text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'superseded')),
  justification_code text,
  justification_text text check (justification_text is null or char_length(justification_text) <= 1000),
  created_by         uuid,
  created_at         timestamptz not null default now(),
  approved_by        uuid,
  approved_at        timestamptz,
  locked_at          timestamptz,
  total              numeric(14,2) not null default 0,
  unique (project_id, rev_no)
);

create unique index if not exists project_budget_revisions_one_open on project_budget_revisions (project_id) where status in ('draft', 'pending');
create unique index if not exists project_budget_revisions_one_approved on project_budget_revisions (project_id) where status = 'approved';
create index if not exists project_budget_revisions_project_idx on project_budget_revisions (tenant_id, project_id, rev_no);

alter table project_budget_revisions enable row level security;
drop policy if exists "project_budget_revisions: tenant read" on project_budget_revisions;
create policy "project_budget_revisions: tenant read" on project_budget_revisions for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists project_budget_lines (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  revision_id   uuid not null references project_budget_revisions(id) on delete cascade,
  project_id    uuid not null references contract_projects(id) on delete cascade,
  line_no       int not null check (line_no >= 1),
  line_key      uuid not null default gen_random_uuid(),
  resource_code text,
  cost_code     text,
  wbs           text,
  description   text not null check (char_length(description) between 1 and 500),
  qty           numeric(14,3) not null default 1,
  unit          text,
  unit_cost     numeric(14,4) not null default 0,
  amount        numeric(14,2) not null default 0,
  cost_known    boolean not null default true,
  source_ref    text,
  reserve       boolean not null default false,
  committed     numeric(14,2),
  actual        numeric(14,2),
  created_at    timestamptz not null default now()
);

create index if not exists project_budget_lines_revision_idx on project_budget_lines (tenant_id, revision_id, line_no);
create index if not exists project_budget_lines_project_idx on project_budget_lines (tenant_id, project_id);

alter table project_budget_lines enable row level security;
drop policy if exists "project_budget_lines: tenant read" on project_budget_lines;
create policy "project_budget_lines: tenant read" on project_budget_lines for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
