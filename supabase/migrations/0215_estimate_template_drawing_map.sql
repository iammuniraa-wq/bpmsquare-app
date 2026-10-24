-- 0215: Drawing layer map on an estimate template (docs/design/drawing-intake.md, part 2: DXF).
--
-- `drawing_map` says which layers of a customer's DXF drawing feed which number input of the template, e.g.
--   [{"input":"total_length_m","measure":"length_m","layers":["FENCE"]},
--    {"input":"gates_double_n","measure":"count","blocks":["GATE"]}]
-- measure is length_m | area_m2 | count; layers / blocks are names (case-insensitive); an optional scale replaces the
-- drawing's own units. Validated by the application (src/lib/estimator/template.ts); the database stores it as is.
-- It only steers how a drawing is READ into an estimate; it never changes a calculation, so it is not part of the
-- template's version.
--
-- Additive, nullable, no default. RLS: nothing to add; the table keeps its "estimate_templates: tenant isolation" policy
-- (0131) and a new column is covered by it. A starter (locked) template's map is refreshed by the starter seed, as its
-- inputs and rules are.
--
-- Code degrades while this is pending: the template editor hides the layer map with a note, a save leaves the map out,
-- and a DXF drawing lists its layers but fills nothing.

alter table estimate_templates add column if not exists drawing_map jsonb;
