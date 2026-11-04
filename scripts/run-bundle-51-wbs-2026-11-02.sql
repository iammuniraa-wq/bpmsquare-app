-- run-bundle-51-wbs-2026-11-02.sql
-- Paste into the Supabase SQL editor of each database (dev, then production, then KAMCO). Safe to run twice. No seed.
-- Run AFTER 0240 (bundle 48) and 0242 (bundle 50); it also needs 0223 (bundle 33) and 0226 (bundle 36). The workforce bundle 51b (= 0244) is a separate file.
-- = migration 0243: the WBS (work breakdown structure) on tenders and contract projects (docs/design/wbs.md).
--   tender_wbs_items                       the tree of a tender deal: code, name, parent (three levels), optional owner (RLS: tenant SELECT only).
--   tender_boq_lines.wbs_item_id           the default: a BOQ line sits in one item.
--   tender_wbs_line_parts                  the option: a BOQ line split across items by percent (RLS: tenant SELECT only).
--   project_work_packages                  + parent_id, source_wbs_item_id, code_is_manual: the project's own copy of the tree.
--   project_work_package_line_parts         the same split on the project, by the budget line's line_key (RLS: tenant SELECT only).
-- The app works before and after: until it runs the Bill of quantities has no WBS view, a project is created without a WBS and says so, and
--   the project's work breakdown stays a flat list; nothing crashes. Wrapped in one transaction: it applies completely or not at all.

begin;

-- 0243: the WBS (work breakdown structure) on tenders and contract projects (docs/design/wbs.md, owner decisions 2026-11-02).
-- Needs 0223 (tender_boq_lines), 0226 (contract_projects) and 0240 (project_work_packages and project_work_package_lines).
--
-- Tender side
--   tender_wbs_items        the tree of a tender deal: a code, a name, an optional parent (three levels), an optional owner (an employee).
--   tender_boq_lines.wbs_item_id   the default: a BOQ line sits in ONE item. NULL for an unassigned line and for a split line.
--   tender_wbs_line_parts   the option: a BOQ line split across several items by percent. A line is in wbs_item_id OR here, never both
--                           (the routes keep that); quantities and amounts are derived (quantity x share), never stored.
-- Project side (the project owns its own copy of the tree after award)
--   project_work_packages   gains parent_id (the tree), source_wbs_item_id (the tender item it was copied from) and code_is_manual.
--   project_work_package_line_parts   the same split, by the budget line's stable line_key.
--
-- RLS (MULTI_TENANT_GUARDRAILS.md, the tender / contract convention of 0220-0242): each new table carries a tenant SELECT policy and NOTHING
-- that writes. The grouping decides where money is allocated, so a member must not be able to rewrite it through PostgREST. Every write is a
-- service-role API route that has already checked the tenant, the deal or project, and the caller's access. The 100 % sum rule lives in
-- those routes, not in the database.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs the app works as before (the Bill of quantities has no WBS view,
-- a project is created without a WBS and says so, the project's work breakdown stays a flat list); 42P01 / 42703 / PGRST205 are read as
-- "not there yet".

do $$
begin
  if to_regclass('public.tender_boq_lines') is null then
    raise exception 'Run 0223 (the tender BOQ, bundle 33) first, then run this again.';
  end if;
  if to_regclass('public.project_work_packages') is null or to_regclass('public.project_work_package_lines') is null then
    raise exception 'Run 0240 (project allocation and work packages, bundle 48) first, then run this again.';
  end if;
end $$;

-- ── Tender: the items ───────────────────────────────────────────────────────────────────────────────────────────────

create table if not exists tender_wbs_items (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  opportunity_id     uuid not null references opportunities(id) on delete cascade,
  parent_id          uuid references tender_wbs_items(id) on delete cascade,
  code               text not null check (char_length(code) between 1 and 20),
  name               text not null check (char_length(name) between 1 and 200),
  owner_employee_id  uuid references employees(id) on delete set null,
  sort_order         int not null default 0,
  code_is_manual     boolean not null default false,
  note               text check (note is null or char_length(note) <= 1000),
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (opportunity_id, code)
);
create index if not exists tender_wbs_items_deal_idx on tender_wbs_items (tenant_id, opportunity_id, parent_id, sort_order);
alter table tender_wbs_items enable row level security;
drop policy if exists "tender_wbs_items: tenant read" on tender_wbs_items;
create policy "tender_wbs_items: tenant read" on tender_wbs_items for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- The default: one line sits in one item. A split line has this NULL and rows in tender_wbs_line_parts instead.
-- Removing an item sets its whole lines back to unassigned.
alter table tender_boq_lines add column if not exists wbs_item_id uuid references tender_wbs_items(id) on delete set null;
create index if not exists tender_boq_lines_wbs_idx on tender_boq_lines (tenant_id, opportunity_id, wbs_item_id) where wbs_item_id is not null;

-- ── Tender: the split ───────────────────────────────────────────────────────────────────────────────────────────────

create table if not exists tender_wbs_line_parts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  opportunity_id  uuid not null references opportunities(id) on delete cascade,
  boq_line_id     uuid not null references tender_boq_lines(id) on delete cascade,
  wbs_item_id     uuid not null references tender_wbs_items(id) on delete cascade,
  share_pct       numeric(7,4) not null check (share_pct > 0 and share_pct <= 100),
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  unique (boq_line_id, wbs_item_id)
);
create index if not exists tender_wbs_line_parts_line_idx on tender_wbs_line_parts (tenant_id, opportunity_id, boq_line_id);
create index if not exists tender_wbs_line_parts_item_idx on tender_wbs_line_parts (tenant_id, wbs_item_id);
alter table tender_wbs_line_parts enable row level security;
drop policy if exists "tender_wbs_line_parts: tenant read" on tender_wbs_line_parts;
create policy "tender_wbs_line_parts: tenant read" on tender_wbs_line_parts for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ── Project: the tree and the split ─────────────────────────────────────────────────────────────────────────────────

alter table project_work_packages add column if not exists parent_id uuid references project_work_packages(id) on delete cascade;
alter table project_work_packages add column if not exists source_wbs_item_id uuid;
alter table project_work_packages add column if not exists code_is_manual boolean not null default false;
create index if not exists project_work_packages_parent_idx on project_work_packages (tenant_id, project_id, parent_id, sort_order);

create table if not exists project_work_package_line_parts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  project_id  uuid not null references contract_projects(id) on delete cascade,
  package_id  uuid not null references project_work_packages(id) on delete cascade,
  line_key    uuid not null,
  share_pct   numeric(7,4) not null check (share_pct > 0 and share_pct <= 100),
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  unique (project_id, line_key, package_id)
);
create index if not exists project_work_package_line_parts_idx on project_work_package_line_parts (tenant_id, project_id, line_key);
alter table project_work_package_line_parts enable row level security;
drop policy if exists "project_work_package_line_parts: tenant read" on project_work_package_line_parts;
create policy "project_work_package_line_parts: tenant read" on project_work_package_line_parts for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

commit;
