-- 0103: AI Report Builder ("talk to data") — saved reports.
--
-- A saved report stores the COMPILED query (the same validated wire-query
-- params a /api/v1 list call uses), never model output as truth: re-opening
-- a report re-runs the query against live data and never re-calls the model.
-- Access is re-checked against the VIEWER's own Business-Role permissions on
-- every open (the API route does this), not the creator's at save time --
-- the row itself carries no data, only the recipe.
--
-- RLS: standard tenant isolation. App reads/writes go through the service
-- role with explicit tenant filters (MULTI_TENANT_GUARDRAILS.md); this
-- policy is the PostgREST backstop.

create table if not exists ai_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  created_by uuid not null,
  question text not null,
  object text not null,
  chart_type text not null check (chart_type in ('stat', 'bar', 'line', 'table')),
  -- The URLSearchParams-encoded wire query string (e.g.
  -- "filter=status:eq:draft&group_by=status&group_limit=12") -- the SAME
  -- format parseListQuery()/applyListQuery() already consume, not a
  -- separately-shaped JSON blob. Plain text, not jsonb: it's already a
  -- string on both the write side (src/app/api/reports/route.ts) and the
  -- read side (src/app/api/reports/[id]/route.ts's `new URLSearchParams(...)`).
  compiled_query text not null,
  title text not null,
  interpretation text not null,
  pinned_to_dashboard boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ai_reports_tenant_idx on ai_reports (tenant_id, created_at desc);

alter table ai_reports enable row level security;

create policy "ai_reports: tenant isolation" on ai_reports for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
