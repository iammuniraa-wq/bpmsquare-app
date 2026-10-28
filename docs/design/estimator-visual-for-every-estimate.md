# Estimator: a visual for every estimate, built dynamically

> Owner 2026-10-28: "the estimator should show the visuals always, for any kind of estimate, dynamically." Today a template has a 3D model
> only when it names a geometry module (`EstimateTemplate.geometry`: precast villa, chain-link fence, tiles floor, porta cabin). A formula-only
> template (drainage package, a BOQ-style trade, a service) shows no visual at all. This design gives every estimate a picture that is built from
> its own numbers and changes as the numbers change, without a bespoke module per trade.

## What is already there (rule 6c)

- Geometry modules (`src/lib/estimator/geometry/*`): inputs in, real pieces out; the 3D viewer draws the pieces and the BOM sums them
  (`docs/estimator-architecture.md` 10). `previewKindFor(geometry)` picks the card (fence / pieces) in `EstimateWorkspace.tsx`; `geometry: null`
  shows nothing. Design attributes repaint slots; PBR materials and CC0 textures are in.
- The compute (`src/lib/estimator/compute.ts`): every estimate has `ComputedLine[]` with code, group, qty, unit, component, cost, and
  `EstimateTotals.by_group / by_component`. These exist for EVERY template, geometry or not. The template's `inputs` carry key, label, type and
  unit; `drawing_map` (0215) already names which inputs are dimensions for DXF intake.
- The Sales Order record page pattern (bpmsquarecore 3c.12): a visual summary first, detail behind it.

## Decision: three layers, so a visual is never missing

1. **Bespoke 3D** (unchanged): a template with a geometry module keeps its model, viewer, inspector and design attributes.
2. **Generic 3D massing, built from the template's dimension inputs** (new module key `generic`, `src/lib/estimator/geometry/generic.ts`): any
   template whose inputs include dimensions gets a to-scale scene drawn from them: a footprint (length x width), a height, a run (metres of
   pipe, cable, fence: a long element along x), a count of repeated units (manholes, cabins, panels: boxes placed in a row or grid), an area
   (a slab). The roles come from a **Visual mapping** on the template (`visual: { length?, width?, height?, run?, count?, area? }`: input keys),
   with inference as the default when the mapping is empty (input key or unit: m, m2, m3, nos, "length", "width", "height", "qty"). Pieces carry
   the line codes they stand for, so clicking a piece highlights its lines like the villa does. Materials: a neutral concrete / steel / soil
   palette by component (`by_component`), repainted by design attributes if the template has any. The module returns pieces in the existing
   `GeometryModel` shape, so the viewer, the inspector and the BOM totals work with no new renderer.
3. **Composition strip, always** (new `EstimateVisualStrip.tsx`, shown on every estimate above the price): the estimate as a picture of its
   parts: one bar per group (`by_group`, width = share of cost, label and amount), and under it the components (`by_component`: material,
   labour, plant, subcontract, overhead) as a stacked bar; a pill per unpriced line. Rebuilt on every compute (so it moves as inputs
   change in the live preview). This is the "always" guarantee: a template with no dimensions at all (a service estimate) still gets a visual.

A template therefore shows: bespoke 3D if it has one, else the generic massing if it has dimensions, and the composition strip in all cases.
Nothing is a column of fields first (3c.12).

## Template editor

- "Visual" section (replaces the current single geometry picker): **Picture** = Bespoke model (the existing picker, only when a module exists
  for the trade) / Built from the inputs (generic) / None; **Visual mapping** (shown for generic): six selects, each listing the template's
  number inputs, prefilled by inference, one InfoTip. Rule 6c: one place, few options, defaults decide.
- Starter templates (`starterTemplates*.ts`) get a mapping where it is obvious (drainage: run = pipe length, count = manholes).

## Screens and rules (6b)

- Workspace: the visual card first (3D or generic 3D), the composition strip under it, then inputs and price as today; at 375 px the 3D card is
  full width and the strip stacks its labels; tap targets unchanged. Reduced motion: no camera animation.
- PDF / customer preview: the composition strip renders as a static SVG on the customer-facing estimate when `customer_visible` (never cost: the
  customer strip shows share by group only, no amounts, since totals are internal until quoted; amounts appear only on the internal view).
- AI intake (`aiIntake.ts`) can fill the visual mapping when it drafts a template; no new prompt beyond the field.

## Data

- `estimate_templates.visual jsonb` (migration, next number; nullable; RLS unchanged; degrade when missing: inference only). `geometry` keeps
  its meaning; `"generic"` is a valid key. No change to estimates: the strip is computed from `totals`, the massing from inputs at render time.
- Data Workbench: the template export/import carries `visual` (templates are already an object there? if not, say so in the commit).

## Definition of done

- Unit tests: inference (keys and units), the generic module's piece layout for each role combination (dimensions only, run only, count only,
  area only, all, none), strip maths (shares sum to 100, unpriced pills), customer strip hides amounts.
- Render tests: workspace shows the strip on a formula-only template, generic 3D on a template with dimensions, bespoke on the villa.
- Visual check on the demo at 1280 px and 375 px with EST-0017 (bespoke), a formula-only template, and a new drainage template.
- `tsc`, full vitest (only the 4 known sapFlow failures), `next build`; migration file + ledger line; no SQL for the owner beyond that one file.
