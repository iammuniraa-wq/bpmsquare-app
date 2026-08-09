-- 0064_status_schema_engine.sql
-- Batch 0 of the status-schema engine rollout (see BPMSquare_StatusSchema_
-- Requirements.md and the approved plan). Purely additive: six new tables,
-- no existing table or column touched, nothing reads or writes these yet.
--
-- Two-layer model: `system_status` is a small, fixed, platform-seeded spine
-- per entity_type (stable across every tenant, so reporting can roll up on
-- it even when tenants use wildly different custom labels). `custom_status`
-- is the tenant-configurable layer a status_profile owns; every custom
-- status maps onto exactly one system_status. `status_transition_rule`
-- governs which custom-status moves are legal (strict: no matching rule ==
-- rejected, no soft-validate fallback) and optionally role-gates or
-- comment-gates them. `status_history` is the append-only audit trail of
-- every transition, structured (not a generic change_log diff) so it can
-- record the system-status-before/after alongside the custom-status move.
--
-- entity_type covers every object this whole rollout will ever need,
-- seeded once now (quote-lines-of-code cheaper than a follow-up migration
-- later, and custom_status FKs to system_status.code permanently so gaps
-- become broken FKs down the line, not just missing rows):
--   quotes, cases, work_orders, invoices, purchase_orders, inventory,
--   suppliers, standard_quotes, technicians  (the 9 existing objects)
--   attendance, leave_request                (new WFM entities, batch 5)
--
-- Existing objects' own `status` text columns are NOT touched by this
-- migration -- per the plan, each object keeps its column as the read
-- surface (dozens of call sites stay untouched) and gains a
-- `custom_status_id` FK + sync trigger only when THAT object's batch ships.

create table system_status (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in (
    'quotes', 'cases', 'work_orders', 'invoices', 'purchase_orders',
    'inventory', 'suppliers', 'standard_quotes', 'technicians',
    'attendance', 'leave_request'
  )),
  code        text not null,
  label       text not null,
  sort_order  int not null default 0,
  is_terminal boolean not null default false,
  unique (entity_type, code)
);

-- Global seed data, not tenant-scoped -- the one table in this schema with
-- no tenant_id, since a system status is a platform-fixed concept every
-- tenant's custom statuses map onto. RLS: readable by anyone authenticated
-- (every tenant needs to read the spine for their own entity types), no
-- insert/update/delete policy at all -- RLS default-denies any operation
-- with no matching policy, so writes only ever happen via a migration
-- through the service-role client (which bypasses RLS entirely), same as
-- every other seed-only table in this codebase.
alter table system_status enable row level security;
create policy "system_status: read all" on system_status for select using (true);

create table status_profile (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  entity_type     text not null check (entity_type in (
    'quotes', 'cases', 'work_orders', 'invoices', 'purchase_orders',
    'inventory', 'suppliers', 'standard_quotes', 'technicians',
    'attendance', 'leave_request'
  )),
  entity_category text,
  name            text not null,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index status_profile_tenant_entity_idx on status_profile (tenant_id, entity_type);

-- One default profile per (tenant, entity_type, category) -- coalesce so a
-- null category (the common case: no sub-scoping) still enforces
-- uniqueness instead of allowing multiple nulls to slip past a plain
-- unique index (postgres treats NULL <> NULL for uniqueness purposes).
create unique index status_profile_one_default_idx
  on status_profile (tenant_id, entity_type, coalesce(entity_category, ''))
  where is_default;

alter table status_profile enable row level security;
create policy "status_profile: tenant isolation" on status_profile for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table custom_status (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  status_profile_id  uuid not null references status_profile(id) on delete cascade,
  -- Denormalized from status_profile.entity_type -- required for the
  -- composite FK below (system_status_code alone isn't unique, only
  -- (entity_type, code) is) and kept consistent with its profile at the
  -- application layer, same as this codebase's other config-shape
  -- invariants (e.g. quote status is_initial/is_closed validated in the
  -- settings route, not a DB trigger).
  entity_type        text not null check (entity_type in (
    'quotes', 'cases', 'work_orders', 'invoices', 'purchase_orders',
    'inventory', 'suppliers', 'standard_quotes', 'technicians',
    'attendance', 'leave_request'
  )),
  system_status_code text not null,
  code               text not null,
  label              text not null,
  is_initial         boolean not null default false,
  is_visible         boolean not null default true,
  responsible_party  text not null default 'none' check (responsible_party in ('provider', 'customer', 'internal', 'none')),
  sort_order         int not null default 0,
  color_hex          text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (status_profile_id, code),
  foreign key (entity_type, system_status_code) references system_status (entity_type, code)
);

create index custom_status_profile_idx on custom_status (status_profile_id);
create index custom_status_tenant_idx on custom_status (tenant_id);

alter table custom_status enable row level security;
create policy "custom_status: tenant isolation" on custom_status for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table status_transition_rule (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  status_profile_id     uuid not null references status_profile(id) on delete cascade,
  -- null = "from any status" (including the entity's initial/unset state).
  from_custom_status_id uuid references custom_status(id) on delete cascade,
  to_custom_status_id   uuid not null references custom_status(id) on delete cascade,
  requires_comment      boolean not null default false,
  -- Hook name dispatched via src/lib/statusHooks/registry.ts after a
  -- successful transition -- null means no side effect beyond the
  -- status_history row.
  triggers_action       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index status_transition_rule_lookup_idx
  on status_transition_rule (status_profile_id, to_custom_status_id, from_custom_status_id);

alter table status_transition_rule enable row level security;
create policy "status_transition_rule: tenant isolation" on status_transition_rule for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- allowed_roles as a join table, not a uuid[] column -- every existing RBAC
-- table in this codebase (business_role_grants, business_user_roles) is a
-- join table, and a uuid[] can't cascade-delete cleanly when a business
-- role is removed. Zero rows for a rule == unrestricted (any tenant member
-- who can otherwise edit the object may execute it) -- mirrors
-- resolvePermissions()'s existing "no Business Role assigned == unrestricted"
-- default in src/lib/permissions.ts, so this doesn't introduce a second,
-- inconsistent access-control philosophy. The `admin` tenant_users role
-- always bypasses this check entirely, same as everywhere else.
create table status_transition_rule_roles (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  rule_id    uuid not null references status_transition_rule(id) on delete cascade,
  role_id    uuid not null references business_roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (rule_id, role_id)
);

create index status_transition_rule_roles_rule_idx on status_transition_rule_roles (rule_id);

alter table status_transition_rule_roles enable row level security;
create policy "status_transition_rule_roles: tenant isolation" on status_transition_rule_roles for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- Append-only structured audit trail -- distinct from the generic
-- change_log (0050), which records every object's create/update/delete as
-- plain before/after diffs. status_history is purpose-built for a status
-- transition specifically: it captures the system-status code before/after
-- alongside the custom-status ids, and a `source` so "changed via the API"
-- is distinguishable from an in-app change. entity_id is deliberately NOT
-- foreign-keyed -- it's polymorphic across every entity_type's own table,
-- same as change_log.object_id.
create table status_history (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references tenants(id) on delete cascade,
  entity_type                 text not null check (entity_type in (
    'quotes', 'cases', 'work_orders', 'invoices', 'purchase_orders',
    'inventory', 'suppliers', 'standard_quotes', 'technicians',
    'attendance', 'leave_request'
  )),
  entity_id                   uuid not null,
  from_custom_status_id       uuid references custom_status(id) on delete set null,
  to_custom_status_id         uuid not null references custom_status(id) on delete cascade,
  system_status_code_before   text,
  system_status_code_after    text not null,
  changed_by_user_id          uuid references auth.users(id) on delete set null,
  changed_at                  timestamptz not null default now(),
  comment                     text,
  source                      text not null check (source in ('manual', 'system_action', 'api', 'integration'))
);

create index status_history_entity_idx on status_history (tenant_id, entity_type, entity_id, changed_at desc);

alter table status_history enable row level security;
create policy "status_history: tenant read" on status_history for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
create policy "status_history: tenant insert" on status_history for insert
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
-- No update/delete policy -- RLS default-denies both, same append-only
-- shape as change_log (0050_change_log.sql).

-- ── Seed system_status ──────────────────────────────────────────────────
-- Two shapes: a shared 4-value OPEN/IN_PROGRESS/COMPLETED/CANCELLED spine
-- for the six workflow-shaped objects (matches the requirements doc's
-- Case/Quote system-status pattern), and bespoke small spines for the
-- state/binary-shaped objects (active/inactive toggles, technician
-- availability, WFM check-in/leave) where a workflow spine doesn't fit.

insert into system_status (entity_type, code, label, sort_order, is_terminal) values
  -- Shared workflow spine
  ('quotes',           'OPEN',        'Open',        0, false),
  ('quotes',           'IN_PROGRESS', 'In Progress', 1, false),
  ('quotes',           'COMPLETED',   'Completed',   2, true),
  ('quotes',           'CANCELLED',   'Cancelled',   3, true),

  ('cases',            'OPEN',        'Open',        0, false),
  ('cases',            'IN_PROGRESS', 'In Progress', 1, false),
  ('cases',            'COMPLETED',   'Completed',   2, true),
  ('cases',            'CANCELLED',   'Cancelled',   3, true),

  ('work_orders',      'OPEN',        'Open',        0, false),
  ('work_orders',      'IN_PROGRESS', 'In Progress', 1, false),
  ('work_orders',      'COMPLETED',   'Completed',   2, true),
  ('work_orders',      'CANCELLED',   'Cancelled',   3, true),

  ('invoices',         'OPEN',        'Open',        0, false),
  ('invoices',         'IN_PROGRESS', 'In Progress', 1, false),
  ('invoices',         'COMPLETED',   'Completed',   2, true),
  ('invoices',         'CANCELLED',   'Cancelled',   3, true),

  ('purchase_orders',  'OPEN',        'Open',        0, false),
  ('purchase_orders',  'IN_PROGRESS', 'In Progress', 1, false),
  ('purchase_orders',  'COMPLETED',   'Completed',   2, true),
  ('purchase_orders',  'CANCELLED',   'Cancelled',   3, true),

  ('standard_quotes',  'OPEN',        'Open',        0, false),
  ('standard_quotes',  'IN_PROGRESS', 'In Progress', 1, false),
  ('standard_quotes',  'COMPLETED',   'Completed',   2, true),
  ('standard_quotes',  'CANCELLED',   'Cancelled',   3, true),

  -- Binary active/inactive objects
  ('inventory',        'ACTIVE',      'Active',      0, false),
  ('inventory',        'INACTIVE',    'Inactive',    1, false),

  ('suppliers',        'ACTIVE',      'Active',      0, false),
  ('suppliers',        'INACTIVE',    'Inactive',    1, false),

  -- Technician availability
  ('technicians',      'ACTIVE',      'Active',      0, false),
  ('technicians',      'ON_LEAVE',    'On Leave',    1, false),
  ('technicians',      'INACTIVE',    'Inactive',    2, false),

  -- WFM Attendance (check-in/out, FLAGGED = anomaly review, non-terminal --
  -- resolves back to CHECKED_OUT or escalates, per the requirements doc)
  ('attendance',       'CHECKED_IN',  'Checked In',  0, false),
  ('attendance',       'CHECKED_OUT', 'Checked Out', 1, true),
  ('attendance',       'FLAGGED',     'Flagged',     2, false),

  -- WFM Leave Request
  ('leave_request',    'SUBMITTED',   'Submitted',   0, false),
  ('leave_request',    'IN_APPROVAL', 'In Approval', 1, false),
  ('leave_request',    'APPROVED',    'Approved',    2, true),
  ('leave_request',    'REJECTED',    'Rejected',    3, true),
  ('leave_request',    'WITHDRAWN',   'Withdrawn',   4, true);
