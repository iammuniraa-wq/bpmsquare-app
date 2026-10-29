-- 0235: The picture of an estimate template (docs/design/estimator-visual-for-every-estimate.md).
--
-- `visual` says how an estimate is drawn when its template has no built-in 3D model: which number input is the length, width,
-- height, run, count or area of what is being built, e.g.
--   {"run":"length_m","count":"valves_n"}          or  {"picture":"none"}   (no picture)
-- Values are input keys of the same template; validated by the application (src/lib/estimator/visual.ts), stored as is. Null = the
-- picture is inferred from the names and units of the inputs. It only steers how an estimate is DRAWN; it never changes a
-- calculation, so it is not part of the template's version.
--
-- Additive, nullable, no default. RLS: nothing to add; the table keeps its "estimate_templates: tenant isolation" policy (0131) and a
-- new column is covered by it.
--
-- Code degrades while this is pending: the picture is inferred from the inputs, the template editor says the picture settings cannot
-- be saved yet, and a save leaves them out.

alter table estimate_templates add column if not exists visual jsonb;
