-- 0150: ai_usage_log -- one row per model call, the shared meter for every AI
-- surface (docs/process-design-studio-architecture.md section 6.3). There was no
-- credits/metering helper in the codebase; the Process Design Studio is the first
-- surface where an unbounded loop is plausible (a chat), so it brings the meter
-- and the per-tenant monthly cap that reads it. Other AI surfaces (estimator,
-- RFQ reader, report builder) can move onto it later by passing a `surface`.
--
-- RLS: members of the tenant may READ their tenant's rows (the allowance shown
-- on the admin tenant page and in the studio). There is deliberately NO write
-- policy: usage is written by the server with the service-role client, because
-- a table that enforces a spending cap must not be writable by the people the
-- cap applies to (the WFM lesson in MULTI_TENANT_GUARDRAILS.md).
--
-- Pending-migration behaviour: the meter reads 42P01 as "no usage recorded" and
-- the writer swallows it, so AI keeps working with the cap simply not enforced.

create table if not exists ai_usage_log (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  user_id       uuid,
  surface       text not null,                 -- 'process_studio', later 'estimator', ...
  study_id      uuid,                          -- set by the Process Design Studio; no FK so the log outlives a deleted study
  model         text not null,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists ai_usage_log_tenant_month on ai_usage_log (tenant_id, created_at desc);
create index if not exists ai_usage_log_study on ai_usage_log (tenant_id, study_id) where study_id is not null;

alter table ai_usage_log enable row level security;
drop policy if exists "ai_usage_log: tenant read" on ai_usage_log;
create policy "ai_usage_log: tenant read" on ai_usage_log for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
