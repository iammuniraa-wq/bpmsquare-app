-- 0105: generalise how a project collects hours.
--
-- 0104 could only link a project to SITES. Owner decision 2026-09-04: a
-- project is a standalone record, and you attach it to whatever fits --
-- sites, specific people, or a shift -- in any combination, or to nothing
-- at all. See WFM_PROJECT_COSTING.md §4.
--
-- Three nullable foreign keys with a "exactly one" check, rather than a
-- polymorphic (type, target_id) pair. It is barely more schema and buys
-- real referential integrity: deleting a site, an employee or a shift
-- removes its links automatically instead of leaving rows pointing at
-- nothing for the resolver to trip over.
--
-- Dates are deliberately NOT on the link. The project's own start_date /
-- end_date bound which punches count, and every punch is stamped at the
-- moment it happens (0104), so a link can never retroactively re-attribute
-- history. That is what makes it safe for this table to be this simple.

create table if not exists wfm_project_links (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  project_id  uuid not null references wfm_projects(id) on delete cascade,
  site_id     uuid references wfm_sites(id) on delete cascade,
  employee_id uuid references employees(id) on delete cascade,
  shift_id    uuid references wfm_shifts(id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint wfm_project_links_one_target
    check (num_nonnulls(site_id, employee_id, shift_id) = 1)
);

-- The resolver asks "which projects does this site / person / shift feed?",
-- so each target gets its own lookup index.
create index if not exists wfm_project_links_site_idx
  on wfm_project_links (tenant_id, site_id) where site_id is not null;
create index if not exists wfm_project_links_employee_idx
  on wfm_project_links (tenant_id, employee_id) where employee_id is not null;
create index if not exists wfm_project_links_shift_idx
  on wfm_project_links (tenant_id, shift_id) where shift_id is not null;
create index if not exists wfm_project_links_project_idx
  on wfm_project_links (tenant_id, project_id);

-- Linking the same target to the same project twice is meaningless, and a
-- duplicate would make an unambiguous link look ambiguous to the resolver.
create unique index if not exists wfm_project_links_site_uniq
  on wfm_project_links (tenant_id, project_id, site_id) where site_id is not null;
create unique index if not exists wfm_project_links_employee_uniq
  on wfm_project_links (tenant_id, project_id, employee_id) where employee_id is not null;
create unique index if not exists wfm_project_links_shift_uniq
  on wfm_project_links (tenant_id, project_id, shift_id) where shift_id is not null;

alter table wfm_project_links enable row level security;
-- WFM convention (0062): tenant-scoped SELECT only, no write policy. Every
-- write goes through the service-role client behind an app-level admin
-- check, because a forged link silently redirects where hours are billed.
create policy "wfm_project_links: tenant read" on wfm_project_links for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- Carry across everything 0104's site-only table already holds, so the
-- projects the owner set up on 04-Sep keep their sites.
insert into wfm_project_links (tenant_id, project_id, site_id, created_at)
select ps.tenant_id, ps.project_id, ps.site_id, ps.created_at
from wfm_project_sites ps
on conflict do nothing;

drop table if exists wfm_project_sites;
