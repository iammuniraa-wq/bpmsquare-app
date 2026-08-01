-- 0052_business_roles.sql
-- Business Roles: tenant-configurable, named permission sets that further
-- restrict what a "member" tenant_user can reach -- layered UNDER the
-- existing admin/member split, not replacing it. admin always bypasses this
-- entirely (unchanged superuser tier). A member with NO business role
-- assigned keeps today's full access, unchanged -- assigning one or more
-- roles is what narrows a member down to exactly the union of what those
-- roles grant. See src/lib/permissions.ts for the resolution logic this
-- schema backs; role-based write restriction on these tables themselves is
-- enforced at the API layer (role !== "admin"), same convention as every
-- other admin-managed config table in this codebase -- RLS below only
-- enforces tenant isolation.

create table business_roles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

create index business_roles_tenant_idx on business_roles (tenant_id);

alter table business_roles enable row level security;

create policy "business_roles: tenant isolation" on business_roles for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- One row per (role, workcenter) the role grants access to. A workcenter
-- with no grant row for a given role is NOT accessible to that role --
-- workcenters are opt-in per role, never opt-out.
create table business_role_grants (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  role_id      uuid not null references business_roles(id) on delete cascade,
  workcenter   text not null,
  can_view     boolean not null default true,
  can_create   boolean not null default false,
  can_edit     boolean not null default false,
  can_delete   boolean not null default false,
  -- 'territory' is only meaningful (and only ever set from the UI) for
  -- workcenters backed by an object with a territory column (accounts,
  -- contacts, quotations, cases) -- see TERRITORY_SCOPABLE_WORKCENTERS in
  -- src/lib/permissions.ts. Phase 1 stores this; actual row-level query
  -- filtering by it is Phase 2, not yet wired in.
  data_scope   text not null default 'all' check (data_scope in ('all', 'territory')),
  territories  text[] not null default '{}',
  unique (role_id, workcenter)
);

create index business_role_grants_tenant_idx on business_role_grants (tenant_id);
create index business_role_grants_role_idx on business_role_grants (role_id);

alter table business_role_grants enable row level security;

create policy "business_role_grants: tenant isolation" on business_role_grants for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- Many-to-many: a Business User (a tenant_users row, addressed here by its
-- (tenant_id, user_id) pair -- same addressing convention every existing
-- team-management route already uses, e.g. /api/settings/team/[id]) can
-- hold multiple Business Roles at once; effective access is the union of
-- all of them (see src/lib/permissions.ts).
create table business_user_roles (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role_id    uuid not null references business_roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id, role_id)
);

create index business_user_roles_tenant_user_idx on business_user_roles (tenant_id, user_id);
create index business_user_roles_role_idx on business_user_roles (role_id);

alter table business_user_roles enable row level security;

create policy "business_user_roles: tenant isolation" on business_user_roles for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
