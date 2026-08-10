-- Saved queries: a user's named advanced-filter sets, per object list page.
-- Personal, not shared: RLS scopes rows to (own tenant AND own user), so one
-- member never sees another member's saved views -- same isolation posture as
-- tenant_users.dashboard_layout_override, just in its own table because a
-- user can save many queries per object.

create table if not exists saved_queries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null,
  object_key text not null,
  name text not null,
  conditions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists saved_queries_lookup_idx
  on saved_queries (tenant_id, user_id, object_key);

alter table saved_queries enable row level security;

create policy "saved_queries: owner isolation" on saved_queries for all
  using (
    user_id = auth.uid()
    and tenant_id in (select tenant_id from tenant_users where user_id = auth.uid())
  )
  with check (
    user_id = auth.uid()
    and tenant_id in (select tenant_id from tenant_users where user_id = auth.uid())
  );
