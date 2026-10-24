-- run-bundle-25-drawing-map-2026-10-24.sql
-- Drawing intake, part 2 (DXF): the drawing layer map on an estimate template (docs/design/drawing-intake.md).
-- = migration 0215 (estimate_templates.drawing_map jsonb, nullable). Safe to run twice. Paste into the Supabase SQL editor of each database (dev, then production).
-- Run AFTER 0213 (the estimate template catalogue). Run bundle 24 (the refreshed starter templates) AFTER this one when the regenerated starter seed
-- also writes the fence starter's drawing_map. Until it is run the layer map is hidden in the template editor and nothing else changes.


-- 0215: Drawing layer map on an estimate template (docs/design/drawing-intake.md, part 2: DXF).
--
-- `drawing_map` says which layers of a customer's DXF drawing feed which number input of the template, e.g.
--   [{"input":"total_length_m","measure":"length_m","layers":["FENCE"]},
--    {"input":"gates_double_n","measure":"count","blocks":["GATE"]}]
-- measure is length_m | area_m2 | count; layers / blocks are names (case-insensitive); an optional scale replaces the
-- drawing's own units. It only steers how a drawing is READ into an estimate; it never changes a calculation.
-- RLS: nothing to add; the table keeps its "estimate_templates: tenant isolation" policy (0131).

alter table estimate_templates add column if not exists drawing_map jsonb;
