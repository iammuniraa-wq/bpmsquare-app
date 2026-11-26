-- 0257: a tender BOQ line can name the drawing element a quantity came from (docs/design/pcbs-drawing-register.md, slice 3).
-- Needs 0255 (drawing_revisions) and 0223 (tender_boq_lines).
--
--   tender_boq_lines.element_code           the element (or element group) of the drawing this line takes its model quantity from.
--   tender_boq_lines.drawing_rev_id         the RELEASED revision that quantity came from: the pin. A newer release does not move it;
--                                           the line shows "Rev C released: review changes" until a person applies or dismisses.
--   tender_boq_lines.model_qty              the quantity the drawing declares, shown beside the client's own quantity (file_qty is never
--                                           touched: the client's number stays the client's).
--   tender_boq_lines.drawing_review_rev_id  the newer revision whose change a person has already looked at and dismissed ...
--   tender_boq_lines.drawing_review_reason  ... and why, so the chip stays quiet for that revision only.
--
-- No policy is added or changed: tender_boq_lines keeps its select-only tenant policy (0223); every write is a service-role route.
-- The pins are all nullable, so a BOQ without drawings reads and writes exactly as before. Idempotent; safe to run twice; hand-applied. Until it runs the
-- app works as before (the "Import from model" action and the review chip are hidden; 42703 reads as "not there yet").

do $$
begin
  if to_regclass('public.drawing_revisions') is null then
    raise exception 'Run 0255 (the drawing register) first, then run this again.';
  end if;
  if to_regclass('public.tender_boq_lines') is null then
    raise exception 'Run 0223 (the tender BOQ, bundle 33) first, then run this again.';
  end if;
end $$;

alter table tender_boq_lines add column if not exists element_code text check (element_code is null or char_length(element_code) <= 120);
alter table tender_boq_lines add column if not exists drawing_rev_id uuid references drawing_revisions(id) on delete set null;
alter table tender_boq_lines add column if not exists model_qty numeric(14,3);
alter table tender_boq_lines add column if not exists drawing_review_rev_id uuid references drawing_revisions(id) on delete set null;
alter table tender_boq_lines add column if not exists drawing_review_reason text check (drawing_review_reason is null or char_length(drawing_review_reason) <= 500);

create index if not exists tender_boq_lines_drawing_idx on tender_boq_lines (tenant_id, drawing_rev_id) where drawing_rev_id is not null;
