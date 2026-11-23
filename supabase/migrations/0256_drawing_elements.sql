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
