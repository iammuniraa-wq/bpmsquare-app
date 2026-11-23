-- 0254: the model comparison (docs/design/pcbs-buildings-elements.md section 2.4, slice 5). Needs 0226 (contract_projects) and 0253.
--
-- A model comparison is a small record: what the model or the drawings say about the buildings and elements of a project, set beside what the
-- budget holds. It is a comparison, never an overwrite: a revision arrives as rows to review, and "Apply selected" is the only thing that
-- writes (revision 0 while no baseline is approved, a draft revision after).
--
--   project_model_imports        one comparison: import_no per project, where it came from (file | connector | hand), a model reference such as
--                                "Revit v3", when it was received, and its state (open | applied | dismissed).
--   project_model_import_rows    its rows in the connector's batch shape: building code / name, element type, element code if known, quantity,
--                                unit, drawing number and revision (held here only, until the drawing register exists), and the kind the matching
--                                gave (same | qty_changed | new_element | new_building | not_in_model) with the budget line it matched.
--
-- RLS (the 0243 convention, MULTI_TENANT_GUARDRAILS.md): both tables carry a tenant SELECT policy and NOTHING that writes. The comparison decides
-- what a baseline revision may change, so a member must not rewrite it through PostgREST; every write is a service-role route that has checked
-- the tenant, the project and the caller.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs the model comparison screen says "needs a database update" and nothing
-- else changes (42P01 / PGRST205 are read as "not there yet").

do $$
begin
  if to_regclass('public.contract_projects') is null then
    raise exception 'Run 0226 (bundle 36, contract projects) first, then run this again.';
  end if;
end $$;

create table if not exists project_model_imports (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  project_id    uuid not null references contract_projects(id) on delete cascade,
  import_no     int not null check (import_no >= 1),
  source        text not null default 'file' check (source in ('file', 'connector', 'hand')),
  model_ref     text check (model_ref is null or char_length(model_ref) <= 200),
  received_at   timestamptz not null default now(),
  status        text not null default 'open' check (status in ('open', 'applied', 'dismissed')),
  row_count     int not null default 0,
  applied_revision_id uuid,
  applied_at    timestamptz,
  applied_by    uuid,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  unique (project_id, import_no)
);
create index if not exists project_model_imports_project_idx on project_model_imports (tenant_id, project_id, import_no desc);
alter table project_model_imports enable row level security;
drop policy if exists "project_model_imports: tenant read" on project_model_imports;
create policy "project_model_imports: tenant read" on project_model_imports for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));

create table if not exists project_model_import_rows (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  project_id     uuid not null references contract_projects(id) on delete cascade,
  import_id      uuid not null references project_model_imports(id) on delete cascade,
  row_no         int not null check (row_no >= 1),
  building_code  text check (building_code is null or building_code ~ '^[A-Z0-9]{1,6}$'),
  building_name  text check (building_name is null or char_length(building_name) <= 200),
  element_type   text check (element_type is null or element_type ~ '^[A-Z0-9]{2,5}$'),
  element_code   text check (element_code is null or char_length(element_code) <= 40),
  qty            numeric(14,3),
  unit           text check (unit is null or char_length(unit) <= 30),
  drawing_no     text check (drawing_no is null or char_length(drawing_no) <= 100),
  drawing_rev    text check (drawing_rev is null or char_length(drawing_rev) <= 30),
  kind           text not null default 'new_element' check (kind in ('same', 'qty_changed', 'new_element', 'new_building', 'not_in_model')),
  matched_line_key uuid,
  unique (import_id, row_no)
);
create index if not exists project_model_import_rows_import_idx on project_model_import_rows (tenant_id, import_id, row_no);
alter table project_model_import_rows enable row level security;
drop policy if exists "project_model_import_rows: tenant read" on project_model_import_rows;
create policy "project_model_import_rows: tenant read" on project_model_import_rows for select
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
