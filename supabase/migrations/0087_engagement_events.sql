-- Engagement layer: Silence Detector "Saves" (owner go-ahead 2026-08-18).
-- One row per engagement action a user takes -- today only 'silence_save'
-- (reached out to an account that had gone past its ordering rhythm).
-- Deliberately an EVENT LOG, not a business object: no custom_data, no
-- Data Workbench / v1 API / MCP surface (bpmsquarecore.md 3b points noted
-- as not-applicable in the commit). Standard tenant-isolation RLS is the
-- right convention here (user-generated engagement data, not attendance or
-- pay -- the stricter WFM select-only rule does not apply).

create table if not exists engagement_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null,
  account_id uuid not null references accounts(id) on delete cascade,
  kind text not null check (kind in ('silence_save')),
  created_at timestamptz not null default now()
);

create index if not exists engagement_events_tenant_kind_idx
  on engagement_events (tenant_id, kind, created_at desc);

alter table engagement_events enable row level security;

drop policy if exists "engagement_events: tenant isolation" on engagement_events;
create policy "engagement_events: tenant isolation" on engagement_events for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
