-- page_layouts (src/app/api/layouts/[object]/route.ts) has been a live, in-use
-- table with no tracked migration anywhere in this repo -- flagged as known
-- debt in MULTI_TENANT_GUARDRAILS.md since its RLS status couldn't be
-- verified from source. The route reads/writes it via the SESSION client
-- (not the admin client), so RLS is the actual backstop here, not just
-- defense-in-depth -- if it was ever missing, any authenticated user could
-- read/write any tenant's saved layout by calling the Supabase REST API
-- directly with a different tenant_id (bypassing the app's own
-- .eq("tenant_id", tenantId) filter, which only constrains requests that go
-- through this app's own route).
--
-- `create table if not exists` is a no-op if the table already exists from
-- being created ad-hoc via the dashboard; enabling RLS and (re)creating the
-- policy below is what actually matters and is safe to run either way.
create table if not exists page_layouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  object_type text not null,
  layout jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (tenant_id, object_type)
);

alter table page_layouts enable row level security;

drop policy if exists "page_layouts: tenant isolation" on page_layouts;
create policy "page_layouts: tenant isolation" on page_layouts for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
