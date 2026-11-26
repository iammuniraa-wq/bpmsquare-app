-- Sample drawings for the DEMO tenant. Run AFTER supabase/migrations/0255_drawing_register.sql and 0256_drawing_elements.sql
-- (bundle scripts/run-bundle-dwg-0255-0256-2026-11-24.sql). Idempotent: a drawing is skipped when its number exists, a type when its name exists.
-- Touches ONLY tenants where is_demo = true; never a client. Also switches the drawing_register feature on for demo tenants. Sends nothing anywhere.
-- Fictional data: a three-storey precast building, "PRJ1". No file is attached (the register works without one while a schedule is loaded).
--
-- What it makes: two drawing types (the default "Drawing", and "Shop drawing" with a numbering pattern), and three drawings:
--   PRJ1-ARC-001  revision A released with its elements, revision B a draft with a changed schedule (so the comparison screen has something to show)
--   PRJ1-STR-002  revision A in review, waiting for release
--   PRJ1-STR-003  revision A a draft
-- Rows are inserted as drafts and moved along the allowed edges, because the database refuses elements on a revision that left draft and refuses
-- a skipped step in the flow.

update tenants set features = coalesce(features, '{}'::jsonb) || '{"drawing_register": true}'::jsonb where is_demo = true;

do $$
declare
  t record;
  type_default uuid;
  type_shop uuid;
  d1 uuid; d2 uuid; d3 uuid;
  r1a uuid; r1b uuid; r2a uuid; r3a uuid;
  submitter uuid;
begin
  if to_regclass('public.drawings') is null then
    raise exception 'Run 0255 and 0256 (bundle run-bundle-dwg-0255-0256-2026-11-24.sql) first, then run this again.';
  end if;
  for t in select id from tenants where is_demo = true loop
    select user_id into submitter from tenant_users where tenant_id = t.id order by created_at limit 1;

    insert into drawing_types (tenant_id, name, rev_scheme, second_person, feeds)
    select t.id, 'Drawing', 'letters', true, array['estimate','boq','handover']
    where not exists (select 1 from drawing_types x where x.tenant_id = t.id and lower(x.name) = 'drawing');
    insert into drawing_types (tenant_id, name, numbering_pattern, rev_scheme, second_person, feeds, sort_order)
    select t.id, 'Shop drawing', '{project}-{discipline}-{seq3}', 'letters', true, array['boq','handover'], 1
    where not exists (select 1 from drawing_types x where x.tenant_id = t.id and lower(x.name) = 'shop drawing');
    select id into type_default from drawing_types where tenant_id = t.id and lower(name) = 'drawing';
    select id into type_shop from drawing_types where tenant_id = t.id and lower(name) = 'shop drawing';

    -- 1. Released A + draft B with a changed schedule
    if not exists (select 1 from drawings where tenant_id = t.id and lower(drawing_no) = 'prj1-arc-001') then
      insert into drawings (tenant_id, ref, drawing_no, title, type_id, created_by)
      values (t.id, 'DWG-0001', 'PRJ1-ARC-001', 'Ground floor slab layout', type_shop, submitter) returning id into d1;
      insert into drawing_revisions (tenant_id, drawing_id, rev_no, rev_label, status, source, notes, created_by)
      values (t.id, d1, 0, 'A', 'draft', 'schedule', 'First issue for tender', submitter) returning id into r1a;
      insert into drawing_revision_elements (tenant_id, revision_id, drawing_id, row_no, element_code, element_type, building, level, qty, volume_m3, weight_t, weight_calculated)
      values
        (t.id, r1a, d1, 1, 'SL-001', 'Hollow-core slab', 'Block A', 'L1', 24, 3.2, 8.0, true),
        (t.id, r1a, d1, 2, 'SL-002', 'Hollow-core slab', 'Block A', 'L1', 12, 2.4, 6.0, true),
        (t.id, r1a, d1, 3, 'BM-001', 'Beam', 'Block A', 'L1', 16, 1.1, 2.75, true),
        (t.id, r1a, d1, 4, 'CL-001', 'Column', 'Block A', 'L1', 20, 0.9, 2.25, true);
      update drawing_revisions set status = 'in_review', submitted_by = submitter, submitted_at = now() - interval '9 days' where id = r1a;
      update drawing_revisions set status = 'released', released_by = coalesce((select user_id from tenant_users where tenant_id = t.id and user_id <> submitter limit 1), submitter),
             released_at = now() - interval '8 days', effective_from = (current_date - 8) where id = r1a;
      update drawings set current_rev_id = r1a where id = d1;
      insert into drawing_revisions (tenant_id, drawing_id, rev_no, rev_label, status, source, notes, created_by)
      values (t.id, d1, 1, 'B', 'draft', 'schedule', 'After the consultant''s comments: two slabs added, one beam removed', submitter) returning id into r1b;
      insert into drawing_revision_elements (tenant_id, revision_id, drawing_id, row_no, element_code, element_type, building, level, qty, volume_m3, weight_t, weight_calculated)
      values
        (t.id, r1b, d1, 1, 'SL-001', 'Hollow-core slab', 'Block A', 'L1', 28, 3.2, 8.0, true),
        (t.id, r1b, d1, 2, 'SL-002', 'Hollow-core slab', 'Block A', 'L1', 12, 2.4, 6.0, true),
        (t.id, r1b, d1, 3, 'SL-003', 'Hollow-core slab', 'Block A', 'L2', 8, 2.4, 6.0, true),
        (t.id, r1b, d1, 4, 'CL-001', 'Column', 'Block A', 'L1', 20, 0.95, 2.375, true);
    end if;

    -- 2. In review
    if not exists (select 1 from drawings where tenant_id = t.id and lower(drawing_no) = 'prj1-str-002') then
      insert into drawings (tenant_id, ref, drawing_no, title, type_id, created_by)
      values (t.id, 'DWG-0002', 'PRJ1-STR-002', 'Roof beam layout', type_shop, submitter) returning id into d2;
      insert into drawing_revisions (tenant_id, drawing_id, rev_no, rev_label, status, source, created_by)
      values (t.id, d2, 0, 'A', 'draft', 'schedule', submitter) returning id into r2a;
      insert into drawing_revision_elements (tenant_id, revision_id, drawing_id, row_no, element_code, element_type, building, level, qty, volume_m3, weight_t, weight_calculated)
      values (t.id, r2a, d2, 1, 'RB-001', 'Roof beam', 'Block A', 'Roof', 18, 1.6, 4.0, true), (t.id, r2a, d2, 2, 'RB-002', 'Roof beam', 'Block A', 'Roof', 6, 2.0, 5.0, true);
      update drawing_revisions set status = 'in_review', submitted_by = submitter, submitted_at = now() - interval '1 day' where id = r2a;
    end if;

    -- 3. A draft
    if not exists (select 1 from drawings where tenant_id = t.id and lower(drawing_no) = 'prj1-str-003') then
      insert into drawings (tenant_id, ref, drawing_no, title, type_id, created_by)
      values (t.id, 'DWG-0003', 'PRJ1-STR-003', 'Column schedule', type_default, submitter) returning id into d3;
      insert into drawing_revisions (tenant_id, drawing_id, rev_no, rev_label, status, source, created_by)
      values (t.id, d3, 0, 'A', 'draft', 'upload', submitter) returning id into r3a;
    end if;
  end loop;
end $$;
