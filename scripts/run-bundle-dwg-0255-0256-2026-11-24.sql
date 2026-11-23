-- Bundle: the Drawing register and its elements (docs/design/pcbs-drawing-register.md, slices 1-2), written 2026-11-24.
-- Run on the dev database, then each production database (the PCBS own database included). Safe to run twice. No seed.
-- Contains, verbatim and in order: 0255_drawing_register.sql, 0256_drawing_elements.sql.
-- Needs 0226 (contract projects, bundle 36) and 0243 (the WBS, bundle 51 / 51b). Nothing changes for a workspace until the platform admin
-- switches the flag "drawing_register" on for it: the new tables are not read while the flag is off. Wrapped in one transaction.

begin;

-- 0255: the Drawing register (docs/design/pcbs-drawing-register.md, slice 1). Generic; the first user is PCBS (precast).
-- Needs 0226 (contract_projects), 0243 (tender_wbs_items, so a drawing can name its building) and opportunities.
--
--   drawing_types       what a workspace calls its kinds of drawing and how each is controlled: numbering pattern, revision scheme,
--                       the people who may release, whether the submitter may release their own, required fields, what it feeds.
--                       A type is data a workspace edits, never a code branch (bpmsquarecore.md 3c rule 11).
--   drawings            the header: ONE record per drawing number, for life. current_rev_id points at the released revision.
--   drawing_revisions   append-only: one row per revision (A, B, C ...), with its file and its status
--                       draft -> in_review -> released -> superseded. A revision that left draft is frozen (trigger, below).
--   release_drawing_revision()   the ONE atomic way to release: supersedes the old released revision and releases the new one in a
--                       single transaction (supabase-js has no transaction), executable by the service role only.
--   bucket drawing-files   private, 50 MB, NO storage policy for members (deny by default, the 0222 pattern): bytes move only
--                       through signed links the routes issue after a tenant check.
--
-- RLS (MULTI_TENANT_GUARDRAILS.md, the tender / contract convention of 0220-0243 and the 0078 lesson): every table carries a tenant
-- SELECT policy and NOTHING that writes. Releasing a drawing is an authority, so a member must not be able to set status = 'released'
-- through PostgREST with their own session. Every write is a service-role API route that has already checked the tenant, the caller and
-- the release rule. src/lib/rlsPolicies.test.ts replays this file and fails the build if a member write policy appears.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs the app works as before (the module is hidden behind its flag
-- anyway, and 42P01 / 42703 / PGRST205 read as "database update needed", never a crash).

do $$
begin
  if to_regclass('public.contract_projects') is null then
    raise exception 'Run 0226 (contract projects, bundle 36) first, then run this again.';
  end if;
  if to_regclass('public.tender_wbs_items') is null then
    raise exception 'Run 0243 (the WBS, bundle 51) first, then run this again.';
  end if;
end $$;

-- ── Types ───────────────────────────────────────────────────────────────────────────────────────────────────────────

create table if not exists drawing_types (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  name               text not null check (char_length(name) between 1 and 80),
  numbering_pattern  text check (numbering_pattern is null or char_length(numbering_pattern) <= 120),
  rev_scheme         text not null default 'letters' check (rev_scheme in ('letters', 'numbers')),
  approver_ids       uuid[] not null default '{}',
  second_person      boolean not null default true,
  required_fields    text[] not null default '{}',
  feeds              text[] not null default '{}',
  -- Which column of an element schedule is which field, saved once per type (slice 2); null = suggest from the headers.
  schedule_map       jsonb,
  active             boolean not null default true,
  sort_order         int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists drawing_types_tenant_name_uniq on drawing_types (tenant_id, lower(name));
alter table drawing_types enable row level security;
drop policy if exists "drawing_types: tenant read" on drawing_types;
create policy "drawing_types: tenant read" on drawing_types for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ── The drawing (header) ────────────────────────────────────────────────────────────────────────────────────────────

create table if not exists drawings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  ref             text,
  drawing_no      text not null check (char_length(drawing_no) between 1 and 80),
  external_no     text check (external_no is null or char_length(external_no) <= 80),
  title           text not null check (char_length(title) between 1 and 200),
  type_id         uuid references drawing_types(id) on delete set null,
  opportunity_id  uuid references opportunities(id) on delete set null,
  project_id      uuid references contract_projects(id) on delete set null,
  wbs_item_id     uuid references tender_wbs_items(id) on delete set null,
  current_rev_id  uuid,
  custom_data     jsonb not null default '{}'::jsonb,
  archived_at     timestamptz,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists drawings_tenant_ref_uniq on drawings (tenant_id, ref) where ref is not null;
-- The number F&O receives: unique per workspace, case-insensitive.
create unique index if not exists drawings_tenant_no_uniq on drawings (tenant_id, lower(drawing_no));
create index if not exists drawings_tenant_idx on drawings (tenant_id, archived_at, created_at desc);
create index if not exists drawings_opportunity_idx on drawings (tenant_id, opportunity_id) where opportunity_id is not null;
create index if not exists drawings_project_idx on drawings (tenant_id, project_id) where project_id is not null;
alter table drawings enable row level security;
drop policy if exists "drawings: tenant read" on drawings;
create policy "drawings: tenant read" on drawings for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- ── The revisions (append-only) ─────────────────────────────────────────────────────────────────────────────────────

create table if not exists drawing_revisions (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  drawing_id         uuid not null references drawings(id) on delete cascade,
  rev_no             int not null check (rev_no >= 0),
  rev_label          text not null check (char_length(rev_label) between 1 and 12),
  status             text not null default 'draft' check (status in ('draft', 'in_review', 'released', 'superseded')),
  file_path          text,
  file_name          text,
  file_type          text,
  file_size          bigint check (file_size is null or file_size >= 0),
  file_sha256        text check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'),
  source             text not null default 'upload' check (source in ('upload', 'email', 'ifc', 'schedule', 'acc', 'import')),
  source_ref         text check (source_ref is null or char_length(source_ref) <= 200),
  notes              text check (notes is null or char_length(notes) <= 2000),
  return_reason      text check (return_reason is null or char_length(return_reason) <= 1000),
  submitted_by       uuid,
  submitted_at       timestamptz,
  released_by        uuid,
  released_at        timestamptz,
  effective_from     date,
  supersedes_rev_id  uuid references drawing_revisions(id) on delete set null,
  change_summary     jsonb not null default '{}'::jsonb,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  unique (drawing_id, rev_no)
);
create unique index if not exists drawing_revisions_label_uniq on drawing_revisions (drawing_id, lower(rev_label));
-- The same model version or file must never arrive twice.
create unique index if not exists drawing_revisions_source_uniq on drawing_revisions (drawing_id, source_ref) where source_ref is not null;
-- At most ONE released and ONE open revision per drawing, so two people cannot both be "the current one"
-- (the project_budget_revisions shape of 0226).
create unique index if not exists drawing_revisions_one_released on drawing_revisions (drawing_id) where status = 'released';
create unique index if not exists drawing_revisions_one_open on drawing_revisions (drawing_id) where status in ('draft', 'in_review');
create index if not exists drawing_revisions_drawing_idx on drawing_revisions (tenant_id, drawing_id, rev_no);
create index if not exists drawing_revisions_waiting_idx on drawing_revisions (tenant_id, status) where status = 'in_review';
alter table drawing_revisions enable row level security;
drop policy if exists "drawing_revisions: tenant read" on drawing_revisions;
create policy "drawing_revisions: tenant read" on drawing_revisions for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- current_rev_id points at a revision of the same drawing; added after the revisions table exists.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'drawings_current_rev_fk') then
    alter table drawings add constraint drawings_current_rev_fk foreign key (current_rev_id) references drawing_revisions(id) on delete set null;
  end if;
end $$;

-- ── Immutability ────────────────────────────────────────────────────────────────────────────────────────────────────
-- A revision that left draft is a record: its file, label, number and source never change, and it is never deleted, EVEN from the
-- service role (a trigger fires for every role). Only the status moves, along the allowed edges, and the release stamps are set once.
-- pg_trigger_depth() > 1 lets the cascade of a tenant's own deletion through (a row removed by a foreign-key action runs this trigger
-- one level deeper than a statement a person typed); the app's routes refuse to delete a drawing that has a released revision.

create or replace function drawing_revisions_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and pg_trigger_depth() <= 1 then
      raise exception 'A drawing revision that left draft cannot be deleted';
    end if;
    return old;
  end if;
  if new.tenant_id is distinct from old.tenant_id or new.drawing_id is distinct from old.drawing_id or new.rev_no is distinct from old.rev_no then
    raise exception 'A drawing revision cannot change its drawing, tenant or number';
  end if;
  if old.status = 'superseded' then
    raise exception 'A superseded drawing revision is final';
  end if;
  if old.status <> 'draft' then
    if new.rev_label is distinct from old.rev_label or new.file_path is distinct from old.file_path
       or new.file_name is distinct from old.file_name or new.file_type is distinct from old.file_type
       or new.file_size is distinct from old.file_size or new.file_sha256 is distinct from old.file_sha256
       or new.source is distinct from old.source or new.source_ref is distinct from old.source_ref then
      raise exception 'The file and the label of a drawing revision are fixed once it was submitted';
    end if;
  end if;
  if old.status = 'draft' and new.status not in ('draft', 'in_review') then
    raise exception 'A draft drawing revision can only be submitted';
  end if;
  if old.status = 'in_review' and new.status not in ('in_review', 'draft', 'released') then
    raise exception 'A drawing revision in review is released or returned to draft';
  end if;
  if old.status = 'released' and new.status not in ('released', 'superseded') then
    raise exception 'A released drawing revision is never un-released: issue a new revision';
  end if;
  if old.status = 'released' and (new.released_by is distinct from old.released_by or new.released_at is distinct from old.released_at
                                  or new.effective_from is distinct from old.effective_from) then
    raise exception 'The release stamps of a drawing revision are set once';
  end if;
  return new;
end $$;

drop trigger if exists drawing_revisions_guard_trg on drawing_revisions;
create trigger drawing_revisions_guard_trg before update or delete on drawing_revisions
  for each row execute function drawing_revisions_guard();

-- ── The atomic release ──────────────────────────────────────────────────────────────────────────────────────────────
-- One transaction: lock the drawing, supersede the released revision, release this one, point the drawing at it. Failure leaves the old
-- release in force. The caller (a service-role route) has already checked WHO may release; the second-person rule is repeated here so a
-- bug in a route cannot let a submitter sign their own drawing.

create or replace function release_drawing_revision(p_tenant uuid, p_revision uuid, p_user uuid, p_effective date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  rev   drawing_revisions%rowtype;
  dwg   drawings%rowtype;
  typ   drawing_types%rowtype;
  old_id uuid;
begin
  select * into rev from drawing_revisions where id = p_revision and tenant_id = p_tenant;
  if not found then raise exception 'Revision not found'; end if;
  select * into dwg from drawings where id = rev.drawing_id and tenant_id = p_tenant for update;
  if not found then raise exception 'Drawing not found'; end if;
  -- read again under the lock: another release may have moved it
  select * into rev from drawing_revisions where id = p_revision and tenant_id = p_tenant;
  if rev.status <> 'in_review' then raise exception 'Only a revision in review can be released'; end if;
  if dwg.type_id is not null then
    select * into typ from drawing_types where id = dwg.type_id and tenant_id = p_tenant;
    if found and typ.second_person and rev.submitted_by is not distinct from p_user then
      raise exception 'The person who submitted a revision cannot release it';
    end if;
  end if;
  select id into old_id from drawing_revisions where drawing_id = dwg.id and status = 'released' and tenant_id = p_tenant;
  if old_id is not null then
    update drawing_revisions set status = 'superseded' where id = old_id and tenant_id = p_tenant;
  end if;
  update drawing_revisions
     set status = 'released', released_by = p_user, released_at = now(), effective_from = coalesce(p_effective, current_date),
         supersedes_rev_id = old_id
   where id = rev.id and tenant_id = p_tenant;
  update drawings set current_rev_id = rev.id, updated_at = now() where id = dwg.id and tenant_id = p_tenant;
  return jsonb_build_object('drawing_id', dwg.id, 'revision_id', rev.id, 'superseded_id', old_id);
end $$;

revoke all on function release_drawing_revision(uuid, uuid, uuid, date) from public;
revoke all on function release_drawing_revision(uuid, uuid, uuid, date) from anon, authenticated;
grant execute on function release_drawing_revision(uuid, uuid, uuid, date) to service_role;

-- ── Files: a private bucket, no policy for members ──────────────────────────────────────────────────────────────────
-- Path <tenant_id>/<drawing_id>/<revision_id>/<safe name>. Reached only through signed links the routes issue.

insert into storage.buckets (id, name, public, file_size_limit)
values ('drawing-files', 'drawing-files', false, 52428800)
on conflict (id) do nothing;

-- 0256: the elements a drawing revision declares (docs/design/pcbs-drawing-register.md, slice 2) and the ONE view the rest of the
-- product reads them through. Needs 0255 (drawings, drawing_revisions).
--
--   drawing_revision_elements   one row per element a revision declares (read from a schedule today, a model later): model_uid is the
--                               stable identity across revisions, element_code and element_type name it, quantities are what the
--                               revision says. NOT an element master (the ERP's item master owns that): it is the basis of the
--                               comparison and of "import from model". RLS on, tenant SELECT policy only, no write policy.
--                               A trigger refuses any change to the elements of a revision that left draft, EVEN from the service role.
--   released_drawing_elements   the elements of RELEASED revisions only, with the drawing number and revision label beside them.
--                               Service role only (select revoked from anon and authenticated: a view runs with its owner's rights, so
--                               without the revoke a member could read it through PostgREST past the row policies). This is the single
--                               place "only Released feeds the BOQ, the estimate and the handover" is true; src/lib/drawings/released.ts
--                               is its one reader and a test fails the build if any other file reads the elements table.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs the register works without elements (no comparison, no
-- import from model) and says so.

do $$
begin
  if to_regclass('public.drawing_revisions') is null then
    raise exception 'Run 0255 (the drawing register) first, then run this again.';
  end if;
end $$;

create table if not exists drawing_revision_elements (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  revision_id       uuid not null references drawing_revisions(id) on delete cascade,
  drawing_id        uuid not null references drawings(id) on delete cascade,
  row_no            int not null default 0,
  model_uid         text check (model_uid is null or char_length(model_uid) <= 120),
  element_code      text check (element_code is null or char_length(element_code) <= 120),
  element_type      text check (element_type is null or char_length(element_type) <= 120),
  building          text check (building is null or char_length(building) <= 120),
  wbs_item_id       uuid references tender_wbs_items(id) on delete set null,
  level             text check (level is null or char_length(level) <= 80),
  qty               numeric(14,3) not null default 1,
  unit              text check (unit is null or char_length(unit) <= 20),
  volume_m3         numeric(14,4),
  area_m2           numeric(14,3),
  length_m          numeric(14,3),
  weight_t          numeric(14,4),
  weight_calculated boolean not null default false,
  attrs             jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);
-- The same element never appears twice in one revision.
create unique index if not exists drawing_elements_uid_uniq on drawing_revision_elements (revision_id, model_uid) where model_uid is not null;
create index if not exists drawing_elements_revision_idx on drawing_revision_elements (tenant_id, revision_id, row_no);
create index if not exists drawing_elements_code_idx on drawing_revision_elements (tenant_id, drawing_id, element_code) where element_code is not null;
alter table drawing_revision_elements enable row level security;
drop policy if exists "drawing_revision_elements: tenant read" on drawing_revision_elements;
create policy "drawing_revision_elements: tenant read" on drawing_revision_elements for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

-- The elements of a revision that left draft are frozen: no insert, update or delete, even from the service role. A cascade (the
-- tenant's own deletion) runs one trigger level deeper and passes.
create or replace function drawing_elements_guard() returns trigger language plpgsql as $$
declare
  st text;
  rid uuid;
begin
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  rid := case when tg_op = 'DELETE' then old.revision_id else new.revision_id end;
  select status into st from drawing_revisions where id = rid;
  if st is not null and st <> 'draft' then
    raise exception 'The elements of a drawing revision are fixed once it was submitted';
  end if;
  if tg_op = 'UPDATE' and new.revision_id is distinct from old.revision_id then
    raise exception 'An element cannot move to another revision';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists drawing_elements_guard_trg on drawing_revision_elements;
create trigger drawing_elements_guard_trg before insert or update or delete on drawing_revision_elements
  for each row execute function drawing_elements_guard();

-- The one place a downstream feature may read elements from.
create or replace view released_drawing_elements as
  select e.id, e.tenant_id, e.drawing_id, e.revision_id, d.drawing_no, d.title as drawing_title, d.opportunity_id, d.project_id,
         r.rev_label, r.rev_no, r.released_at, r.effective_from,
         e.model_uid, e.element_code, e.element_type, e.building, e.wbs_item_id, e.level, e.qty, e.unit,
         e.volume_m3, e.area_m2, e.length_m, e.weight_t, e.weight_calculated
    from drawing_revision_elements e
    join drawing_revisions r on r.id = e.revision_id and r.tenant_id = e.tenant_id
    join drawings d on d.id = e.drawing_id and d.tenant_id = e.tenant_id
   where r.status = 'released';

revoke all on released_drawing_elements from public;
revoke all on released_drawing_elements from anon, authenticated;
grant select on released_drawing_elements to service_role;

commit;
