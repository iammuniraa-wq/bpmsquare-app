-- 0253: buildings, element types, element codes and the two quantities (docs/design/pcbs-buildings-elements.md, owner decision 11, generic).
-- Needs 0226 (contract_projects, erp_masters, project_budget_lines), 0223 (tender_boq_lines), 0243 (tender_wbs_items, project_work_packages)
-- and 0053 (standard_quote_lines).
--
-- Buildings are not a new table: a building is a level-1 WBS item that carries a building code. Elements are not WBS nodes: they are
-- three fields on a contract line (type, code, and a second quantity).
--
--   tender_wbs_items.building_code / project_work_packages.building_code
--        1 to 6 characters A-Z 0-9; non-null = "this level-1 item is a building". A check refuses it on a child item. Unique per tender and
--        per project (partial index). The WBS code (1, 2, 2.1) can still be renumbered; the building code is the stable key element codes are
--        built from.
--   tender_boq_lines.element_type / element_code / model_qty
--   project_budget_lines.element_type / element_code / client_qty / model_qty
--        element_code is unique per deal (tender) and per revision of a project (a revision copy keeps the code with the line_key, so the same
--        code in two revisions is the same element). client_qty is the contracted number (copied from the tender's file_qty at creation, then
--        frozen); model_qty is what the model or the drawings say. The budget qty stays the one every surface reads.
--   contract_projects.element_pattern
--        The pattern the project issues codes in, frozen when its first code is issued, so a later change of the workspace setting changes only
--        new projects.
--   standard_quote_lines.element_type / building
--        A quote has no WBS: it carries the type and a free building label, which become buildings (matched by name) when a project is made.
--   erp_masters.kind
--        Widened with 'element_type' (the list of element types: HCS hollow-core slab, WAL wall panel ...).
--
-- RLS: no new table here. Every column sits on a table that already carries its tenant policy (0226, 0243), the tender / contract convention
-- of select-only for members where the table has it; nothing about these columns is writable by a member through PostgREST that was not
-- already, and the routes check the tenant, the record and the caller.
--
-- Idempotent; safe to run twice. Hand-applied by the owner: until it runs the app works exactly as before (the Buildings view says "needs a
-- database update", the element fields and the quantities are hidden); 42P01 / 42703 / PGRST204 / PGRST205 are read as "not there yet".

do $$
begin
  if to_regclass('public.project_budget_lines') is null or to_regclass('public.erp_masters') is null then
    raise exception 'Run 0226 (bundle 36, contract projects) first, then run this again.';
  end if;
  if to_regclass('public.tender_boq_lines') is null then
    raise exception 'Run 0223 (the tender BOQ, bundle 33) first, then run this again.';
  end if;
  if to_regclass('public.tender_wbs_items') is null or to_regclass('public.project_work_packages') is null then
    raise exception 'Run 0243 (the WBS, bundle 51) first, then run this again.';
  end if;
end $$;

-- ── Buildings: level-1 WBS items with a code ────────────────────────────────────────────────────────────────────────

alter table tender_wbs_items add column if not exists building_code text;
alter table tender_wbs_items drop constraint if exists tender_wbs_items_building_code_check;
alter table tender_wbs_items add constraint tender_wbs_items_building_code_check
  check (building_code is null or (building_code ~ '^[A-Z0-9]{1,6}$' and parent_id is null));
create unique index if not exists tender_wbs_items_building_uniq on tender_wbs_items (opportunity_id, building_code) where building_code is not null;

alter table project_work_packages add column if not exists building_code text;
alter table project_work_packages drop constraint if exists project_work_packages_building_code_check;
alter table project_work_packages add constraint project_work_packages_building_code_check
  check (building_code is null or (building_code ~ '^[A-Z0-9]{1,6}$' and parent_id is null));
create unique index if not exists project_work_packages_building_uniq on project_work_packages (project_id, building_code) where building_code is not null;

-- ── Element type, element code, quantities ──────────────────────────────────────────────────────────────────────────

alter table tender_boq_lines add column if not exists element_type text;
alter table tender_boq_lines add column if not exists element_code text;
alter table tender_boq_lines add column if not exists model_qty numeric(14,3);
alter table tender_boq_lines drop constraint if exists tender_boq_lines_element_code_check;
alter table tender_boq_lines add constraint tender_boq_lines_element_code_check check (element_code is null or (char_length(element_code) between 1 and 40 and element_code ~ '^[A-Z0-9][A-Z0-9._/-]*$'));
alter table tender_boq_lines drop constraint if exists tender_boq_lines_element_type_check;
alter table tender_boq_lines add constraint tender_boq_lines_element_type_check check (element_type is null or element_type ~ '^[A-Z0-9]{2,5}$');
create unique index if not exists tender_boq_lines_element_uniq on tender_boq_lines (opportunity_id, element_code) where element_code is not null;

alter table project_budget_lines add column if not exists element_type text;
alter table project_budget_lines add column if not exists element_code text;
alter table project_budget_lines add column if not exists client_qty numeric(14,3);
alter table project_budget_lines add column if not exists model_qty numeric(14,3);
alter table project_budget_lines drop constraint if exists project_budget_lines_element_code_check;
alter table project_budget_lines add constraint project_budget_lines_element_code_check check (element_code is null or (char_length(element_code) between 1 and 40 and element_code ~ '^[A-Z0-9][A-Z0-9._/-]*$'));
alter table project_budget_lines drop constraint if exists project_budget_lines_element_type_check;
alter table project_budget_lines add constraint project_budget_lines_element_type_check check (element_type is null or element_type ~ '^[A-Z0-9]{2,5}$');
create unique index if not exists project_budget_lines_element_uniq on project_budget_lines (project_id, revision_id, element_code) where element_code is not null;
create index if not exists project_budget_lines_element_type_idx on project_budget_lines (tenant_id, project_id, element_type) where element_type is not null;

alter table contract_projects add column if not exists element_pattern text check (element_pattern is null or char_length(element_pattern) <= 80);

alter table standard_quote_lines add column if not exists element_type text;
alter table standard_quote_lines add column if not exists building text;
alter table standard_quote_lines drop constraint if exists standard_quote_lines_element_type_check;
alter table standard_quote_lines add constraint standard_quote_lines_element_type_check check (element_type is null or element_type ~ '^[A-Z0-9]{2,5}$');
alter table standard_quote_lines drop constraint if exists standard_quote_lines_building_check;
alter table standard_quote_lines add constraint standard_quote_lines_building_check check (building is null or char_length(building) <= 100);

-- ── The element type list: one more kind of master ──────────────────────────────────────────────────────────────────

alter table erp_masters drop constraint if exists erp_masters_kind_check;
alter table erp_masters add constraint erp_masters_kind_check
  check (kind in ('resource', 'cost_code', 'justification', 'reserve_type', 'division', 'job_location', 'element_type'));
