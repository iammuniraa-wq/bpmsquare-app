-- 0231: variations of a contract project: a client change after award, priced and approved.
-- GCC tender deals, after award (docs/design/gcc-tender-deals.md section 23). Needs 0226 (contract_projects).
--
-- contract_project_variations: one row per change the client asks for after the award. ref VAR-####, a title, what changed, the change
-- in contract value (amount, signed: an omission is negative) and the internal cost of doing it (cost_amount, signed), and the change
-- request it answers (free text: the deal's change request number or the client's own reference). Status draft, submitted, approved,
-- rejected. Submitting asks the people who approve project budgets (approval_requests, kind project_variation, the same approvers and
-- self-approval rule as a baseline); approving adds `amount` to contract_projects.contract_value and, when the project has an approved
-- baseline and no open revision, opens a budget revision for the cost (budget_revision_id says which).
--
-- RLS (MULTI_TENANT_GUARDRAILS.md, the 0199 lesson): a tenant SELECT policy and NOTHING that writes. A variation moves the contract
-- value and opens a budget revision, so a member must not be able to write one through PostgREST; every write is a service-role API
-- route that has already checked the tenant, the project and the approver list.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs, the Variations tab says a database update is needed and
-- nothing else changes (42P01 / 42703 / PGRST205 are read as "not there yet").

do $$
begin
  if to_regclass('public.contract_projects') is null then
    raise exception 'Run 0226 (bundle 36, contract projects) first, then run this again.';
  end if;
end $$;

create table if not exists contract_project_variations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  project_id         uuid not null references contract_projects(id) on delete cascade,
  ref                text,
  title              text not null check (char_length(title) between 1 and 200),
  description        text check (description is null or char_length(description) <= 2000),
  status             text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  amount             numeric(14,2) not null default 0,
  cost_amount        numeric(14,2) not null default 0,
  change_request_ref text check (change_request_ref is null or char_length(change_request_ref) <= 100),
  note               text check (note is null or char_length(note) <= 1000),
  submitted_by       uuid,
  submitted_at       timestamptz,
  decided_by         uuid,
  decided_at         timestamptz,
  budget_revision_id uuid references project_budget_revisions(id) on delete set null,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists contract_project_variations_tenant_ref_uniq on contract_project_variations (tenant_id, ref) where ref is not null;
create index if not exists contract_project_variations_project on contract_project_variations (tenant_id, project_id, created_at desc);

alter table contract_project_variations enable row level security;
drop policy if exists "contract_project_variations: tenant read" on contract_project_variations;
create policy "contract_project_variations: tenant read" on contract_project_variations for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
