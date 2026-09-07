-- 0122: Fence projects -- Fence Configurator Phase C
-- (docs/fence-configurator-architecture.md §7). A fence project is one
-- configured run (layout, length, gates, chosen security profile,
-- fabric/coating); it becomes a Standard Quote once priced (Phase D).
--
-- Security profiles are tenant-authored, not a fixed 3-tier enum (owner
-- decision #2, 2026-09-07) -- every field is renameable/deletable in
-- Settings, the same way opportunity_stages or product_categories are
-- tenant config, not a shipped taxonomy.
--
-- §3b: tenant_id + RLS + isolation policy in this file, custom_data from
-- day one on the user-facing object, ref (FNC-####) via masterRef.
-- Standard tenant-isolation policy ("for all"): a CRM-shaped object edited
-- by its users directly, not attendance/pricing-restricted like WFM.
--
-- §3 record identity: fence_gates is a child object family -- its own id
-- is what Update/Delete key on once a gate exists; fence_project_id only
-- resolves the relationship at create time.

create table if not exists fence_security_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  label text not null,
  blurb text,
  post_spacing_m numeric(5,2) not null,
  embedment_m numeric(5,2) not null,
  pipe_class text not null,
  sort_order int not null default 0,
  custom_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fence_security_profiles_tenant on fence_security_profiles (tenant_id, sort_order);

alter table fence_security_profiles enable row level security;
create policy "fence_security_profiles: tenant isolation" on fence_security_profiles for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists fence_projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  ref text,
  account_id uuid references accounts(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  name text not null,
  layout text not null default 'closed_perimeter' check (layout in ('open_run', 'closed_perimeter')),
  total_length_m numeric(8,2) not null,
  security_profile_id uuid references fence_security_profiles(id) on delete set null,
  fabric_height_m numeric(4,2) not null default 2,
  mesh_spec text,
  coating text,
  status text not null default 'draft' check (status in ('draft', 'quoted', 'won', 'lost')),
  standard_quote_id uuid references standard_quotes(id) on delete set null,
  custom_data jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fence_projects_tenant_status on fence_projects (tenant_id, status);
create index if not exists fence_projects_tenant_account on fence_projects (tenant_id, account_id);
create unique index if not exists fence_projects_tenant_ref_key on fence_projects (tenant_id, ref) where ref is not null;

alter table fence_projects enable row level security;
create policy "fence_projects: tenant isolation" on fence_projects for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists fence_gates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  fence_project_id uuid not null references fence_projects(id) on delete cascade,
  gate_type text not null check (gate_type in ('single_swing', 'double_swing', 'sliding')),
  width_m numeric(5,2) not null,
  position_m numeric(8,2),
  created_at timestamptz not null default now()
);

create index if not exists fence_gates_tenant_project on fence_gates (tenant_id, fence_project_id);

alter table fence_gates enable row level security;
create policy "fence_gates: tenant isolation" on fence_gates for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
