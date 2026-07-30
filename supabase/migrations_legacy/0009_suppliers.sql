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
